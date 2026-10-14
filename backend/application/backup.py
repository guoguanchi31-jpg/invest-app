"""Versioned, validated whole-book backup and transactional restore."""
import hashlib
import json
import os
import re
from copy import deepcopy
from datetime import datetime
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

import infrastructure.database as database
from application.snapshots import refresh_family_warehouse_snapshots
from application.commands import current_command_key
from application.errors import CommandError
from audit import record_audit_event
from infrastructure.database import (
    BASE_CURRENCY,
    FINANCIAL_TABLES,
    consistent_read_connection,
    current_command_connection,
    is_postgres_connection,
    rows_to_dicts,
    lock_family_write,
)
from infrastructure.restore_store import FOREIGN_KEYS, insert_restored_rows
from domain.accounts import account_state_defaults
from domain.budgets import distribute_budget_category_allocations
from domain.dates import canonical_business_date, stored_business_date
from domain.money import decimal_text, decimal_value, money, money_equal, rate
from domain.persisted_records import (
    PersistedRecordViolation,
    validate_persisted_financial_rows,
)
from domain.reconciliation import HISTORY_BASES, reconstruct_account_state
from domain.snapshot_compatibility import normalize_legacy_snapshot_rows
from domain.transfers import recipient_rounding_is_valid
from migrations.schema import BUSINESS_DATE_COLUMNS, POSTGRES_NUMERIC_COLUMNS
from tenancy import assert_family_admin, get_auth_context


BACKUP_VERSION = 8
SUPPORTED_BACKUP_VERSIONS = frozenset(range(1, BACKUP_VERSION + 1))


def _backup_row(table, row):
    numeric_fields = POSTGRES_NUMERIC_COLUMNS.get(table, {})
    return {
        key: decimal_text(value)
        if value is not None and (key in numeric_fields or isinstance(value, Decimal))
        else value
        for key, value in dict(row).items()
    }


def _decode_backup_numbers(payload):
    data = payload.get("data")
    if not isinstance(data, dict):
        return
    for table, fields in POSTGRES_NUMERIC_COLUMNS.items():
        for row in data.get(table, []):
            if not isinstance(row, dict):
                continue
            for field in fields:
                if row.get(field) is not None:
                    row[field] = decimal_value(row[field])


def _normalize_backup_dates(data):
    for table, fields in BUSINESS_DATE_COLUMNS.items():
        if table == "snapshots":
            continue
        for row in data.get(table, []):
            if not isinstance(row, dict):
                continue
            for field, nullable in fields.items():
                if field not in row:
                    continue
                try:
                    row[field] = stored_business_date(
                        row[field],
                        nullable=nullable,
                    )
                except (TypeError, ValueError) as exc:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"备份无效：{table}.{field} 必须是 YYYY-MM-DD；"
                            "仅兼容可无歧义转换的历史 YYYYMMDD"
                        ),
                    ) from exc
    try:
        snapshots, report = normalize_legacy_snapshot_rows(
            data.get("snapshots", []),
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail=(
                "备份无效：snapshots.snapshot_date 必须是 YYYY-MM-DD；"
                "仅兼容可无歧义转换的历史 YYYYMMDD"
            ),
        ) from exc
    data["snapshots"] = snapshots
    return report


def snapshot(conn, family_id=None):
    family_id = family_id or get_auth_context(conn).family_id
    data = {
        table: [
            _backup_row(table, row)
            for row in rows_to_dicts(conn.execute(
                f"SELECT * FROM {table} WHERE family_id = ? ORDER BY id",
                (family_id,),
            ).fetchall())
        ]
        for table in FINANCIAL_TABLES
    }
    referenced_member_ids = sorted({
        row["member_id"]
        for rows in data.values()
        for row in rows
        if isinstance(row.get("member_id"), int) and row["member_id"] > 0
    })
    referenced_clause = ""
    member_params = [family_id]
    if referenced_member_ids:
        referenced_clause = f" OR id IN ({', '.join('?' for _ in referenced_member_ids)})"
        member_params.extend(referenced_member_ids)
    return {
        "format": "invest-backup", "version": BACKUP_VERSION, "base_currency": BASE_CURRENCY,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "family_id": family_id,
        "members": rows_to_dicts(conn.execute(
            f"""
            SELECT id AS source_id, member_key, display_name, role
            FROM family_members
            WHERE family_id = ? AND (is_active = 1{referenced_clause})
            ORDER BY id
            """,
            tuple(member_params),
        ).fetchall()),
        "data": data,
    }


