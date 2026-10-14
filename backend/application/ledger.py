import hashlib
from datetime import datetime

from fastapi import HTTPException

from domain.accounting import affects_balance
from domain.reconciliation import expected_transaction_application
from infrastructure.accounting_store import (
    apply_account_balance_changes,
    apply_account_balance_delta,
    assert_investment_cash_nonnegative,
)
from application.commands import AuditFact, command_result
from application.ledger_export import export_ledger
from infrastructure.read_models import consistent_query
from domain.catalog import get_category_visual
from infrastructure.database import (
    BASE_CURRENCY,
    lock_row,
)
from domain.money import decimal_value, money, money_equal, rate
from schemas import (
    StatementImportPayload,
    StatementImportRow,
    TransactionApplicationCorrection,
    TransactionCreate,
)
from queries.finance import (
    get_expense_analysis,
    get_income_analysis,
    get_ledger_monthly_overview,
    get_recent_transactions,
)
from queries.ledger import list_transactions, query_ledger
from tenancy import get_account_for_access, get_auth_context


def get_or_create_category(conn, context, name, category_type):
    if not name:
        return None
    existing = conn.execute(
        """
        SELECT id FROM categories
        WHERE family_id = ? AND name = ? AND type = ? AND is_active = 1
        """,
        (context.family_id, name, category_type),
    ).fetchone()
    if existing:
        return existing["id"]
    max_order = conn.execute(
        """
        SELECT COALESCE(MAX(sort_order), 0) AS sort_order
        FROM categories WHERE family_id = ? AND type = ?
        """,
        (context.family_id, category_type),
    ).fetchone()["sort_order"]
    icon, color = get_category_visual(name, category_type)
    cursor = conn.execute(
        """
        INSERT INTO categories
        (family_id, name, type, icon, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(family_id, name, type) DO NOTHING
        RETURNING id
        """,
        (context.family_id, name, category_type, icon, color, max_order + 1),
    )
    created = cursor.fetchone()
    if created:
        return created["id"]
    return conn.execute(
        """
        SELECT id FROM categories
        WHERE family_id = ? AND name = ? AND type = ?
        """,
        (context.family_id, name, category_type),
    ).fetchone()["id"]


def get_active_account(conn, context, account_id):
    return get_account_for_access(
        conn,
        account_id,
        write=True,
        active=True,
        context=context,
    )


def transaction_money(account, amount):
    exchange_rate = rate(account["exchange_rate_to_base"] or 1)
    amount = money(amount)
    return account["currency"] or "CNY", exchange_rate, money(amount * exchange_rate)


def updated_transaction_money(old, account, transaction):
    if old["account_id"] != transaction.account_id:
        return (*transaction_money(account, transaction.amount), "captured")
    if old["base_amount"] is None or old["exchange_rate_to_base"] is None:
        raise HTTPException(
            status_code=409,
            detail="该历史流水缺少发生时汇率，请先完成历史汇率迁移",
        )
    base_amount = money(old["base_amount"])
    if not money_equal(old["amount"], transaction.amount):
        base_amount = money(money(transaction.amount) * rate(old["exchange_rate_to_base"]))
    return (
        old["currency"],
        old["exchange_rate_to_base"],
        base_amount,
        old["fx_status"],
    )


def validate_category(conn, context, category_id, direction):
    if not category_id:
        return
    category = conn.execute(
        "SELECT type, is_active FROM categories WHERE id = ? AND family_id = ?",
        (category_id, context.family_id),
    ).fetchone()
    if not category:
        raise HTTPException(status_code=404, detail="流水分类不存在")
    if not category["is_active"] or category["type"] != direction:
        raise HTTPException(status_code=409, detail="流水分类与收支方向不匹配或已停用")


