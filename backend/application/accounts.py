from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException

from domain.accounting import (
    account_balance_delta,
    affects_balance,
)
from infrastructure.accounting_store import (
    apply_account_balance_delta,
    reconcile_account_balance,
)
from application.commands import AuditFact, command_result
from domain.calendar import business_now, business_today
from infrastructure.read_models import consistent_query
from infrastructure.database import (
    is_postgres_connection,
    lock_row,
    rows_to_dicts,
)
from domain.money import money, money_equal, rate
from domain.transfers import transfer_valuation
from queries.reconciliation import account_reconciliation
from schemas import AccountCreate, BalanceAdjustmentCreate, ReversalCreate, TransferCreate
from queries.finance import (
    apply_investment_account_values,
    get_accounts_overview,
    get_investment_values_by_account,
)
from tenancy import (
    can_edit_member,
    can_manage_family,
    get_account_for_access,
    get_auth_context,
    scoped_account_clause,
)


def normalize_owner(owner: str | None):
    return (owner or "").strip() or "冠池"


def resolve_account_member(conn, context, account: AccountCreate):
    if context.scope == "personal" or not can_manage_family(context):
        return context.member_id, context.display_name
    member = None
    if account.member_id:
        member = conn.execute(
            """
            SELECT id, display_name
            FROM family_members
            WHERE id = ? AND family_id = ? AND is_active = 1
            """,
            (account.member_id, context.family_id),
        ).fetchone()
    else:
        owner = normalize_owner(account.owner)
        member = conn.execute(
            """
            SELECT id, display_name
            FROM family_members
            WHERE family_id = ? AND display_name = ? AND is_active = 1
            """,
            (context.family_id, owner),
        ).fetchone()
        if not member:
            now = datetime.now().isoformat(timespec="seconds")
            member_id = conn.execute(
                """
                INSERT INTO family_members
                (member_key, family_id, display_name, role, created_at, updated_at)
                VALUES (?, ?, ?, 'member', ?, ?) RETURNING id
                """,
                (uuid4().hex, context.family_id, owner, now, now),
            ).fetchone()["id"]
            return member_id, owner
    if not member:
        raise HTTPException(status_code=404, detail="家庭成员不存在")
    return member["id"], member["display_name"]


def accounts_overview():
    return get_accounts_overview()


def list_accounts():
    return get_accounts_overview()["accounts"]


@consistent_query
def list_archived_accounts(*, conn=None):
    context = get_auth_context(conn)
    scope, params = scoped_account_clause("a", context)
    accounts = rows_to_dicts(conn.execute(
        f"""
        SELECT a.*,
               (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS transaction_count,
               (SELECT COUNT(*) FROM holdings h WHERE h.account_id = a.id) AS holding_count,
               (SELECT COUNT(*) FROM investment_trades it WHERE it.account_id = a.id) AS trade_count
        FROM accounts a
        WHERE {scope} AND a.is_active = 0
        ORDER BY a.updated_at DESC, a.id DESC
        """,
        tuple(params),
    ).fetchall())
    accounts = apply_investment_account_values(
        accounts,
        get_investment_values_by_account(
            conn,
            context,
            account_ids=[account["id"] for account in accounts],
        ),
    )
    for account in accounts:
        account["can_edit"] = False
        account["can_restore"] = can_edit_member(account.get("member_id"), context)
    return accounts


@consistent_query
def reconcile_accounts(*, conn=None):
    context = get_auth_context(conn)
    return account_reconciliation(conn, context)