def fingerprint(payload):
    canonical = json.dumps(
        {"members": payload.get("members", []), "data": payload["data"]},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=decimal_text,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def table_columns(conn, table):
    if is_postgres_connection(conn):
        return rows_to_dicts(conn.execute("""
            SELECT column_name AS name, data_type AS type,
                   CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS required,
                   column_default AS default_value
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
        """, (table,)).fetchall())
    return [
        {"name": row["name"], "type": row["type"], "required": row["notnull"],
         "default_value": row["dflt_value"]}
        for row in conn.execute(f"PRAGMA table_info({table})")
    ]


def legacy_audit_account_links(data):
    transactions = {row["id"]: row for row in data.get("transactions", [])}
    holdings = {row["id"]: row for row in data.get("holdings", [])}
    trades = {row["id"]: row for row in data.get("investment_trades", [])}
    transfers = {}
    for row in data.get("transactions", []):
        if row.get("reference_id"):
            transfers.setdefault(row["reference_id"], set()).add(row.get("account_id"))
    links = []
    seen = set()
    for event in data.get("audit_events", []):
        entity_type = event.get("entity_type")
        entity_id = event.get("entity_id")
        account_ids = set()
        if entity_type == "account":
            try:
                account_ids.add(int(entity_id))
            except (TypeError, ValueError):
                pass
        elif entity_type == "transaction":
            row = transactions.get(int(entity_id)) if str(entity_id or "").isdigit() else None
            if row:
                account_ids.add(row.get("account_id"))
        elif entity_type == "holding":
            row = holdings.get(int(entity_id)) if str(entity_id or "").isdigit() else None
            if row:
                account_ids.add(row.get("account_id"))
        elif entity_type == "investment_trade":
            row = trades.get(int(entity_id)) if str(entity_id or "").isdigit() else None
            if row:
                account_ids.add(row.get("account_id"))
        elif entity_type == "transfer":
            account_ids.update(transfers.get(entity_id, set()))
        for account_id in sorted(value for value in account_ids if isinstance(value, int)):
            key = (event["id"], account_id)
            if key in seen:
                continue
            seen.add(key)
            links.append({
                "id": len(links) + 1,
                "family_id": event.get("family_id"),
                "audit_event_id": event["id"],
                "account_id": account_id,
            })
    return links


def upgrade_legacy_family_plans(payload, default_member_id):
    data = payload["data"]
    data.setdefault("budget_plans", [])
    data.setdefault("budget_member_allocations", [])
    data.setdefault("budget_category_allocations", [])
    data.setdefault("goal_allocations", [])
    if payload.get("version") >= 4:
        return

    next_plan_id = 1
    grouped_budgets = {}
    for row in data.get("budgets", []):
        grouped_budgets.setdefault((row.get("family_id"), row.get("month")), []).append(row)
    merged_budgets = []
    for (family_id, month), rows in grouped_budgets.items():
        plan_id = next_plan_id
        next_plan_id += 1
        total_amount = sum(row.get("amount") or 0 for row in rows)
        timestamps = [row.get("created_at") for row in rows if row.get("created_at")]
        updated = [row.get("updated_at") for row in rows if row.get("updated_at")]
        data["budget_plans"].append({
            "id": plan_id,
            "family_id": family_id,
            "month": month,
            "total_amount": total_amount,
            "created_at": min(timestamps) if timestamps else None,
            "updated_at": max(updated) if updated else None,
        })
        member_amounts = {}
        category_rows = {}
        for row in rows:
            member_id = row.get("member_id") or default_member_id
            member_amounts[member_id] = member_amounts.get(member_id, 0) + (row.get("amount") or 0)
            category_rows.setdefault(row.get("category_id"), []).append(row)
        for member_id, amount in member_amounts.items():
            data["budget_member_allocations"].append({
                "id": len(data["budget_member_allocations"]) + 1,
                "family_id": family_id,
                "budget_plan_id": plan_id,
                "member_id": member_id,
                "amount": amount,
                "created_at": min(timestamps) if timestamps else None,
                "updated_at": max(updated) if updated else None,
            })
        for category_group in category_rows.values():
            primary = category_group[0]
            primary["member_id"] = None
            primary["amount"] = sum(row.get("amount") or 0 for row in category_group)
            merged_budgets.append(primary)
            removed_ids = {str(row.get("id")) for row in category_group[1:]}
            for event in data.get("audit_events", []):
                if event.get("entity_type") == "budget" and event.get("entity_id") in removed_ids:
                    event["entity_id"] = str(primary.get("id"))
    data["budgets"] = merged_budgets

    for goal in data.get("goals", []):
        member_id = goal.get("member_id") or default_member_id
        data["goal_allocations"].append({
            "id": len(data["goal_allocations"]) + 1,
            "family_id": goal.get("family_id"),
            "goal_id": goal.get("id"),
            "member_id": member_id,
            "target_amount": goal.get("target_amount"),
            "current_amount": goal.get("current_amount") or 0,
            "monthly_saving": goal.get("monthly_saving") or 0,
            "created_at": goal.get("created_at"),
            "updated_at": goal.get("updated_at"),
        })
        goal["member_id"] = None
        for record in data.get("goal_records", []):
            if record.get("goal_id") == goal.get("id") and record.get("member_id") is None:
                record["member_id"] = member_id
    payload["version"] = 4


def upgrade_budget_category_allocations(payload, default_member_id):
    data = payload["data"]
    data.setdefault("budget_category_allocations", [])
    if payload.get("version") >= 5:
        return

    for plan in data.get("budget_plans", []):
        categories = [
            row
            for row in data.get("budgets", [])
            if row.get("family_id") == plan.get("family_id")
            and row.get("month") == plan.get("month")
        ]
        members = [
            row
            for row in data.get("budget_member_allocations", [])
            if row.get("budget_plan_id") == plan.get("id")
        ]
        matrix = distribute_budget_category_allocations(
            [(row.get("category_id"), row.get("amount")) for row in categories],
            [(row.get("member_id"), row.get("amount")) for row in members],
            default_member_id,
        )
        for category_id, member_id, amount in matrix:
            data["budget_category_allocations"].append({
                "id": len(data["budget_category_allocations"]) + 1,
                "family_id": plan.get("family_id"),
                "budget_plan_id": plan.get("id"),
                "category_id": category_id,
                "member_id": member_id,
                "amount": amount,
                "created_at": plan.get("created_at"),
                "updated_at": plan.get("updated_at"),
            })
    payload["version"] = 5


def normalize_backup_scope(conn, payload, family_id=None, *, create_missing=False):
    context = get_auth_context(conn)
    family_id = family_id or context.family_id
    normalized = deepcopy(payload)
    _decode_backup_numbers(normalized)
    data = normalized.get("data")
    if not isinstance(data, dict):
        return normalized
    normalized["snapshot_compatibility"] = _normalize_backup_dates(data)
    for account in data.get("accounts", []):
        account.update(account_state_defaults(account))
        account.setdefault("history_basis", "unknown")
    for event in data.get("audit_events", []):
        event.setdefault("payload_version", 0)
    if normalized.get("version") == 1 and "audit_events" not in data:
        data["audit_events"] = []
    if normalized.get("version") in {1, 2} and "audit_event_accounts" not in data:
        data["audit_event_accounts"] = legacy_audit_account_links(data)
    raw_members = normalized.get("members", [])
    source_owner_id = next(
        (
            member.get("source_id")
            for member in raw_members
            if isinstance(member, dict) and member.get("role") == "owner"
        ),
        context.member_id,
    )
    upgrade_legacy_family_plans(normalized, source_owner_id)
    upgrade_budget_category_allocations(normalized, source_owner_id)
    target_members = conn.execute(
        """
        SELECT id, member_key, display_name
        FROM family_members
        WHERE family_id = ?
        """,
        (family_id,),
    ).fetchall()
    target_by_key = {row["member_key"]: row for row in target_members if row["member_key"]}
    target_by_name = {row["display_name"]: row for row in target_members}
    target_by_id = {row["id"]: row for row in target_members}
    raw_members = normalized.get("members", [])
    if normalized.get("version") in SUPPORTED_BACKUP_VERSIONS - {1}:
        if not isinstance(raw_members, list):
            raise HTTPException(status_code=422, detail="备份无效：成员清单格式错误")
        seen_source_ids = set()
        seen_keys = set()
        for source in raw_members:
            source_id = source.get("source_id") if isinstance(source, dict) else None
            member_key = source.get("member_key") if isinstance(source, dict) else None
            display_name = source.get("display_name") if isinstance(source, dict) else None
            if (
                type(source_id) is not int
                or source_id <= 0
                or source_id in seen_source_ids
                or not isinstance(member_key, str)
                or not member_key.strip()
                or member_key in seen_keys
                or not isinstance(display_name, str)
                or not display_name.strip()
            ):
                raise HTTPException(status_code=422, detail="备份无效：成员清单存在无效或重复记录")
            seen_source_ids.add(source_id)
            seen_keys.add(member_key)
    source_members = {
        row["source_id"]: row
        for row in raw_members
        if isinstance(row, dict) and isinstance(row.get("source_id"), int)
    }
    if not source_members:
        for account in data.get("accounts", []):
            source_id = account.get("member_id")
            owner = (account.get("owner") or "").strip()
            if isinstance(source_id, int) and owner:
                source_members.setdefault(source_id, {
                    "source_id": source_id,
                    "member_key": None,
                    "display_name": owner,
                    "role": "member",
                })
    owner_names = {
        row.get("member_id"): (row.get("owner") or "").strip()
        for row in data.get("accounts", [])
        if isinstance(row.get("member_id"), int) and (row.get("owner") or "").strip()
    }
    for rows in data.values():
        if not isinstance(rows, list):
            continue
        for row in rows:
            source_id = row.get("member_id") if isinstance(row, dict) else None
            if isinstance(source_id, int) and source_id > 0 and source_id not in source_members:
                source_members[source_id] = {
                    "source_id": source_id,
                    "member_key": None,
                    "display_name": owner_names.get(source_id) or f"历史成员 {source_id}",
                    "role": "member",
                }

    member_mapping = {}
    mapping_report = []
    next_preview_id = -1
    for source_id, source in source_members.items():
        member_key = (source.get("member_key") or "").strip()
        display_name = (source.get("display_name") or "").strip()
        target = target_by_key.get(member_key) if member_key else None
        mapping_kind = "stable_key"
        if not target and not member_key:
            target = target_by_name.get(display_name)
            mapping_kind = "legacy_name"
        if not target:
            target = target_by_name.get(display_name)
            mapping_kind = "name_match_review" if target else "create_pending"
        if not target:
            if create_missing:
                now = datetime.now().isoformat(timespec="seconds")
                # Different families can import the same portable backup at
                # once. Allocate foreign keys independently even when the
                # source key does not yet exist in this database.
                target_key = (
                    member_key if payload.get("family_id") == family_id else None
                ) or uuid4().hex
                if conn.execute(
                    "SELECT 1 FROM family_members WHERE member_key = ?", (target_key,),
                ).fetchone():
                    target_key = uuid4().hex
                target_id = conn.execute(
                    """
                    INSERT INTO family_members
                    (member_key, family_id, display_name, role, created_at, updated_at)
                    VALUES (?, ?, ?, 'member', ?, ?) RETURNING id
                    """,
                    (target_key, family_id, display_name, now, now),
                ).fetchone()["id"]
                target = {
                    "id": target_id,
                    "member_key": target_key,
                    "display_name": display_name,
                }
                target_by_id[target_id] = target
                target_by_name[display_name] = target
                if member_key:
                    target_by_key[member_key] = target
            else:
                target = {
                    "id": next_preview_id,
                    "member_key": member_key,
                    "display_name": display_name,
                }
                next_preview_id -= 1
        member_mapping[source_id] = target["id"]
        mapping_report.append({
            "source_member_id": source_id,
            "member_key": member_key or None,
            "source_name": display_name,
            "target_member_id": target["id"] if target["id"] > 0 else None,
            "target_name": target["display_name"],
            "action": mapping_kind,
        })

    for rows in data.values():
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    row["family_id"] = family_id

    account_members = {}
    for row in data.get("accounts", []):
        member_id = member_mapping.get(row.get("member_id"))
        if member_id is None:
            raise HTTPException(
                status_code=422,
                detail=f"备份无效：账户“{row.get('name', '')}”缺少可识别的成员映射",
            )
        row["member_id"] = member_id
        target = target_by_id.get(member_id)
        if target:
            row["owner"] = target["display_name"]
        else:
            source = source_members.get(next(
                source_id for source_id, target_id in member_mapping.items()
                if target_id == member_id
            ))
            row["owner"] = source["display_name"]
        account_members[row.get("id")] = member_id

    for table in ("transactions", "investment_trades"):
        for row in data.get(table, []):
            row["member_id"] = account_members.get(row.get("account_id"))
            if row["member_id"] is None:
                raise HTTPException(status_code=422, detail=f"备份无效：{table} 缺少账户成员映射")
    for row in data.get("holdings", []):
        if row.get("account_id") is not None:
            row["member_id"] = account_members.get(row["account_id"])
        elif row.get("member_id") in member_mapping:
            row["member_id"] = member_mapping[row["member_id"]]
        else:
            row["member_id"] = None
        if row["member_id"] is None:
            raise HTTPException(status_code=422, detail="备份无效：holdings 缺少成员映射")
    for row in data.get("goals", []):
        row["member_id"] = None
    for row in data.get("goal_allocations", []):
        if row.get("member_id") not in member_mapping:
            raise HTTPException(status_code=422, detail="备份无效：目标分配缺少成员映射")
        row["member_id"] = member_mapping[row["member_id"]]
    for row in data.get("goal_records", []):
        if row.get("member_id") not in member_mapping:
            raise HTTPException(status_code=422, detail="备份无效：目标记录缺少成员映射")
        row["member_id"] = member_mapping[row["member_id"]]
    for row in data.get("budgets", []):
        row["member_id"] = None
    for row in data.get("budget_member_allocations", []):
        if row.get("member_id") not in member_mapping:
            raise HTTPException(status_code=422, detail="备份无效：预算分配缺少成员映射")
        row["member_id"] = member_mapping[row["member_id"]]
    for row in data.get("budget_category_allocations", []):
        if row.get("member_id") not in member_mapping:
            raise HTTPException(status_code=422, detail="备份无效：分类责任分配缺少成员映射")
        row["member_id"] = member_mapping[row["member_id"]]
    for row in data.get("snapshots", []):
        if row.get("member_id") is not None:
            if row["member_id"] not in member_mapping:
                raise HTTPException(status_code=422, detail="备份无效：snapshots 缺少成员映射")
            row["member_id"] = member_mapping[row["member_id"]]
    for row in data.get("audit_events", []):
        if row.get("member_id") is not None:
            if row["member_id"] not in member_mapping:
                raise HTTPException(status_code=422, detail="备份无效：操作审计缺少成员映射")
            row["member_id"] = member_mapping[row["member_id"]]
        row["actor_user_id"] = None
    normalized["family_id"] = family_id
    normalized["member_mapping"] = mapping_report
    return normalized


def validate_backup(conn, payload):
    def invalid(message):
        raise HTTPException(status_code=422, detail=f"备份无效：{message}")

    payload = deepcopy(payload)
    _decode_backup_numbers(payload)
    if payload.get("format") != "invest-backup" or payload.get("version") not in SUPPORTED_BACKUP_VERSIONS:
        invalid("格式或版本不支持")
    if payload.get("base_currency") != BASE_CURRENCY:
        invalid("本位币不一致")
    data = payload.get("data")
    if not isinstance(data, dict) or set(data) != set(FINANCIAL_TABLES):
        invalid("必须包含全部财务表")
    ids = {}
    for table in FINANCIAL_TABLES:
        rows = data[table]
        if not isinstance(rows, list):
            invalid(f"{table} 必须是记录列表")
        columns = {col["name"]: col for col in table_columns(conn, table)}
        ids[table] = set()
        for row in rows:
            if not isinstance(row, dict) or not row or set(row) - set(columns):
                invalid(f"{table} 含未知字段")
            row_id = row.get("id")
            if type(row_id) is not int or row_id <= 0 or row_id in ids[table]:
                invalid(f"{table} ID 无效或重复")
            ids[table].add(row_id)
            for name, col in columns.items():
                if col["required"] and row.get(name) is None and (name in row or col["default_value"] is None):
                    invalid(f"{table}.{name} 不能为空")
            for key, value in row.items():
                if value is None:
                    continue
                kind = columns[key]["type"].lower()
                if "int" in kind:
                    if type(value) is not int:
                        invalid(f"{table}.{key} 必须为整数")
                elif any(part in kind for part in ("real", "double", "numeric")):
                    if (
                        type(value) not in (int, float, Decimal)
                        or not decimal_value(value).is_finite()
                    ):
                        invalid(f"{table}.{key} 必须为有限数值")
                elif not isinstance(value, str):
                    invalid(f"{table}.{key} 必须为文本")
    for table, fields in BUSINESS_DATE_COLUMNS.items():
        for row in data[table]:
            for field, nullable in fields.items():
                value = row.get(field)
                if value is None and nullable:
                    continue
                try:
                    if canonical_business_date(value) != value:
                        invalid(f"{table}.{field} 必须是 YYYY-MM-DD")
                except (TypeError, ValueError):
                    invalid(f"{table}.{field} 必须是 YYYY-MM-DD")
    try:
        validate_persisted_financial_rows(data)
    except PersistedRecordViolation as exc:
        invalid(str(exc))
    history_rows = {}
    for row in data["transactions"]:
        history_rows.setdefault(row.get("account_id"), []).append(row)
    trade_rows = {}
    for row in data["investment_trades"]:
        trade_rows.setdefault(row.get("account_id"), []).append(row)
    for event in data["audit_events"]:
        if event.get("payload_version", 0) < 0:
            invalid("审计载荷版本无效")
    for account in data["accounts"]:
        basis = account.get("history_basis", "unknown")
        if basis not in HISTORY_BASES:
            invalid("账户历史基线类型无效")
        reconciliation = reconstruct_account_state(
            account,
            history_rows.get(account["id"], []),
            trade_rows.get(account["id"], []),
        )
        if not reconciliation["application"]["balance_application_consistent"]:
            issue = next(
                item for item in reconciliation["application"]["issues"]
                if item["requires_correction"]
            )
            invalid(
                "流水余额应用标记与建账日期不一致"
                f"（account_id={account.get('id')}，"
                f"transaction_id={issue['transaction_id']}，"
                f"occurred_at={issue['occurred_at']}，"
                f"actual={int(issue['actual_balance_applied'])}，"
                f"expected={int(issue['expected_balance_applied'])}，"
                f"amount={decimal_text(issue['amount'])}）"
            )
        if basis != "unknown":
            if reconciliation["history"]["status"] != "complete":
                invalid("账户历史基线缺少对应期初事实")
            if not reconciliation["matches"]:
                invalid(
                    "账户余额与可重建历史不一致"
                    f"（account_id={account.get('id')}，"
                    f"{reconciliation['state_field']}="
                    f"{decimal_text(reconciliation['actual'])}，"
                    f"expected={decimal_text(reconciliation['expected'])}）"
                )
    references = [
        (table, field, parent)
        for table, fields in FOREIGN_KEYS.items()
        for field, parent in fields.items()
    ] + [("categories", "parent_id", "categories")]
    for table, field, parent in references:
        if any(row.get(field) is not None and row[field] not in ids[parent] for row in data[table]):
            invalid(f"{table}.{field} 引用不存在的记录")
    for table, keys in [
        ("budget_plans", ("month",)),
        ("budgets", ("month", "category_id")),
        ("budget_category_allocations", ("budget_plan_id", "category_id", "member_id")),
        ("budget_member_allocations", ("budget_plan_id", "member_id")),
        ("goal_allocations", ("goal_id", "member_id")),
        ("snapshots", ("snapshot_date",)),
    ]:
        values = [
            (row.get("member_id"), *(row.get(key) for key in keys))
            for row in data[table]
        ]
        if len(set(values)) != len(values):
            invalid(f"{table} 存在重复记录")
    budgets_by_month = {}
    for row in data["budgets"]:
        budgets_by_month.setdefault((row["family_id"], row["month"]), 0)
        budgets_by_month[(row["family_id"], row["month"])] += row["amount"]
    allocations_by_plan = {}
    for row in data["budget_member_allocations"]:
        allocations_by_plan.setdefault(row["budget_plan_id"], 0)
        allocations_by_plan[row["budget_plan_id"]] += row["amount"]
    category_allocations = {}
    member_category_allocations = {}
    plan_by_id = {plan["id"]: plan for plan in data["budget_plans"]}
    budget_keys = {
        (row["family_id"], row["month"], row["category_id"])
        for row in data["budgets"]
    }
    for row in data["budget_category_allocations"]:
        plan = plan_by_id.get(row["budget_plan_id"])
        if not plan or (
            plan["family_id"],
            plan["month"],
            row["category_id"],
        ) not in budget_keys:
            invalid("分类责任分配未关联对应的分类预算")
        category_key = (row["budget_plan_id"], row["category_id"])
        category_allocations[category_key] = (
            category_allocations.get(category_key, 0) + row["amount"]
        )
        member_key = (row["budget_plan_id"], row["member_id"])
        member_category_allocations[member_key] = (
            member_category_allocations.get(member_key, 0) + row["amount"]
        )
    for plan in data["budget_plans"]:
        category_total = budgets_by_month.get((plan["family_id"], plan["month"]), 0)
        member_total = allocations_by_plan.get(plan["id"], 0)
        has_category_budgets = (plan["family_id"], plan["month"]) in budgets_by_month
        if has_category_budgets and not money_equal(
            category_total,
            plan["total_amount"],
        ):
            invalid("分类预算合计与月度总预算不一致")
        if not money_equal(member_total, plan["total_amount"]):
            invalid("成员预算分配合计与月度总预算不一致")
    for row in data["budgets"]:
        plan = next(
            (
                item for item in data["budget_plans"]
                if item["family_id"] == row["family_id"] and item["month"] == row["month"]
            ),
            None,
        )
        allocated = category_allocations.get(
            (plan["id"], row["category_id"]) if plan else (None, row["category_id"]),
            0,
        )
        if not money_equal(allocated, row["amount"]):
            invalid("分类成员承担合计与分类预算不一致")
    for row in data["budget_member_allocations"]:
        plan = plan_by_id.get(row["budget_plan_id"])
        if plan and (plan["family_id"], plan["month"]) not in budgets_by_month:
            continue
        allocated = member_category_allocations.get(
            (row["budget_plan_id"], row["member_id"]),
            0,
        )
        if not money_equal(allocated, row["amount"]):
            invalid("成员预算汇总与分类责任明细不一致")
    goal_totals = {}
    for row in data["goal_allocations"]:
        totals = goal_totals.setdefault(row["goal_id"], [0, 0, 0])
        totals[0] += row["target_amount"]
        totals[1] += row["current_amount"]
        totals[2] += row["monthly_saving"]
    for goal in data["goals"]:
        totals = goal_totals.get(goal["id"], [0, 0, 0])
        expected = [goal["target_amount"], goal["current_amount"], goal["monthly_saving"]]
        if any(
            not money_equal(actual, target)
            for actual, target in zip(totals, expected)
        ):
            invalid("目标成员分配与家庭目标总量不一致")
    transfer_legs = {}
    for row in data["transactions"]:
        if row.get("source") == "transfer" and row.get("reference_id"):
            transfer_legs.setdefault(row["reference_id"], []).append(row)
    for row in data["transactions"]:
        if row.get("balance_applied", 1) not in (0, 1):
            invalid("流水余额标记无效")
        if row.get("base_amount") is None or row.get("exchange_rate_to_base", 0) <= 0:
            invalid("流水缺少历史汇率")
        if not money_equal(
            row["base_amount"],
            money(row["amount"]) * rate(row["exchange_rate_to_base"]),
        ) and not recipient_rounding_is_valid(
            row, transfer_legs.get(row.get("reference_id"), []),
        ):
            invalid("流水本位币金额与历史汇率不一致")
    return {table: len(data[table]) for table in FINANCIAL_TABLES}


def recovery_backup_directory(family_id):
    return Path(database.DB_DIR) / "backups" / f"family-{int(family_id)}"


def _payload_family_ids(payload):
    family_ids = set()
    if type(payload.get("family_id")) is int:
        family_ids.add(payload["family_id"])
    data = payload.get("data")
    if isinstance(data, dict):
        for rows in data.values():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict) and type(row.get("family_id")) is int:
                    family_ids.add(row["family_id"])
    return family_ids


