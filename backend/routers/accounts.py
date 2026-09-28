from datetime import date, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from accounting import affects_balance, apply_account_balance_delta
from commands import financial_command
from database import get_connection, lock_row, rows_to_dicts, write_connection
from schemas import AccountCreate, BalanceAdjustmentCreate, ReversalCreate, TransferCreate
from services import get_accounts_overview


router = APIRouter(prefix="/accounts", tags=["accounts"])


def normalize_owner(owner: str | None):
    return (owner or "").strip() or "冠池"


@router.get("/overview")
def accounts_overview():
    return get_accounts_overview()


@router.get("")
def list_accounts():
    return get_accounts_overview()["accounts"]


@router.post("")
@financial_command
def create_account(account: AccountCreate):
    now = datetime.now().isoformat(timespec="seconds")
    opened_at = account.opening_date or date.today().isoformat()
    is_liability = account.type == "credit_card" or account.is_liability
    conn = get_connection()
    cursor = conn.execute(
        """
        INSERT INTO accounts
        (name, type, owner, institution, balance, currency, exchange_rate_to_base, last4,
         credit_limit, statement_day, repayment_day, is_liability, opened_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account.name,
            account.type,
            normalize_owner(account.owner),
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
        ),
    )
    account_id = cursor.lastrowid
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
            (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
             fx_status, direction, occurred_at, merchant, note, source, reference_id,
             created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, 'captured', ?, ?, '期初余额', ?, 'opening', ?, ?, ?)
            """,
            (
                account_id,
                abs(account.balance),
                account.currency,
                account.exchange_rate_to_base,
                abs(account.balance) * account.exchange_rate_to_base,
                direction,
                opened_at,
                "建账时录入",
                f"opening-{uuid4().hex}",
                now,
                now,
            ),
        )
    conn.commit()
    conn.close()
    return {"id": account_id, "message": "账户已创建，期初余额已记录"}


@router.get("/{account_id}")
def get_account_detail(account_id: int):
    overview = get_accounts_overview()
    account = next(
        (item for item in overview["accounts"] if item["id"] == account_id),
        None,
    )
    if not account:
        raise HTTPException(status_code=404, detail="账户不存在")
    conn = get_connection()
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
    conn.close()
    return {
        "account": account,
        "transactions": transactions,
        "holdings": holdings,
        "trades": trades,
    }