def create_account(conn, context, account: AccountCreate):
    now = business_now().isoformat(timespec="seconds")
    opened_at = account.opening_date or business_today().isoformat()
    is_liability = account.type == "credit_card" or account.is_liability
    member_id, owner = resolve_account_member(conn, context, account)
    cursor = conn.execute(
        """
        INSERT INTO accounts
        (family_id, member_id, name, type, owner, institution, balance, currency,
         exchange_rate_to_base, last4, credit_limit, statement_day, repayment_day,
         is_liability, opened_at, created_at, updated_at, history_basis)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (
            context.family_id,
            member_id,
            account.name,
            account.type,
            owner,
            None,
            0,
            account.currency,
            account.exchange_rate_to_base,
            account.last4,
            account.credit_limit,
            account.statement_day,
            account.repayment_day,
            int(is_liability),
            opened_at,
            now,
            now,
            "opening_transaction" if account.balance else "zero_opening",
        ),
    )
    account_id = cursor.fetchone()["id"]
    if account.balance:
        balance_increases = account.balance > 0
        direction = (
            "expense" if is_liability and balance_increases
            else "income" if is_liability
            else "income" if balance_increases
            else "expense"
        )
        field = "cash_available" if account.type == "investment" else "balance"
        conn.execute(
            f"UPDATE accounts SET {field} = ? WHERE id = ?",
            (account.balance, account_id),
        )
        conn.execute(
            """
            INSERT INTO transactions
            (family_id, member_id, account_id, category_id, amount, currency,
             exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
             merchant, note, source, reference_id, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'captured', ?, ?, '期初余额', ?,
                    'opening', ?, ?, ?)
            """,
            (
                context.family_id,
                member_id,
                account_id,
                abs(account.balance),
                account.currency,
                account.exchange_rate_to_base,
                money(abs(account.balance) * account.exchange_rate_to_base),
                direction,
                opened_at,
                "建账时录入",
                f"opening-{uuid4().hex}",
                now,
                now,
            ),
        )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone())
    return command_result(
        {"id": account_id, "message": "账户已创建，期初余额已记录"},
        affected_account_ids=(account_id,),
        affected_member_ids=(member_id,),
        audit_facts=(AuditFact(
            action="创建账户",
            entity_type="account",
            entity_id=account_id,
            summary=f"创建账户：{owner} · {account.name}",
            account_ids=(account_id,),
            after_value=after,
        ),),
    )


@consistent_query
def get_account_detail(account_id: int, *, conn=None):
    context = get_auth_context(conn)
    account = dict(get_account_for_access(conn, account_id))
    account = apply_investment_account_values(
        [account],
        get_investment_values_by_account(conn, context, account_ids=[account_id]),
    )[0]
    account["can_edit"] = bool(
        account["is_active"]
        and can_edit_member(account.get("member_id"), context)
    )
    account["can_restore"] = bool(
        not account["is_active"]
        and can_edit_member(account.get("member_id"), context)
    )
    transactions = rows_to_dicts(conn.execute(
        """
        SELECT t.*, c.name AS category_name, c.icon, c.color
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.account_id = ?
        ORDER BY t.occurred_at DESC, t.id DESC
        """,
        (account_id,),
    ).fetchall())
    holdings = rows_to_dicts(conn.execute(
        """
        SELECT *
        FROM holdings
        WHERE account_id = ?
        ORDER BY id
        """,
        (account_id,),
    ).fetchall())
    trades = rows_to_dicts(conn.execute(
        """
        SELECT it.*, h.name AS holding_name, h.code AS holding_code
        FROM investment_trades it
        LEFT JOIN holdings h ON h.id = it.holding_id
        WHERE it.account_id = ?
        ORDER BY it.occurred_at DESC, it.id DESC
        """,
        (account_id,),
    ).fetchall())
    activity = rows_to_dicts(conn.execute(
        """
        SELECT DISTINCT
            ae.id, ae.actor_name, ae.action, ae.entity_type, ae.entity_id,
            ae.summary, ae.reason, ae.before_value, ae.after_value,
            ae.payload_version, ae.created_at
        FROM audit_events ae
        JOIN audit_event_accounts link ON link.audit_event_id = ae.id
        WHERE ae.family_id = ? AND link.account_id = ?
        ORDER BY ae.created_at DESC, ae.id DESC
        LIMIT 20
        """,
        (account["family_id"], account_id),
    ).fetchall())
    return {
        "account": account,
        "transactions": transactions,
        "holdings": holdings,
        "trades": trades,
        "activity": activity,
    }


def update_account(conn, context, account_id: int, account: AccountCreate):
    now = datetime.now().isoformat(timespec="seconds")
    is_liability = account.type == "credit_card" or account.is_liability
    lock_row(conn, "accounts", account_id)
    get_account_for_access(conn, account_id, write=True, context=context)
    existing = conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="账户不存在")
    accounting_changed = (
        existing["type"] != account.type
        or bool(existing["is_liability"]) != is_liability
    )
    has_transactions = conn.execute(
        "SELECT 1 FROM transactions WHERE account_id = ? LIMIT 1",
        (account_id,),
    ).fetchone()
    has_holdings = conn.execute(
        "SELECT 1 FROM holdings WHERE account_id = ? LIMIT 1", (account_id,),
    ).fetchone()
    if has_transactions and account.opening_date and account.opening_date != existing["opened_at"]:
        raise HTTPException(status_code=409, detail="已有流水的账户不能修改建账日期")
    if (has_transactions or has_holdings) and account.currency != existing["currency"]:
        raise HTTPException(status_code=409, detail="已有流水或持仓的账户不能修改币种")
    if accounting_changed and has_holdings:
        raise HTTPException(status_code=409, detail="已有持仓的账户不能修改记账类型")
    if accounting_changed and has_transactions:
        raise HTTPException(
            status_code=409,
            detail="已有流水的账户不能修改账户类型或资产/负债属性",
        )
    member_id, owner = resolve_account_member(conn, context, account)
    conn.execute(
        """
        UPDATE accounts
        SET member_id = ?, name = ?, type = ?, owner = ?, institution = ?, currency = ?, exchange_rate_to_base = ?,
            last4 = ?, credit_limit = ?, statement_day = ?, repayment_day = ?, is_liability = ?,
            opened_at = COALESCE(?, opened_at), updated_at = ?
        WHERE id = ?
        """,
        (
            member_id,
            account.name,
            account.type,
            owner,
            None,
            account.currency,
            account.exchange_rate_to_base,
            account.last4,
            account.credit_limit,
            account.statement_day,
            account.repayment_day,
            int(is_liability),
            account.opening_date,
            now,
            account_id,
        ),
    )
    if member_id != existing["member_id"]:
        for table in ("transactions", "holdings", "investment_trades"):
            conn.execute(
                f"UPDATE {table} SET member_id = ? WHERE account_id = ?",
                (member_id, account_id),
            )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone())
    return command_result(
        {"message": "账户已更新"},
        affected_account_ids=(account_id,),
        affected_member_ids=(existing["member_id"], member_id),
        audit_facts=(AuditFact(
            action="修改账户",
            entity_type="account",
            entity_id=account_id,
            summary=f"修改账户：{owner} · {account.name}",
            account_ids=(account_id,),
            before_value=dict(existing),
            after_value=after,
        ),),
    )


def delete_account(conn, context, account_id: int):
    now = datetime.now().isoformat(timespec="seconds")
    account = lock_row(conn, "accounts", account_id)
    account = get_account_for_access(conn, account_id, write=True, context=context)
    field = "cash_available" if account["type"] == "investment" else "balance"
    if abs(account[field] or 0) > 1e-8 or conn.execute(
        "SELECT 1 FROM holdings WHERE account_id = ? AND ABS(quantity) > 0.00000001 LIMIT 1",
        (account_id,),
    ).fetchone():
        raise HTTPException(status_code=409, detail="请先清空账户余额、待还及持仓，再归档账户")
    conn.execute(
        "UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?",
        (now, account_id),
    )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone())
    return command_result(
        {"message": "账户已归档，历史记录保留"},
        affected_account_ids=(account_id,),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="归档账户",
            entity_type="account",
            entity_id=account_id,
            summary=f"归档账户：{account['name']}",
            account_ids=(account_id,),
            before_value=dict(account),
            after_value=after,
        ),),
    )


def restore_account(conn, context, account_id: int):
    now = datetime.now().isoformat(timespec="seconds")
    lock_row(conn, "accounts", account_id)
    account = get_account_for_access(conn, account_id, write=True, context=context)
    if account["is_active"]:
        raise HTTPException(status_code=409, detail="账户已经启用")
    conn.execute(
        "UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?",
        (now, account_id),
    )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone())
    return command_result(
        {"message": "账户已恢复，可继续更正历史账目"},
        affected_account_ids=(account_id,),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="恢复账户",
            entity_type="account",
            entity_id=account_id,
            summary=f"恢复账户：{account['name']}",
            account_ids=(account_id,),
            before_value=dict(account),
            after_value=after,
        ),),
    )


def adjust_account_balance(conn, context, account_id: int, adjustment: BalanceAdjustmentCreate):
    now = datetime.now().isoformat(timespec="seconds")
    lock_row(conn, "accounts", account_id)
    account = get_account_for_access(
        conn,
        account_id,
        write=True,
        active=True,
        context=context,
    )
    before = dict(account)
    response = reconcile_account_balance(
        conn,
        account,
        actual_balance=adjustment.actual_balance,
        expected_balance=adjustment.expected_balance,
        occurred_at=adjustment.occurred_at,
        reason=adjustment.reason,
        updated_at=now,
    )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone())
    return command_result(
        response,
        affected_account_ids=(account_id,),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="核对余额",
            entity_type="account",
            entity_id=account_id,
            summary=f"核对余额：{account['name']}",
            reason=adjustment.reason,
            account_ids=(account_id,),
            before_value=before,
            after_value=after,
        ),),
    )


def transfer_between_accounts(conn, context, transfer: TransferCreate):
    if transfer.from_account_id == transfer.to_account_id:
        raise HTTPException(status_code=409, detail="转出账户和转入账户不能相同")

    now = datetime.now().isoformat(timespec="seconds")
    for account_id in sorted((transfer.from_account_id, transfer.to_account_id)):
        lock_row(conn, "accounts", account_id)
    from_account = get_account_for_access(
        conn, transfer.from_account_id, write=True, active=True, context=context,
    )
    to_account = get_account_for_access(
        conn, transfer.to_account_id, write=True, active=True, context=context,
    )
    before_accounts = [dict(from_account), dict(to_account)]
    from_amount = money(transfer.amount)
    if (
        from_account["type"] == "investment"
        and affects_balance(from_account, transfer.occurred_at)
        and money(from_account["cash_available"]) < from_amount
    ):
        raise HTTPException(status_code=409, detail="投资账户现金可投不足")

    from_rate = rate(from_account["exchange_rate_to_base"] or 1)
    same_currency = from_account["currency"].upper() == to_account["currency"].upper()
    if same_currency:
        to_amount = from_amount
        if transfer.to_amount is not None and not money_equal(transfer.to_amount, to_amount):
            raise HTTPException(status_code=409, detail="同币种转账按原币 1:1 到账")
    elif transfer.to_amount is None:
        raise HTTPException(status_code=409, detail="跨币种转账请填写实际到账金额")
    else:
        to_amount = money(transfer.to_amount)
    try:
        base_amount, to_rate = transfer_valuation(
            from_amount, from_rate, to_amount, same_currency=same_currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    reference_id = f"transfer-{uuid4().hex}"
    from_applied = int(affects_balance(from_account, transfer.occurred_at))
    to_applied = int(affects_balance(to_account, transfer.occurred_at))
    if from_applied:
        apply_account_balance_delta(conn, from_account, "expense", from_amount, now)
    if to_applied:
        apply_account_balance_delta(conn, to_account, "income", to_amount, now)
    note = transfer.note or "资金划转"
    conn.execute(
        """
        INSERT INTO transactions
        (family_id, member_id, account_id, category_id, amount, currency,
         exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
         merchant, note, source, reference_id, created_at, updated_at, balance_applied)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'captured', 'expense', ?, ?, ?,
                'transfer', ?, ?, ?, ?)
        """,
        (
            from_account["family_id"],
            from_account["member_id"],
            transfer.from_account_id,
            from_amount,
            from_account["currency"],
            from_rate,
            base_amount,
            transfer.occurred_at,
            "划出",
            note,
            reference_id,
            now,
            now,
            from_applied,
        ),
    )
    conn.execute(
        """
        INSERT INTO transactions
        (family_id, member_id, account_id, category_id, amount, currency,
         exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
         merchant, note, source, reference_id, created_at, updated_at, balance_applied)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'captured', 'income', ?, ?, ?,
                'transfer', ?, ?, ?, ?)
        """,
        (
            to_account["family_id"],
            to_account["member_id"],
            transfer.to_account_id,
            to_amount,
            to_account["currency"],
            to_rate,
            base_amount,
            transfer.occurred_at,
            "划入",
            note,
            reference_id,
            now,
            now,
            to_applied,
        ),
    )
    after_legs = [dict(row) for row in conn.execute(
        """
        SELECT * FROM transactions
        WHERE reference_id = ? AND family_id = ?
        ORDER BY id
        """,
        (reference_id, context.family_id),
    ).fetchall()]
    response = {
        "message": "资金划转已完成",
        "from_amount": from_amount,
        "from_currency": from_account["currency"],
        "to_amount": round(to_amount, 2),
        "to_currency": to_account["currency"],
        "reference_id": reference_id,
    }
    return command_result(
        response,
        affected_account_ids=(from_account["id"], to_account["id"]),
        affected_member_ids=(
            from_account["member_id"],
            to_account["member_id"],
        ),
        audit_facts=(AuditFact(
            action="资金划转",
            entity_type="transfer",
            entity_id=reference_id,
            summary=(
                f"资金划转：{from_account['name']} → {to_account['name']}"
            ),
            reason=transfer.note,
            account_ids=(from_account["id"], to_account["id"]),
            before_value=before_accounts,
            after_value=after_legs,
        ),),
    )


def reverse_transfer(conn, context, reference_id: str, payload: ReversalCreate):
    now = datetime.now().isoformat(timespec="seconds")
    lock_suffix = " FOR UPDATE" if is_postgres_connection(conn) else ""
    candidate_legs = [dict(row) for row in conn.execute("""
        SELECT * FROM transactions
        WHERE reference_id = ? AND family_id = ? AND source = 'transfer' AND voided_at IS NULL
        ORDER BY account_id
    """, (reference_id, context.family_id)).fetchall()]
    if len(candidate_legs) != 2 or {
        row["direction"] for row in candidate_legs
    } != {"income", "expense"}:
        raise HTTPException(status_code=409, detail="转账已撤销或关联记录不完整")
    candidate_account_ids = tuple(
        sorted({row["account_id"] for row in candidate_legs})
    )
    for account_id in candidate_account_ids:
        lock_row(conn, "accounts", account_id)
    before_legs = [dict(row) for row in conn.execute(f"""
        SELECT * FROM transactions
        WHERE reference_id = ? AND family_id = ? AND source = 'transfer' AND voided_at IS NULL
        ORDER BY account_id
        {lock_suffix}
    """, (reference_id, context.family_id)).fetchall()]
    if (
        len(before_legs) != 2
        or {row["direction"] for row in before_legs} != {"income", "expense"}
        or tuple(sorted({row["account_id"] for row in before_legs}))
        != candidate_account_ids
    ):
        raise HTTPException(status_code=409, detail="转账已变化，请刷新后重试")
    # Claim both legs once; concurrent requests cannot refund a second time.
    legs = conn.execute("""
        UPDATE transactions SET voided_at = ?, void_reason = ?, updated_at = ?
        WHERE reference_id = ? AND family_id = ? AND source = 'transfer' AND voided_at IS NULL
        RETURNING *
    """, (now, payload.reason, now, reference_id, context.family_id)).fetchall()
    if len(legs) != 2 or {row["direction"] for row in legs} != {"income", "expense"}:
        raise HTTPException(status_code=409, detail="转账已撤销或关联记录不完整")
    reversals = []
    for row in sorted(legs, key=lambda item: item["account_id"]):
        account = get_account_for_access(
            conn, row["account_id"], write=True, active=True, context=context,
        )
        reverse_direction = (
            "income" if row["direction"] == "expense" else "expense"
        )
        if (
            row["balance_applied"]
            and account["type"] == "investment"
            and money(account["cash_available"])
            + account_balance_delta(account, reverse_direction, row["amount"]) < 0
        ):
            raise HTTPException(
                status_code=409,
                detail="转入投资账户的现金已被使用，余额不足，无法撤销转账",
            )
        reversals.append((account, reverse_direction, row))
    for account, reverse_direction, row in reversals:
        if row["balance_applied"]:
            apply_account_balance_delta(
                conn, account, reverse_direction,
                row["amount"], now,
            )
    after_legs = [dict(row) for row in conn.execute(
        """
        SELECT * FROM transactions
        WHERE reference_id = ? AND family_id = ?
        ORDER BY id
        """,
        (reference_id, context.family_id),
    ).fetchall()]
    return command_result(
        {"message": "转账已撤销，可按正确金额重新记账"},
        affected_account_ids=tuple(
            account["id"] for account, _, _ in reversals
        ),
        affected_member_ids=tuple(
            account["member_id"] for account, _, _ in reversals
        ),
        audit_facts=(AuditFact(
            action="撤销转账",
            entity_type="transfer",
            entity_id=reference_id,
            summary="撤销转账",
            reason=payload.reason,
            account_ids=tuple(account["id"] for account, _, _ in reversals),
            before_value=before_legs,
            after_value=after_legs,
        ),),
    )