def recovery_backup_path(filename, family_id):
    """Resolve a recovery copy only when its family ownership is provable."""
    family_path = recovery_backup_directory(family_id) / filename
    if family_path.is_file() and not family_path.is_symlink():
        return family_path

    legacy_path = Path(database.DB_DIR) / "backups" / filename
    if not legacy_path.is_file() or legacy_path.is_symlink():
        return None
    try:
        with legacy_path.open(encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, ValueError, TypeError):
        return None
    return legacy_path if _payload_family_ids(payload) == {int(family_id)} else None


@dataclass(frozen=True)
class PreparedRecovery:
    family_id: int
    fingerprint: str
    filename: str

    def discard(self):
        path = recovery_backup_directory(self.family_id) / self.filename
        path.unlink(missing_ok=True)


def prepare_family_restore(payload, expected_fingerprint):
    context = assert_family_admin()
    with consistent_read_connection() as conn:
        validate_backup(conn, normalize_backup_scope(conn, payload, context.family_id))
        before = snapshot(conn, context.family_id)
    if fingerprint(before) != expected_fingerprint:
        raise CommandError("BUSINESS_CONFLICT", "数据已变化，请重新预览备份后恢复")
    folder = recovery_backup_directory(context.family_id)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = f"before-restore-{uuid4().hex}.json"
    path = folder / filename
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(before, output, ensure_ascii=False, allow_nan=False)
            output.flush()
            os.fsync(output.fileno())
        directory = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return PreparedRecovery(context.family_id, expected_fingerprint, filename)


