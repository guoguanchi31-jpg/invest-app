import csv
import hashlib
from datetime import datetime
from io import StringIO

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from accounting import affects_balance, apply_account_balance_delta
from commands import financial_command
from database import BASE_CURRENCY, get_category_visual, get_connection, lock_row, rows_to_dicts, write_connection
from schemas import StatementImportPayload, StatementImportRow, TransactionCreate
from services import get_expense_analysis, get_income_analysis, get_recent_transactions, month_range


router = APIRouter(tags=["transactions"])


def get_or_create_category(conn, name, category_type):
    if not name:
        return None
    existing = conn.execute(
        "SELECT id FROM categories WHERE name = ? AND type = ? AND is_active = 1",
        (name, category_type),
    ).fetchone()
    if existing:
        return existing["id"]
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM categories WHERE type = ?",
        (category_type,),
    ).fetchone()["sort_order"]
    icon, color = get_category_visual(name, category_type)
    cursor = conn.execute(
        "INSERT INTO categories (name, type, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)",
        (name, category_type, icon, color, max_order + 1),
    )
    return cursor.lastrowid


def get_active_account(conn, account_id):
    account = conn.execute(
        """
        SELECT id, type, is_liability, is_active, currency, exchange_rate_to_base, opened_at
        FROM accounts WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="账户不存在")
    if not account["is_active"]:
        raise HTTPException(status_code=409, detail="已停用账户不能记录流水")
    return account


def transaction_money(account, amount):
    exchange_rate = account["exchange_rate_to_base"] or 1
    return account["currency"] or "CNY", exchange_rate, amount * exchange_rate


def updated_transaction_money(old, account, transaction):
    if old["account_id"] != transaction.account_id:
        return (*transaction_money(account, transaction.amount), "captured")
    if old["base_amount"] is None or old["exchange_rate_to_base"] is None:
        raise HTTPException(
            status_code=409,
            detail="该历史流水缺少发生时汇率，请先完成历史汇率迁移",
        )
    base_amount = old["base_amount"]
    if old["amount"] != transaction.amount:
        base_amount = transaction.amount * old["exchange_rate_to_base"]
    return (
        old["currency"],
        old["exchange_rate_to_base"],
        base_amount,
        old["fx_status"],
    )


def validate_category(conn, category_id, direction):
    if not category_id:
        return
    category = conn.execute(
        "SELECT type, is_active FROM categories WHERE id = ?",
        (category_id,),
    ).fetchone()
    if not category:
        raise HTTPException(status_code=404, detail="流水分类不存在")
    if not category["is_active"] or category["type"] != direction:
        raise HTTPException(status_code=409, detail="流水分类与收支方向不匹配或已停用")


def query_ledger(
    month=None,
    account_id=None,
    owner=None,
    direction=None,
    source=None,
    category_id=None,
    date_from=None,
    date_to=None,
    search=None,
):
    clauses = ["1 = 1"]
    params = []
    if month:
        clauses.append("substr(t.occurred_at, 1, 7) = ?")
        params.append(month)
    if account_id:
        clauses.append("t.account_id = ?")
        params.append(account_id)
    if owner:
        clauses.append("a.owner = ?")
        params.append(owner)
    if direction in {"income", "expense"}:
        clauses.append("t.direction = ?")
        params.append(direction)
    if source and source != "all":
        clauses.append("COALESCE(t.source, 'manual') = ?")
        params.append(source)
    if category_id:
        clauses.append("t.category_id = ?")
        params.append(category_id)
    if date_from:
        clauses.append("t.occurred_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("t.occurred_at <= ?")
        params.append(date_to)
    if search:
        clauses.append(
            """
            (
                LOWER(COALESCE(t.merchant, '')) LIKE ?
                OR LOWER(COALESCE(t.note, '')) LIKE ?
                OR LOWER(COALESCE(c.name, '')) LIKE ?
                OR LOWER(COALESCE(a.name, '')) LIKE ?
                OR LOWER(COALESCE(a.owner, '')) LIKE ?
            )
            """
        )
        keyword = f"%{search.strip().lower()}%"
        params.extend([keyword] * 5)

    conn = get_connection()
    rows = rows_to_dicts(conn.execute(
        f"""
        WITH matched AS (
            SELECT t.id, t.reference_id FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE {" AND ".join(clauses)}
        )
        SELECT
            t.*, a.name AS account_name, a.owner AS account_owner,
            c.name AS category_name, c.icon, c.color
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id IN (SELECT id FROM matched)
           OR (t.source = 'transfer' AND t.reference_id IN (SELECT reference_id FROM matched))
        ORDER BY t.occurred_at DESC, t.id DESC
        """,
        tuple(params),
    ).fetchall())
    conn.close()

    ledger = []
    transfer_groups = {}
    for row in rows:
        item = {
            **row,
            "source": row.get("source") or "manual",
            "kind": row.get("source") or "manual",
        }
        if item["source"] == "transfer" and not item.get("reference_id"):
            prefix = "from" if item["direction"] == "expense" else "to"
            item[f"{prefix}_account_id"] = item["account_id"]
            item[f"{prefix}_account_name"] = item["account_name"]
            item[f"{prefix}_account_owner"] = item["account_owner"]
        if item["source"] != "transfer" or not item.get("reference_id"):
            ledger.append(item)
            continue
        transfer_groups.setdefault(item["reference_id"], []).append(item)

    for reference_id, legs in transfer_groups.items():
        outgoing = next((item for item in legs if item["direction"] == "expense"), None)
        incoming = next((item for item in legs if item["direction"] == "income"), None)
        anchor = outgoing or incoming
        ledger.append({
            "id": f"transfer:{reference_id}",
            "reference_id": reference_id,
            "source": "transfer",
            "kind": "transfer",
            "direction": "transfer",
            "occurred_at": anchor["occurred_at"],
            "amount": outgoing["amount"] if outgoing else anchor["amount"],
            "base_amount": anchor["base_amount"],
            "currency": outgoing["currency"] if outgoing else anchor["currency"],
            "merchant": "资金划转",
            "note": anchor.get("note"),
            "account_id": outgoing["account_id"] if outgoing else None,
            "account_name": outgoing["account_name"] if outgoing else None,
            "account_owner": outgoing["account_owner"] if outgoing else None,
            "from_account_id": outgoing["account_id"] if outgoing else None,
            "from_account_name": outgoing["account_name"] if outgoing else None,
            "from_account_owner": outgoing["account_owner"] if outgoing else None,
            "to_account_id": incoming["account_id"] if incoming else None,
            "to_account_name": incoming["account_name"] if incoming else None,
            "to_account_owner": incoming["account_owner"] if incoming else None,
            "legs": legs,
            "voided_at": anchor.get("voided_at"),
            "void_reason": anchor.get("void_reason"),
        })
    return sorted(
        ledger,
        key=lambda item: (item.get("occurred_at") or "", str(item.get("id") or "")),
        reverse=True,
    )


def statement_import_reference(row: StatementImportRow):
    raw = (
        f"{row.account_id}|external|{row.external_id.strip()}"
        if row.external_id
        else "|".join([
            str(row.account_id),
            row.occurred_at,
            row.direction,
            f"{row.amount:.6f}",
            (row.merchant or "").strip().lower(),
        ])
    )
    return f"import-{hashlib.sha256(raw.encode()).hexdigest()[:24]}"


def import_money(account, row):
    currency = (row.currency or account["currency"]).strip().upper()
    if currency != account["currency"]:
        raise HTTPException(status_code=409, detail="导入币种与账户币种不一致")
    rate = row.exchange_rate_to_base
    if rate is None:
        if currency != BASE_CURRENCY:
            raise HTTPException(status_code=409, detail="外币账单必须提供发生时汇率")
        rate = 1
    if currency == BASE_CURRENCY and rate != 1:
        raise HTTPException(status_code=409, detail="本位币汇率必须为 1")
    return currency, rate, row.amount * rate


def find_statement_duplicate(conn, row: StatementImportRow):
    if row.external_id:
        exact = conn.execute(
            "SELECT id, note, 'exact' AS duplicate_kind FROM transactions WHERE reference_id = ? LIMIT 1",
            (statement_import_reference(row),),
        ).fetchone()
        if exact:
            return exact
    return conn.execute(
        """
        SELECT id, note, 'suspected' AS duplicate_kind
        FROM transactions
        WHERE account_id = ?
          AND direction = ?
          AND occurred_at = ?
          AND ABS(amount - ?) < 0.000001
          AND LOWER(TRIM(COALESCE(merchant, ''))) = LOWER(TRIM(?))
          AND COALESCE(source, 'manual') = 'manual'
          AND voided_at IS NULL
        LIMIT 1
        """,
        (
            row.account_id,
            row.direction,
            row.occurred_at,
            row.amount,
            row.merchant or "",
        ),
    ).fetchone()


@router.get("/transactions/recent")
def recent_transactions(limit: int = 5):
    return get_recent_transactions(limit)


@router.get("/ledger")
def list_ledger(
    month: str | None = None,
    account_id: int | None = None,
    owner: str | None = None,
    direction: str | None = None,
    source: str | None = None,
    category_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
):
    return query_ledger(
        month=month,
        account_id=account_id,
        owner=owner,
        direction=direction,
        source=source,
        category_id=category_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )


@router.get("/ledger/export")
def export_ledger():
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "日期",
        "类型",
        "所属人",
        "账户",
        "转入账户",
        "分类",
        "金额",
        "币种",
        "本位币金额",
        "商户/来源",
        "备注",
        "方向", "账户ID", "汇率", "流水号", "来源", "状态", "影响余额", "关联编号",
    ])
    source_labels = {
        "manual": "收支",
        "transfer": "转账",
        "opening": "期初余额",
        "adjustment": "余额调整",
    }
    conn = get_connection()
    rows = rows_to_dicts(conn.execute("""
        SELECT t.*, a.name AS account_name, a.owner AS account_owner,
               c.name AS category_name
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        ORDER BY t.occurred_at DESC, t.id DESC
    """).fetchall())
    conn.close()
    for item in rows:
        direction = "收入" if item["direction"] == "income" else "支出"
        writer.writerow([
            item.get("occurred_at"),
            direction if (item.get("source") or "manual") == "manual"
            else source_labels.get(item.get("source"), item.get("source")),
            item.get("account_owner") or item.get("from_account_owner"),
            item.get("account_name") or item.get("from_account_name"),
            item.get("to_account_name"),
            item.get("category_name"),
            item.get("amount"),
            item.get("currency"),
            item.get("base_amount"),
            item.get("merchant"),
            item.get("note"),
            direction, item["account_id"], item["exchange_rate_to_base"],
            f"invest-transaction-{item['id']}", item.get("source") or "manual",
            "已撤销" if item.get("voided_at") else "有效",
            item["balance_applied"], item.get("reference_id"),
        ])
    content = "\ufeff" + output.getvalue()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="invest-ledger.csv"'},
    )


@router.post("/transactions/import/preview")
def preview_statement_import(payload: StatementImportPayload):
    conn = get_connection()
    result = []
    duplicate_count = 0
    seen_references = set()
    for index, row in enumerate(payload.rows):
        account = conn.execute(
            "SELECT * FROM accounts WHERE id = ?",
            (row.account_id,),
        ).fetchone()
        if not account or not account["is_active"]:
            conn.close()
            raise HTTPException(status_code=409, detail=f"第 {index + 1} 行账户不存在或已停用")
        reference_id = statement_import_reference(row)
        try:
            import_money(account, row)
        except HTTPException:
            conn.close()
            raise
        duplicate = find_statement_duplicate(conn, row)
        duplicated_in_file = reference_id in seen_references
        seen_references.add(reference_id)
        is_duplicate = bool(duplicate) or duplicated_in_file
        duplicate_count += int(is_duplicate)
        result.append({
            "row_index": index,
            "account_name": account["name"],
            "account_owner": account["owner"],
            "duplicate": is_duplicate,
            "duplicate_kind": "exact" if duplicated_in_file and row.external_id else duplicate["duplicate_kind"] if duplicate else "suspected" if duplicated_in_file else None,
            "balance_applied": affects_balance(account, row.occurred_at),
            "opened_at": account["opened_at"],
            "matched_note": dict(duplicate).get("note") if duplicate else None,
            "duplicate_in_file": duplicated_in_file,
            "matched_transaction_id": duplicate["id"] if duplicate else None,
            **row.model_dump(),
        })
    conn.close()
    return {
        "total": len(result),
        "duplicates": duplicate_count,
        "ready": len(result) - duplicate_count,
        "rows": result,
    }


@router.post("/transactions/import")
@financial_command
def import_statement_transactions(payload: StatementImportPayload):
    if not payload.rows:
        raise HTTPException(status_code=409, detail="账单中没有可导入的流水")
    now = datetime.now().isoformat(timespec="seconds")
    imported = 0
    skipped = 0
    historical = 0
    with write_connection() as conn:
        # Lock in a stable order so two concurrent imports cannot both miss a duplicate.
        for account_id in sorted({row.account_id for row in payload.rows}):
            lock_row(conn, "accounts", account_id)
        for row in payload.rows:
            if row.decision == "skip":
                skipped += 1
                continue
            duplicate = find_statement_duplicate(conn, row)
            if duplicate and (duplicate["duplicate_kind"] == "exact" or (payload.skip_duplicates and row.decision != "import")):
                skipped += 1
                continue
            account = get_active_account(conn, row.account_id)
            category_id = get_or_create_category(conn, row.category_name, row.direction)
            currency, exchange_rate, base_amount = import_money(account, row)
            balance_applied = int(affects_balance(account, row.occurred_at))
            conn.execute(
                """
                INSERT INTO transactions
                (account_id, category_id, amount, currency, exchange_rate_to_base,
                 base_amount, fx_status, direction, occurred_at, merchant, note,
                 source, reference_id, created_at, updated_at, balance_applied)
                VALUES (?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
                """,
                (
                    row.account_id,
                    category_id,
                    row.amount,
                    currency,
                    exchange_rate,
                    base_amount,
                    row.direction,
                    row.occurred_at,
                    row.merchant,
                    row.note,
                    statement_import_reference(row),
                    now,
                    now,
                    balance_applied,
                ),
            )
            if balance_applied:
                apply_account_balance_delta(conn, account, row.direction, row.amount, now)
            else:
                historical += 1
            imported += 1
    return {
        "message": f"已导入 {imported} 笔流水",
        "imported": imported,
        "skipped": skipped,
        "historical": historical,
    }


@router.get("/transactions")
def list_transactions(month: str | None = None, range_key: str = "month"):
    conn = get_connection()
    if month:
        months = month_range(month, range_key)
        placeholders = ",".join("?" for _ in months)
        rows = conn.execute(
            f"""
            SELECT t.*, a.name AS account_name, a.owner AS account_owner, c.name AS category_name, c.icon, c.color
            FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE substr(t.occurred_at, 1, 7) IN ({placeholders})
              AND COALESCE(t.source, 'manual') = 'manual'
              AND t.voided_at IS NULL
            ORDER BY t.occurred_at DESC
            """,
            tuple(months),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT t.*, a.name AS account_name, a.owner AS account_owner, c.name AS category_name, c.icon, c.color
            FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE COALESCE(t.source, 'manual') = 'manual'
              AND t.voided_at IS NULL
            ORDER BY t.occurred_at DESC
            """
        ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


@router.post("/transactions")
@financial_command
def create_transaction(transaction: TransactionCreate):
    now = datetime.now().isoformat(timespec="seconds")
    with write_connection() as conn:
        lock_row(conn, "accounts", transaction.account_id)
        account = get_active_account(conn, transaction.account_id)
        validate_category(conn, transaction.category_id, transaction.direction)
        category_id = transaction.category_id or get_or_create_category(
            conn, transaction.category_name, transaction.direction,
        )
        currency, exchange_rate, base_amount = transaction_money(account, transaction.amount)
        applied = int(affects_balance(account, transaction.occurred_at))
        cursor = conn.execute(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
             fx_status, direction, occurred_at, merchant, note, created_at, updated_at, balance_applied)
            VALUES (?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                transaction.account_id, category_id, transaction.amount, currency,
                exchange_rate, base_amount, transaction.direction, transaction.occurred_at,
                transaction.merchant, transaction.note, now, now, applied,
            ),
        )
        if applied:
            apply_account_balance_delta(conn, account, transaction.direction, transaction.amount, now)
        transaction_id = cursor.lastrowid
    return {"id": transaction_id, "message": "流水已创建", "balance_applied": bool(applied)}


@router.patch("/transactions/{transaction_id}")
@financial_command
def update_transaction(transaction_id: int, transaction: TransactionCreate):
    now = datetime.now().isoformat(timespec="seconds")
    with write_connection() as conn:
        old = lock_row(conn, "transactions", transaction_id)
        if not old:
            raise HTTPException(status_code=404, detail="流水不存在")
        if (old["source"] or "manual") != "manual" or old["voided_at"]:
            raise HTTPException(status_code=409, detail="该记录不能按普通收支修改")
        for account_id in sorted({old["account_id"], transaction.account_id}):
            lock_row(conn, "accounts", account_id)
        old_account = get_active_account(conn, old["account_id"])
        account = get_active_account(conn, transaction.account_id)
        validate_category(conn, transaction.category_id, transaction.direction)
        # Preserve the recorded effect on note-only edits, including legacy records.
        applied = old["balance_applied"]
        if old["account_id"] != transaction.account_id or old["occurred_at"] != transaction.occurred_at:
            applied = int(affects_balance(account, transaction.occurred_at))
        changed = (
            old["account_id"] != transaction.account_id
            or old["direction"] != transaction.direction
            or old["amount"] != transaction.amount
            or applied != old["balance_applied"]
        )
        currency, rate, base_amount, fx_status = updated_transaction_money(old, account, transaction)
        category_id = transaction.category_id or get_or_create_category(
            conn, transaction.category_name, transaction.direction,
        )
        if changed and old["balance_applied"]:
            apply_account_balance_delta(
                conn, old_account, "expense" if old["direction"] == "income" else "income",
                old["amount"], now,
            )
        conn.execute(
            """
            UPDATE transactions
            SET account_id = ?, category_id = ?, amount = ?, currency = ?,
                exchange_rate_to_base = ?, base_amount = ?, fx_status = ?, direction = ?,
                occurred_at = ?, merchant = ?, note = ?, updated_at = ?, balance_applied = ?
            WHERE id = ?
            """,
            (
                transaction.account_id, category_id, transaction.amount, currency, rate,
                base_amount, fx_status, transaction.direction, transaction.occurred_at,
                transaction.merchant, transaction.note, now, applied, transaction_id,
            ),
        )
        if changed and applied:
            apply_account_balance_delta(conn, account, transaction.direction, transaction.amount, now)
    return {"message": "流水已更新"}


@router.delete("/transactions/{transaction_id}")
@financial_command
def delete_transaction(transaction_id: int):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    existing = lock_row(conn, "transactions", transaction_id)
    if not existing:
        raise HTTPException(status_code=404, detail="流水不存在")
    if (existing["source"] or "manual") != "manual":
        raise HTTPException(status_code=409, detail="期初、调整或划转记录不能按普通收支删除")
    account = lock_row(conn, "accounts", existing["account_id"])
    if not account:
        raise HTTPException(status_code=409, detail="关联账户不存在，不能删除流水")
    row = conn.execute(
        """
        DELETE FROM transactions
        WHERE id = ? AND COALESCE(source, 'manual') = 'manual'
        RETURNING *
        """,
        (transaction_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=409, detail="流水已被修改或删除，请刷新")
    if row["balance_applied"] and not row["voided_at"]:
        apply_account_balance_delta(
            conn, account, "expense" if row["direction"] == "income" else "income",
            row["amount"], now,
        )
    conn.commit()
    conn.close()
    return {"message": "流水已删除"}


@router.get("/expenses/analysis")
def expense_analysis(month: str | None = None, expense_range: str = "month", cashflow_range: str = "month"):
    return get_expense_analysis(month, expense_range, cashflow_range)


@router.get("/income/analysis")
def income_analysis(month: str | None = None, income_range: str = "month", trend_range: str = "month"):
    return get_income_analysis(month, income_range, trend_range)
