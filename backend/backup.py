"""Versioned, validated whole-book backup and transactional restore."""
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

import database
from database import BASE_CURRENCY, FINANCIAL_TABLES, is_postgres_connection, rows_to_dicts


def snapshot(conn):
    return {
        "format": "invest-backup", "version": 1, "base_currency": BASE_CURRENCY,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "data": {
            table: rows_to_dicts(conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall())
            for table in FINANCIAL_TABLES
        },
    }


def fingerprint(payload):
    canonical = json.dumps(payload["data"], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
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


def validate_backup(conn, payload):
    def invalid(message):
        raise HTTPException(status_code=422, detail=f"备份无效：{message}")

    if payload.get("format") != "invest-backup" or payload.get("version") != 1:
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
                    if type(value) not in (int, float) or not math.isfinite(value):
                        invalid(f"{table}.{key} 必须为有限数值")
                elif not isinstance(value, str):
                    invalid(f"{table}.{key} 必须为文本")
    for table, field, parent in [
        ("transactions", "account_id", "accounts"),
        ("transactions", "category_id", "categories"),
        ("holdings", "account_id", "accounts"),
        ("investment_trades", "account_id", "accounts"),
        ("investment_trades", "holding_id", "holdings"),
        ("budgets", "category_id", "categories"),
        ("goal_records", "goal_id", "goals"),
    ]:
        if any(row.get(field) is not None and row[field] not in ids[parent] for row in data[table]):
            invalid(f"{table}.{field} 引用不存在的记录")
    for table, keys in [("budgets", ("month", "category_id")), ("snapshots", ("snapshot_date",))]:
        values = [tuple(row.get(key) for key in keys) for row in data[table]]
        if len(set(values)) != len(values):
            invalid(f"{table} 存在重复记录")
    for row in data["transactions"]:
        if row["direction"] not in {"income", "expense"} or row["amount"] <= 0:
            invalid("流水方向或金额无效")
        if row.get("balance_applied", 1) not in (0, 1):
            invalid("流水余额标记无效")
        if row.get("base_amount") is None or row.get("exchange_rate_to_base", 0) <= 0:
            invalid("流水缺少历史汇率")
        if not math.isclose(row["base_amount"], row["amount"] * row["exchange_rate_to_base"], abs_tol=0.011):
            invalid("流水本位币金额与历史汇率不一致")
    return {table: len(data[table]) for table in FINANCIAL_TABLES}


def restore(conn, payload, expected_fingerprint):
    if is_postgres_connection(conn):
        conn.execute("LOCK TABLE financial_commands, " + ", ".join(FINANCIAL_TABLES) + " IN ACCESS EXCLUSIVE MODE")
    counts = validate_backup(conn, payload)
    before = snapshot(conn)
    if fingerprint(before) != expected_fingerprint:
        raise HTTPException(status_code=409, detail="数据已变化，请重新预览备份后恢复")
    # Keep tombstones so a delayed retry cannot replay operations from the old book.
    conn.execute("UPDATE financial_commands SET invalidated = 1 WHERE response IS NOT NULL")
    # A retained recovery file is written before changing any row.
    folder = Path(database.DB_DIR) / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"before-restore-{uuid4().hex}.json"
    with (folder / filename).open("x", encoding="utf-8") as output:
        (folder / filename).chmod(0o600)
        json.dump(before, output, ensure_ascii=False, allow_nan=False)
    for table in reversed(FINANCIAL_TABLES):
        conn.execute(f"DELETE FROM {table}")
    for table in FINANCIAL_TABLES:
        for row in payload["data"][table]:
            fields = list(row)
            quoted = ", ".join(f'"{field}"' for field in fields)
            placeholders = ", ".join("?" for _ in fields)
            conn.execute(
                f'INSERT INTO {table} ({quoted}) VALUES ({placeholders}) RETURNING id',
                tuple(row[field] for field in fields),
            ).fetchone()
        count = conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"]
        if count != counts[table]:
            raise RuntimeError(f"{table}: restore count mismatch")
    if is_postgres_connection(conn):
        for table in FINANCIAL_TABLES:
            conn.execute(
                f"SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table}",
                (table,),
            )
    return {"message": "备份已恢复", "counts": counts, "recovery_backup": filename}