def restore(conn, payload, expected_fingerprint, *, prepared):
    context = assert_family_admin()
    if prepared.family_id != context.family_id or prepared.fingerprint != expected_fingerprint:
        raise CommandError("BUSINESS_CONFLICT", "恢复副本与当前请求不匹配")
    lock_family_write(conn, context.family_id)
    if fingerprint(snapshot(conn, context.family_id)) != expected_fingerprint:
        raise CommandError("BUSINESS_CONFLICT", "数据已变化，请重新预览备份后恢复")
    payload = normalize_backup_scope(
        conn,
        payload,
        context.family_id,
        create_missing=True,
    )
    counts = validate_backup(conn, payload)
    # Keep tombstones so a delayed retry cannot replay operations from the old book.
    conn.execute(
        """
        UPDATE financial_commands
        SET invalidated = 1,
            status = 'invalidated',
            response = NULL,
            invalidated_at = ?,
            updated_at = ?
        WHERE family_id = ? AND status IN ('processing', 'committed', 'expired')
          AND command_key <> ?
        """,
        (
            datetime.now().isoformat(timespec="seconds"),
            datetime.now().isoformat(timespec="seconds"),
            context.family_id,
            current_command_key() or "",
        ),
    )
    for table in reversed(FINANCIAL_TABLES):
        conn.execute(f"DELETE FROM {table} WHERE family_id = ?", (context.family_id,))
    mapping = insert_restored_rows(conn, payload)
    for table in FINANCIAL_TABLES:
        count = conn.execute(
            f"SELECT COUNT(*) AS count FROM {table} WHERE family_id = ?",
            (context.family_id,),
        ).fetchone()["count"]
        if count != counts[table]:
            raise RuntimeError(f"{table}: restore count mismatch")
    return {
        "message": "备份已恢复",
        "counts": counts,
        "member_mapping": payload.get("member_mapping", []),
        "snapshot_compatibility": payload.get("snapshot_compatibility", {}),
        "recovery_backup": prepared.filename,
        "id_mapping": mapping["ids"],
        "transfer_reference_mapping": mapping["transfer_references"],
    }