def statement_import_reference(row: StatementImportRow, account_namespace=None):
    namespace = account_namespace or str(row.account_id)
    raw = (
        f"{namespace}|external|{row.external_id.strip()}"
        if row.external_id
        else "|".join([
            namespace,
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
    exchange_rate = row.exchange_rate_to_base
    if exchange_rate is None:
        if currency != BASE_CURRENCY:
            raise HTTPException(status_code=409, detail="外币账单必须提供发生时汇率")
        exchange_rate = decimal_value(1)
    exchange_rate = rate(exchange_rate)
    if currency == BASE_CURRENCY and exchange_rate != 1:
        raise HTTPException(status_code=409, detail="本位币汇率必须为 1")
    return currency, exchange_rate, money(money(row.amount) * exchange_rate)


def find_statement_duplicate(conn, row: StatementImportRow):
    if row.external_id:
        account = conn.execute(
            "SELECT import_reference_namespace FROM accounts WHERE id = ?",
            (row.account_id,),
        ).fetchone()
        exact = conn.execute(
            "SELECT id, note, 'exact' AS duplicate_kind FROM transactions "
            "WHERE account_id = ? AND reference_id = ? LIMIT 1",
            (
                row.account_id,
                statement_import_reference(row, account["import_reference_namespace"] if account else None),
            ),
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


def recent_transactions(limit: int = 5):
    return get_recent_transactions(limit)


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
    page: int | None = None,
    page_size: int = 30,
    record_scope: str = "effective",
):
    if page is not None and page < 1:
        raise HTTPException(status_code=422, detail="页码必须大于零")
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
        page=page,
        page_size=page_size,
        record_scope=record_scope,
    )


@consistent_query
def preview_statement_import(payload: StatementImportPayload, *, conn=None):
    context = get_auth_context(conn)
    result = []
    duplicate_count = 0
    seen_references = set()
    for index, row in enumerate(payload.rows):
        try:
            account = get_account_for_access(
                conn,
                row.account_id,
                write=True,
                active=True,
                context=context,
            )
        except HTTPException as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=f"第 {index + 1} 行账户不存在、已停用或无权操作",
            ) from exc
        reference_id = statement_import_reference(row)
        import_money(account, row)
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
    return {
        "total": len(result),
        "duplicates": duplicate_count,
        "ready": len(result) - duplicate_count,
        "rows": result,
    }


def import_statement_transactions(conn, context, payload: StatementImportPayload):
    if not payload.rows:
        raise HTTPException(status_code=409, detail="账单中没有可导入的流水")
    now = datetime.now().isoformat(timespec="seconds")
    imported = 0
    skipped = 0
    historical = 0
    account_ids = []
    member_ids = []
    balance_changes = []
    # Lock in a stable order so two concurrent imports cannot both miss a duplicate.
    for account_id in sorted({row.account_id for row in payload.rows}):
        lock_row(conn, "accounts", account_id)
    for row in payload.rows:
        if row.decision == "skip":
            skipped += 1
            continue
        duplicate = find_statement_duplicate(conn, row)
        if duplicate and (
            duplicate["duplicate_kind"] == "exact"
            or (payload.skip_duplicates and row.decision != "import")
        ):
            skipped += 1
            continue
        account = get_active_account(conn, context, row.account_id)
        if account["id"] not in account_ids:
            account_ids.append(account["id"])
        if account["member_id"] not in member_ids:
            member_ids.append(account["member_id"])
        category_id = get_or_create_category(
            conn,
            context,
            row.category_name,
            row.direction,
        )
        currency, exchange_rate, base_amount = import_money(account, row)
        balance_applied = int(affects_balance(account, row.occurred_at))
        conn.execute(
            """
            INSERT INTO transactions
            (family_id, member_id, account_id, category_id, amount, currency,
             exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
             merchant, note, source, reference_id, created_at, updated_at, balance_applied)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
            """,
            (
                account["family_id"],
                account["member_id"],
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
                statement_import_reference(row, account["import_reference_namespace"]),
                now,
                now,
                balance_applied,
            ),
        )
        if balance_applied:
            balance_changes.append((account, row.direction, row.amount))
        else:
            historical += 1
        imported += 1
    apply_account_balance_changes(conn, balance_changes, now)
    assert_investment_cash_nonnegative(conn, account_ids)
    response = {
        "message": f"已导入 {imported} 笔流水",
        "imported": imported,
        "skipped": skipped,
        "historical": historical,
    }
    return command_result(
        response,
        affected_account_ids=tuple(account_ids),
        affected_member_ids=member_ids,
        audit_facts=(AuditFact(
            action="导入账单",
            entity_type="transaction_batch",
            summary=f"导入账单：{imported} 笔",
            account_ids=tuple(account_ids),
            after_value=response,
        ),),
    )


def create_transaction(conn, context, transaction: TransactionCreate):
    now = datetime.now().isoformat(timespec="seconds")
    lock_row(conn, "accounts", transaction.account_id)
    account = get_active_account(conn, context, transaction.account_id)
    validate_category(conn, context, transaction.category_id, transaction.direction)
    category_id = transaction.category_id or get_or_create_category(
        conn, context, transaction.category_name, transaction.direction,
    )
    currency, exchange_rate, base_amount = transaction_money(account, transaction.amount)
    applied = int(affects_balance(account, transaction.occurred_at))
    cursor = conn.execute(
        """
        INSERT INTO transactions
        (family_id, member_id, account_id, category_id, amount, currency,
         exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
         merchant, note, created_at, updated_at, balance_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (
            account["family_id"], account["member_id"],
            transaction.account_id, category_id, transaction.amount, currency,
            exchange_rate, base_amount, transaction.direction, transaction.occurred_at,
            transaction.merchant, transaction.note, now, now, applied,
        ),
    )
    transaction_id = cursor.fetchone()["id"]
    if applied:
        apply_account_balance_delta(
            conn, account, transaction.direction, transaction.amount, now,
        )
    assert_investment_cash_nonnegative(conn, (account["id"],))
    after = dict(conn.execute(
        "SELECT * FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone())
    response = {
        "id": transaction_id,
        "message": "流水已创建",
        "balance_applied": bool(applied),
    }
    return command_result(
        response,
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="新增流水",
            entity_type="transaction",
            entity_id=transaction_id,
            summary=(
                f"{'收入' if transaction.direction == 'income' else '支出'}"
                f" {transaction.amount} {account['currency'] or 'CNY'}"
            ),
            reason=transaction.note,
            account_ids=(account["id"],),
            after_value=after,
        ),),
    )


def update_transaction(conn, context, transaction_id: int, transaction: TransactionCreate):
    now = datetime.now().isoformat(timespec="seconds")
    candidate = conn.execute(
        "SELECT * FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone()
    if not candidate:
        raise HTTPException(status_code=404, detail="流水不存在")
    for account_id in sorted({candidate["account_id"], transaction.account_id}):
        lock_row(conn, "accounts", account_id)
    old = lock_row(conn, "transactions", transaction_id)
    if not old:
        raise HTTPException(status_code=404, detail="流水不存在")
    if old["account_id"] != candidate["account_id"]:
        raise HTTPException(status_code=409, detail="流水归属已变化，请刷新后重试")
    if (old["source"] or "manual") != "manual" or old["voided_at"]:
        raise HTTPException(status_code=409, detail="该记录不能按普通收支修改")
    before = dict(old)
    old_account = get_active_account(conn, context, old["account_id"])
    account = get_active_account(conn, context, transaction.account_id)
    validate_category(conn, context, transaction.category_id, transaction.direction)
    # Preserve the recorded effect on note-only edits, including legacy records.
    applied = old["balance_applied"]
    if old["account_id"] != transaction.account_id or old["occurred_at"] != transaction.occurred_at:
        applied = int(affects_balance(account, transaction.occurred_at))
    changed = (
        old["account_id"] != transaction.account_id
        or old["direction"] != transaction.direction
        or not money_equal(old["amount"], transaction.amount)
        or applied != old["balance_applied"]
    )
    currency, rate, base_amount, fx_status = updated_transaction_money(
        old, account, transaction,
    )
    category_id = transaction.category_id or get_or_create_category(
        conn, context, transaction.category_name, transaction.direction,
    )
    balance_changes = []
    if changed and old["balance_applied"]:
        balance_changes.append((
            old_account,
            "expense" if old["direction"] == "income" else "income",
            old["amount"],
        ))
    conn.execute(
        """
        UPDATE transactions
        SET family_id = ?, member_id = ?, account_id = ?, category_id = ?, amount = ?, currency = ?,
            exchange_rate_to_base = ?, base_amount = ?, fx_status = ?, direction = ?,
            occurred_at = ?, merchant = ?, note = ?, updated_at = ?, balance_applied = ?
        WHERE id = ?
        """,
        (
            account["family_id"], account["member_id"], transaction.account_id,
            category_id, transaction.amount, currency, rate,
            base_amount, fx_status, transaction.direction, transaction.occurred_at,
            transaction.merchant, transaction.note, now, applied, transaction_id,
        ),
    )
    if changed and applied:
        balance_changes.append((account, transaction.direction, transaction.amount))
    apply_account_balance_changes(conn, balance_changes, now)
    assert_investment_cash_nonnegative(
        conn,
        (old_account["id"], account["id"]),
    )
    after = dict(conn.execute(
        "SELECT * FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone())
    return command_result(
        {"message": "流水已更新"},
        affected_account_ids=(old_account["id"], account["id"]),
        affected_member_ids=(
            old_account["member_id"],
            account["member_id"],
        ),
        audit_facts=(AuditFact(
            action="修改流水",
            entity_type="transaction",
            entity_id=transaction_id,
            summary=(
                f"修改流水：{'收入' if transaction.direction == 'income' else '支出'}"
                f" {transaction.amount} {account['currency'] or 'CNY'}"
            ),
            reason=transaction.note,
            account_ids=(old_account["id"], account["id"]),
            before_value=before,
            after_value=after,
        ),),
    )


def correct_transaction_application(
    conn,
    context,
    transaction_id: int,
    correction: TransactionApplicationCorrection,
):
    candidate = conn.execute(
        "SELECT account_id FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone()
    if not candidate:
        raise HTTPException(status_code=404, detail="流水不存在")
    lock_row(conn, "accounts", candidate["account_id"])
    transaction = lock_row(conn, "transactions", transaction_id)
    if not transaction or transaction["account_id"] != candidate["account_id"]:
        raise HTTPException(status_code=409, detail="流水归属已变化，请刷新后重试")
    account = get_account_for_access(
        conn,
        transaction["account_id"],
        write=True,
        active=True,
        context=context,
    )
    field = "cash_available" if account["type"] == "investment" else "balance"
    if not money_equal(account[field], correction.expected_account_balance):
        raise HTTPException(status_code=409, detail="账户余额已变化，请重新核对")
    actual = bool(transaction["balance_applied"])
    if actual != correction.expected_balance_applied:
        raise HTTPException(status_code=409, detail="流水余额应用标记已变化，请重新核对")
    expected = expected_transaction_application(account, dict(transaction))
    if transaction["voided_at"]:
        raise HTTPException(
            status_code=409,
            detail="已撤销流水不影响当前余额，无需执行余额应用更正",
        )
    if actual == expected:
        raise HTTPException(status_code=409, detail="流水余额应用标记符合业务日期，无需更正")

    before_transaction = dict(transaction)
    before_account = dict(account)
    direction = transaction["direction"]
    if actual and not expected:
        direction = "expense" if direction == "income" else "income"
    now = datetime.now().isoformat(timespec="seconds")
    apply_account_balance_delta(
        conn,
        account,
        direction,
        transaction["amount"],
        now,
    )
    conn.execute(
        """
        UPDATE transactions
        SET balance_applied = ?, updated_at = ?
        WHERE id = ? AND balance_applied = ?
        """,
        (int(expected), now, transaction_id, int(actual)),
    )
    after_transaction = dict(conn.execute(
        "SELECT * FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone())
    after_account = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account["id"],),
    ).fetchone())
    return command_result(
        {
            "message": "流水余额应用标记已更正",
            "transaction_id": transaction_id,
            "account_id": account["id"],
            "previous_balance_applied": actual,
            "balance_applied": expected,
            "previous_balance": before_account[field],
            "balance": after_account[field],
        },
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="更正流水余额应用",
            entity_type="transaction",
            entity_id=transaction_id,
            summary=(
                f"更正流水余额应用：{transaction['occurred_at']} "
                f"{transaction['amount']} {transaction['currency'] or 'CNY'}"
            ),
            reason=correction.reason,
            account_ids=(account["id"],),
            before_value={
                "transaction": before_transaction,
                "account": before_account,
            },
            after_value={
                "transaction": after_transaction,
                "account": after_account,
            },
        ),),
    )


def delete_transaction(conn, context, transaction_id: int):
    now = datetime.now().isoformat(timespec="seconds")
    candidate = conn.execute(
        "SELECT * FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone()
    if not candidate:
        raise HTTPException(status_code=404, detail="流水不存在")
    lock_row(conn, "accounts", candidate["account_id"])
    existing = lock_row(conn, "transactions", transaction_id)
    if not existing:
        raise HTTPException(status_code=404, detail="流水不存在")
    if existing["account_id"] != candidate["account_id"]:
        raise HTTPException(status_code=409, detail="流水归属已变化，请刷新后重试")
    if (existing["source"] or "manual") != "manual":
        raise HTTPException(status_code=409, detail="期初、调整或划转记录不能按普通收支删除")
    account = get_account_for_access(
        conn,
        existing["account_id"],
        write=True,
        active=True,
        context=context,
    )
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
    assert_investment_cash_nonnegative(conn, (account["id"],))
    return command_result(
        {"message": "流水已删除"},
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="删除流水",
            entity_type="transaction",
            entity_id=transaction_id,
            summary=(
                f"删除流水：{'收入' if row['direction'] == 'income' else '支出'}"
                f" {row['amount']} {row['currency'] or 'CNY'}"
            ),
            reason=row["note"],
            account_ids=(account["id"],),
            before_value=dict(row),
        ),),
    )


def expense_analysis(month: str | None = None, expense_range: str = "month", cashflow_range: str = "month"):
    return get_expense_analysis(month, expense_range, cashflow_range)


def income_analysis(month: str | None = None, income_range: str = "month", trend_range: str = "month"):
    return get_income_analysis(month, income_range, trend_range)


def ledger_monthly_overview(
    month: str | None = None,
    account_id: int | None = None,
    owner: str | None = None,
):
    return get_ledger_monthly_overview(
        month=month,
        account_id=account_id,
        owner=owner,
    )