@router.patch("/{account_id}")
@financial_command
def update_account(account_id: int, account: AccountCreate):
    now = datetime.now().isoformat(timespec="seconds")
    is_liability = account.type == "credit_card" or account.is_liability
    conn = get_connection()
    lock_row(conn, "accounts", account_id)
    existing = conn.execute(
        "SELECT id, type, is_liability, currency, opened_at FROM accounts WHERE id = ?",
        (account_id,),
    ).fetchone()
    if not existing:
        conn.close()
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
        conn.close()
        raise HTTPException(status_code=409, detail="已有流水的账户不能修改建账日期")
    if (has_transactions or has_holdings) and account.currency != existing["currency"]:
        conn.close()
        raise HTTPException(status_code=409, detail="已有流水或持仓的账户不能修改币种")
    if accounting_changed and has_holdings:
        conn.close()
        raise HTTPException(status_code=409, detail="已有持仓的账户不能修改记账类型")
    if accounting_changed and has_transactions:
        conn.close()
        raise HTTPException(
            status_code=409,
            detail="已有流水的账户不能修改账户类型或资产/负债属性",
        )
    conn.execute(
        """
        UPDATE accounts
        SET name = ?, type = ?, owner = ?, institution = ?, currency = ?, exchange_rate_to_base = ?,
            last4 = ?, credit_limit = ?, statement_day = ?, repayment_day = ?, is_liability = ?,
            opened_at = COALESCE(?, opened_at), updated_at = ?
        WHERE id = ?
        """,
        (
            account.name,
            account.type,
            normalize_owner(account.owner),
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
    conn.commit()
    conn.close()
    return {"message": "账户已更新"}


@router.delete("/{account_id}")
@financial_command
def delete_account(account_id: int):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    account = lock_row(conn, "accounts", account_id)
    if not account:
        raise HTTPException(status_code=404, detail="账户不存在")
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
    conn.commit()
    conn.close()
    return {"message": "账户已归档，历史记录保留"}


@router.post("/{account_id}/adjustments")
@financial_command
def adjust_account_balance(account_id: int, adjustment: BalanceAdjustmentCreate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    lock_row(conn, "accounts", account_id)
    account = conn.execute(
        """
        SELECT id, type, is_liability, is_active, currency, exchange_rate_to_base,
               balance, cash_available
        FROM accounts
        WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    if not account:
        conn.close()
        raise HTTPException(status_code=404, detail="账户不存在")
    if not account["is_active"]:
        conn.close()
        raise HTTPException(status_code=409, detail="已停用账户不能调整余额")

    field = "cash_available" if account["type"] == "investment" else "balance"
    current_balance = float(account[field] or 0)
    if adjustment.expected_balance is not None and abs(round(current_balance, 2) - adjustment.expected_balance) > 1e-8:
        raise HTTPException(status_code=409, detail="账户余额已变化，请刷新并重新核对")
    if account["type"] == "investment" and adjustment.actual_balance < 0:
        raise HTTPException(status_code=409, detail="现金可投不能为负数")
    delta = adjustment.actual_balance - current_balance
    if abs(delta) < 0.000001:
        conn.close()
        raise HTTPException(status_code=409, detail="核对余额与当前余额一致，无需调整")

    if account["is_liability"]:
        direction = "expense" if delta > 0 else "income"
    else:
        direction = "income" if delta > 0 else "expense"
    amount = abs(delta)
    exchange_rate = account["exchange_rate_to_base"] or 1
    reference_id = f"adjustment-{uuid4().hex}"
    conn.execute(
        f"UPDATE accounts SET {field} = ?, updated_at = ? WHERE id = ?",
        (adjustment.actual_balance, now, account_id),
    )
    cursor = conn.execute(
        """
        INSERT INTO transactions
        (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
         fx_status, direction, occurred_at, merchant, note, source, reference_id,
         created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, 'captured', ?, ?, '余额核对', ?, 'adjustment', ?, ?, ?)
        """,
        (
            account_id,
            amount,
            account["currency"],
            exchange_rate,
            amount * exchange_rate,
            direction,
            adjustment.occurred_at,
            adjustment.reason,
            reference_id,
            now,
            now,
        ),
    )
    conn.commit()
    adjustment_id = cursor.lastrowid
    conn.close()
    return {
        "id": adjustment_id,
        "message": "余额核对已记录",
        "previous_balance": round(current_balance, 2),
        "actual_balance": round(adjustment.actual_balance, 2),
        "difference": round(delta, 2),
    }


@router.post("/transfer")
@financial_command
def transfer_between_accounts(transfer: TransferCreate):
    if transfer.from_account_id == transfer.to_account_id:
        raise HTTPException(status_code=409, detail="转出账户和转入账户不能相同")

    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    for account_id in sorted((transfer.from_account_id, transfer.to_account_id)):
        lock_row(conn, "accounts", account_id)
    from_account = conn.execute(
        """
        SELECT id, type, is_liability, is_active, currency, exchange_rate_to_base,
               balance, cash_available, opened_at
        FROM accounts WHERE id = ?
        """,
        (transfer.from_account_id,),
    ).fetchone()
    to_account = conn.execute(
        """
        SELECT id, type, is_liability, is_active, currency, exchange_rate_to_base,
               balance, cash_available, opened_at
        FROM accounts WHERE id = ?
        """,
        (transfer.to_account_id,),
    ).fetchone()
    if not from_account or not to_account:
        conn.close()
        raise HTTPException(status_code=404, detail="转出账户或转入账户不存在")
    if not from_account["is_active"] or not to_account["is_active"]:
        conn.close()
        raise HTTPException(status_code=409, detail="已停用账户不能参与资金划转")
    if (from_account["type"] == "investment"
            and affects_balance(from_account, transfer.occurred_at)
            and from_account["cash_available"] + 1e-8 < transfer.amount):
        raise HTTPException(status_code=409, detail="投资账户现金可投不足")

    from_rate = from_account["exchange_rate_to_base"] or 1
    same_currency = from_account["currency"].upper() == to_account["currency"].upper()
    if same_currency:
        to_amount = transfer.amount
        if transfer.to_amount is not None and abs(transfer.to_amount - to_amount) > 1e-8:
            raise HTTPException(status_code=409, detail="同币种转账按原币 1:1 到账")
    elif transfer.to_amount is None:
        raise HTTPException(status_code=409, detail="跨币种转账请填写实际到账金额")
    else:
        to_amount = transfer.to_amount
    base_amount = transfer.amount * from_rate
    # Capture the actual conversion for both legs; no current destination FX
    # may change either the settled amount or the historical base amount.
    to_rate = base_amount / to_amount
    reference_id = f"transfer-{uuid4().hex}"
    from_applied = int(affects_balance(from_account, transfer.occurred_at))
    to_applied = int(affects_balance(to_account, transfer.occurred_at))
    if from_applied:
        apply_account_balance_delta(conn, from_account, "expense", transfer.amount, now)
    if to_applied:
        apply_account_balance_delta(conn, to_account, "income", to_amount, now)
    note = transfer.note or "资金划转"
    conn.execute(
        """
        INSERT INTO transactions
        (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
         fx_status, direction, occurred_at, merchant, note, source, reference_id, created_at, updated_at, balance_applied)
        VALUES (?, NULL, ?, ?, ?, ?, 'captured', 'expense', ?, ?, ?, 'transfer', ?, ?, ?, ?)
        """,
        (
            transfer.from_account_id,
            transfer.amount,
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
        (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
         fx_status, direction, occurred_at, merchant, note, source, reference_id, created_at, updated_at, balance_applied)
        VALUES (?, NULL, ?, ?, ?, ?, 'captured', 'income', ?, ?, ?, 'transfer', ?, ?, ?, ?)
        """,
        (
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
    conn.commit()
    conn.close()
    return {
        "message": "资金划转已完成",
        "from_amount": round(transfer.amount, 2),
        "from_currency": from_account["currency"],
        "to_amount": round(to_amount, 2),
        "to_currency": to_account["currency"],
        "reference_id": reference_id,
    }


@router.post("/transfers/{reference_id}/reverse")
@financial_command
def reverse_transfer(reference_id: str, payload: ReversalCreate):
    now = datetime.now().isoformat(timespec="seconds")
    with write_connection() as conn:
        # Claim both legs once; concurrent requests cannot refund a second time.
        legs = conn.execute("""
            UPDATE transactions SET voided_at = ?, void_reason = ?, updated_at = ?
            WHERE reference_id = ? AND source = 'transfer' AND voided_at IS NULL
            RETURNING *
        """, (now, payload.reason, now, reference_id)).fetchall()
        if len(legs) != 2 or {row["direction"] for row in legs} != {"income", "expense"}:
            raise HTTPException(status_code=409, detail="转账已撤销或关联记录不完整")
        for row in sorted(legs, key=lambda item: item["account_id"]):
            account = lock_row(conn, "accounts", row["account_id"])
            if not account:
                raise HTTPException(status_code=409, detail="关联账户不存在，不能撤销")
            if not account["is_active"]:
                raise HTTPException(status_code=409, detail="关联账户已归档，不能撤销")
            if row["balance_applied"]:
                apply_account_balance_delta(
                    conn, account, "income" if row["direction"] == "expense" else "expense",
                    row["amount"], now,
                )
    return {"message": "转账已撤销，可按正确金额重新记账"}