def export_family_backup():
    with consistent_read_connection() as conn:
        context = get_auth_context(conn)
        return snapshot(conn, context.family_id)


def preview_family_restore(payload):
    context = assert_family_admin()
    with consistent_read_connection() as conn:
        normalized = normalize_backup_scope(conn, payload, context.family_id)
        counts = validate_backup(conn, normalized)
        current = snapshot(conn, context.family_id)
        return {
            "counts": counts,
            "current_counts": {
                table: len(rows)
                for table, rows in current["data"].items()
            },
            "expected_fingerprint": fingerprint(current),
            "member_mapping": normalized.get("member_mapping", []),
            "snapshot_compatibility": normalized.get(
                "snapshot_compatibility",
                {},
            ),
        }


def restore_family_backup(payload, expected_fingerprint, *, prepared):
    context = assert_family_admin()
    conn = current_command_connection()
    result = restore(conn, payload, expected_fingerprint, prepared=prepared)
    record_audit_event(
        conn, "恢复家庭账本", "family", context.family_id,
        summary="从 JSON 备份恢复家庭账本", context=context,
    )
    snapshots = refresh_family_warehouse_snapshots(conn, context)
    result["snapshot"] = snapshots[0]
    return result


def resolve_family_recovery_backup(filename):
    context = assert_family_admin()
    if not re.fullmatch(r"before-restore-[a-f0-9]{32}\.json", filename):
        raise HTTPException(status_code=404, detail="备份不存在")
    path = recovery_backup_path(filename, context.family_id)
    if path is None:
        raise HTTPException(status_code=404, detail="备份不存在")
    return path
