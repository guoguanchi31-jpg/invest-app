from datetime import datetime
from math import isclose

from fastapi import APIRouter, HTTPException

from commands import financial_command
from database import get_connection, lock_row, rows_to_dicts, write_connection
from schemas import HoldingCreate, InvestmentCashUpdate, InvestmentTradeCreate, ReversalCreate
from services import get_holdings, get_investment_summary, refresh_holding_prices


router = APIRouter(tags=["investments"])


def validate_investment_account(conn, account_id):
    if account_id is None:
        return None
    account = conn.execute(
        """
        SELECT id, type, is_active, is_liability, currency, exchange_rate_to_base,
               cash_available, opened_at
        FROM accounts WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="投资账户不存在")
    if not account["is_active"] or account["is_liability"] or account["type"] != "investment":
        raise HTTPException(status_code=409, detail="持仓只能关联启用中的非负债投资账户")
    return account


@router.get("/investments/summary")
def investment_summary(month: str | None = None, trend_range: str = "12m"):
    return get_investment_summary(month, trend_range)


@router.get("/investments/holdings")
def investment_holdings():
    return get_holdings()


@router.patch("/investments/cash-available")
@financial_command
def update_investment_cash(payload: InvestmentCashUpdate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    lock_row(conn, "accounts", payload.account_id)
    account = conn.execute(
        """
        SELECT id
        FROM accounts
        WHERE id = ? AND type = 'investment' AND is_active = 1 AND is_liability = 0
        """,
        (payload.account_id,),
    ).fetchone()
    if not account:
        conn.close()
        raise HTTPException(status_code=404, detail="未找到可维护现金的股票账户")
    conn.execute(
        """
        UPDATE accounts
        SET cash_available = ?, updated_at = ?
        WHERE id = ?
        """,
        (payload.cash_available, now, payload.account_id),
    )
    conn.commit()
    conn.close()
    return {"message": "现金可投已更新"}


@router.get("/investments/trades")
def list_investment_trades(account_id: int | None = None, holding_id: int | None = None):
    clauses = ["1 = 1"]
    params = []
    if account_id:
        clauses.append("it.account_id = ?")
        params.append(account_id)
    if holding_id:
        clauses.append("it.holding_id = ?")
        params.append(holding_id)
    conn = get_connection()
    rows = conn.execute(
        f"""
        SELECT
            it.*, h.name AS holding_name, h.code AS holding_code,
            a.name AS account_name, a.owner AS account_owner,
            a.currency AS account_currency
        FROM investment_trades it
        LEFT JOIN holdings h ON h.id = it.holding_id
        LEFT JOIN accounts a ON a.id = it.account_id
        WHERE {" AND ".join(clauses)}
        ORDER BY it.occurred_at DESC, it.id DESC
        """,
        tuple(params),
    ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


@router.post("/investments/trades")
@financial_command
def create_investment_trade(trade: InvestmentTradeCreate):
    with write_connection() as conn:
        if trade.new_holding:
            new = trade.new_holding
            lock_row(conn, "accounts", new.account_id)
            validate_investment_account(conn, new.account_id)
            if conn.execute(
                "SELECT id FROM holdings WHERE account_id = ? AND UPPER(code) = UPPER(?) AND COALESCE(market, '') = ?",
                (new.account_id, new.code.strip(), new.market or ""),
            ).fetchone():
                raise HTTPException(status_code=409, detail="该账户已有此标的，请在已有持仓上买入")
            now = datetime.now().isoformat(timespec="seconds")
            holding_id = conn.execute("""
                INSERT INTO holdings
                (name, code, account_id, asset_type, market, currency, exchange_rate_to_base,
                 quantity, buy_price, current_price, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
            """, (new.name, new.code.strip(), new.account_id, new.asset_type, new.market,
                  new.currency, new.exchange_rate_to_base, trade.price, now)).lastrowid
        else:
            holding_id = trade.holding_id
        return execute_trade(conn, holding_id, trade)


def execute_trade(conn, holding_id, trade):
    now = datetime.now().isoformat(timespec="seconds")
    holding = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if not holding:
        raise HTTPException(status_code=404, detail="持仓不存在")
    if not holding["account_id"]:
        raise HTTPException(status_code=409, detail="请先为持仓关联投资账户")
    account_id = holding["account_id"]
    lock_row(conn, "accounts", account_id)
    holding = lock_row(conn, "holdings", holding_id)
    if not holding or holding["account_id"] != account_id:
        raise HTTPException(status_code=409, detail="持仓已变更，请刷新重试")
    account = validate_investment_account(conn, holding["account_id"])
    if dict(account).get("opened_at") and trade.occurred_at < account["opened_at"]:
        raise HTTPException(status_code=409, detail="建账前的投资请录入已有持仓，实际交易日期不能早于建账日")

    account_rate = account["exchange_rate_to_base"] or 1
    gross_amount = trade.quantity * trade.price
    trade_amount = gross_amount + trade.fee if trade.trade_type == "buy" else gross_amount - trade.fee
    if trade_amount <= 0:
        raise HTTPException(status_code=409, detail="手续费不能大于或等于卖出金额")
    if (holding["currency"] or "CNY").upper() == (account["currency"] or "CNY").upper():
        settlement_rate = 1
        if trade.settlement_rate is not None and not isclose(trade.settlement_rate, 1, abs_tol=1e-8):
            raise HTTPException(status_code=409, detail="同币种交易按原币 1:1 结算")
    elif trade.settlement_rate is None:
        raise HTTPException(status_code=409, detail="跨币种交易请确认结算汇率")
    else:
        settlement_rate = trade.settlement_rate
    account_cash_amount = trade_amount * settlement_rate
    holding_rate = settlement_rate * account_rate
    base_amount = account_cash_amount * account_rate

    if trade.trade_type == "buy":
        cash_cursor = conn.execute(
            """
            UPDATE accounts
            SET cash_available = cash_available - ?, updated_at = ?
            WHERE id = ? AND cash_available >= ?
            """,
            (account_cash_amount, now, account["id"], account_cash_amount),
        )
        if not cash_cursor.rowcount:
            raise HTTPException(status_code=409, detail="投资账户现金可投不足")
        holding_cursor = conn.execute(
            """
            UPDATE holdings
            SET buy_price = (
                    COALESCE(buy_price, 0) * COALESCE(quantity, 0) + ?
                ) / (COALESCE(quantity, 0) + ?),
                quantity = COALESCE(quantity, 0) + ?,
                updated_at = ?
            WHERE id = ?
            """,
            (gross_amount + trade.fee, trade.quantity, trade.quantity, now, holding["id"]),
        )
    else:
        holding_cursor = conn.execute(
            """
            UPDATE holdings
            SET quantity = quantity - ?,
                updated_at = ?
            WHERE id = ? AND quantity >= ?
            """,
            (trade.quantity, now, holding["id"], trade.quantity),
        )
        if not holding_cursor.rowcount:
            raise HTTPException(status_code=409, detail="卖出数量不能超过当前持仓")
        conn.execute(
            """
            UPDATE accounts
            SET cash_available = cash_available + ?, updated_at = ?
            WHERE id = ?
            """,
            (account_cash_amount, now, account["id"]),
        )

    updated_holding = conn.execute(
        "SELECT quantity, buy_price, current_price FROM holdings WHERE id = ?",
        (holding["id"],),
    ).fetchone()
    cursor = conn.execute(
        """
        INSERT INTO investment_trades
        (holding_id, account_id, trade_type, quantity, price, fee, cash_amount,
         currency, exchange_rate_to_base, base_amount, occurred_at, note, created_at,
         quantity_before, cost_before, quantity_after, cost_after, account_currency, settlement_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            holding["id"],
            account["id"],
            trade.trade_type,
            trade.quantity,
            trade.price,
            trade.fee,
            account_cash_amount,
            holding["currency"] or "CNY",
            holding_rate,
            base_amount,
            trade.occurred_at,
            trade.note,
            now,
            holding["quantity"], holding["buy_price"],
            updated_holding["quantity"], updated_holding["buy_price"], account["currency"],
            settlement_rate,
        ),
    )
    trade_id = cursor.lastrowid
    updated_account = conn.execute(
        "SELECT cash_available FROM accounts WHERE id = ?",
        (account["id"],),
    ).fetchone()
    return {
        "id": trade_id,
        "message": "买入已记录" if trade.trade_type == "buy" else "卖出已记录",
        "holding_quantity": round(updated_holding["quantity"], 6),
        "holding_buy_price": round(updated_holding["buy_price"], 6),
        "cash_available": round(updated_account["cash_available"], 2),
        "holding_id": holding_id,
    }


@router.post("/investments/trades/{trade_id}/reverse")
@financial_command
def reverse_investment_trade(trade_id: int, payload: ReversalCreate):
    with write_connection() as conn:
        trade = conn.execute("SELECT * FROM investment_trades WHERE id = ?", (trade_id,)).fetchone()
        if not trade:
            raise HTTPException(status_code=404, detail="交易不存在")
        account = lock_row(conn, "accounts", trade["account_id"])
        holding = lock_row(conn, "holdings", trade["holding_id"])
        trade = lock_row(conn, "investment_trades", trade_id)
        if not account or not holding or trade["voided_at"]:
            raise HTTPException(status_code=409, detail="交易已撤销或关联账户/持仓缺失")
        if not account["is_active"]:
            raise HTTPException(status_code=409, detail="关联账户已归档，不能撤销")
        later = conn.execute("""
            SELECT id FROM investment_trades
            WHERE holding_id = ? AND id > ? AND voided_at IS NULL LIMIT 1
        """, (trade["holding_id"], trade_id)).fetchone()
        if later:
            raise HTTPException(status_code=409, detail="请先撤销同一持仓最近一笔交易")
        if trade["quantity_before"] is None:
            raise HTTPException(status_code=409, detail="旧交易缺少成本快照，无法自动撤销；请核对后更正持仓及现金")
        if holding["account_id"] != trade["account_id"] or not all((
            isclose(holding["quantity"], trade["quantity_after"], abs_tol=1e-8),
            isclose(holding["buy_price"], trade["cost_after"], abs_tol=1e-8),
            account["currency"] == trade["account_currency"],
        )):
            raise HTTPException(status_code=409, detail="交易后持仓或币种已手工修改，请核对后再撤销")
        now = datetime.now().isoformat(timespec="seconds")
        delta = trade["cash_amount"] * (1 if trade["trade_type"] == "buy" else -1)
        if account["cash_available"] + delta < -1e-8:
            raise HTTPException(status_code=409, detail="撤销卖出所需现金不足")
        conn.execute("UPDATE accounts SET cash_available = cash_available + ?, updated_at = ? WHERE id = ?",
                     (delta, now, account["id"]))
        conn.execute("UPDATE holdings SET quantity = ?, buy_price = ?, updated_at = ? WHERE id = ?",
                     (trade["quantity_before"], trade["cost_before"], now, holding["id"]))
        conn.execute("UPDATE investment_trades SET voided_at = ?, void_reason = ? WHERE id = ?",
                     (now, payload.reason, trade_id))
    return {"message": "交易已撤销，现金、数量及持仓成本已还原"}


@router.get("/holdings")
def legacy_holdings():
    return get_holdings()


@router.post("/holdings")
@financial_command
def add_holding(holding: HoldingCreate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    if holding.account_id:
        lock_row(conn, "accounts", holding.account_id)
    try:
        validate_investment_account(conn, holding.account_id)
    except HTTPException:
        conn.close()
        raise
    cursor = conn.execute(
        """
        INSERT INTO holdings
        (name, code, buy_price, quantity, current_price, account_id, asset_type, market,
         currency, exchange_rate_to_base, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            holding.name,
            holding.code,
            holding.buy_price,
            holding.quantity,
            holding.current_price,
            holding.account_id,
            holding.asset_type,
            holding.market,
            holding.currency,
            holding.exchange_rate_to_base,
            now,
        ),
    )
    conn.commit()
    holding_id = cursor.lastrowid
    conn.close()
    return {"id": holding_id, "message": "添加成功"}


@router.patch("/holdings/{holding_id}")
@financial_command
def update_holding(holding_id: int, holding: HoldingCreate):
    now = datetime.now().isoformat(timespec="seconds")
    with write_connection() as conn:
        existing = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="持仓不存在")
        previous_account_id = existing["account_id"]
        for account_id in sorted({value for value in (existing["account_id"], holding.account_id) if value}):
            lock_row(conn, "accounts", account_id)
        existing = lock_row(conn, "holdings", holding_id)
        if not existing or existing["account_id"] != previous_account_id:
            raise HTTPException(status_code=409, detail="持仓已变更，请刷新")
        validate_investment_account(conn, holding.account_id)
        has_history = conn.execute("SELECT id FROM investment_trades WHERE holding_id = ? LIMIT 1", (holding_id,)).fetchone()
        if has_history and any(existing[key] != getattr(holding, key) for key in ("account_id", "currency", "code", "market")):
            raise HTTPException(status_code=409, detail="含交易历史的持仓不能改变账户、币种或标的")
        active_trade = conn.execute("SELECT id FROM investment_trades WHERE holding_id = ? AND voided_at IS NULL LIMIT 1", (holding_id,)).fetchone()
        if active_trade and (not isclose(existing["quantity"], holding.quantity, abs_tol=1e-8)
                             or not isclose(existing["buy_price"], holding.buy_price, abs_tol=1e-8)):
            raise HTTPException(status_code=409, detail="请通过买卖或撤销交易更正持仓数量和成本")
        conn.execute(
            """
            UPDATE holdings
            SET name = ?, code = ?, buy_price = ?, quantity = ?, current_price = ?,
                account_id = ?, asset_type = ?, market = ?, currency = ?,
                exchange_rate_to_base = ?, updated_at = ?
            WHERE id = ?
            """,
            (holding.name, holding.code, holding.buy_price, holding.quantity, holding.current_price,
             holding.account_id, holding.asset_type, holding.market, holding.currency,
             holding.exchange_rate_to_base, now, holding_id),
        )
    return {"message": "持仓已更新"}


@router.delete("/holdings/{holding_id}")
@financial_command
def delete_holding(holding_id: int):
    with write_connection() as conn:
        existing = conn.execute("SELECT account_id FROM holdings WHERE id = ?", (holding_id,)).fetchone()
        if existing and existing["account_id"]:
            lock_row(conn, "accounts", existing["account_id"])
        lock_row(conn, "holdings", holding_id)
        if conn.execute("SELECT 1 FROM investment_trades WHERE holding_id = ? LIMIT 1", (holding_id,)).fetchone():
            raise HTTPException(status_code=409, detail="含交易历史的持仓不能删除，请通过卖出或撤销维护数量")
        conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    return {"message": "删除成功"}


@router.post("/refresh")
def legacy_refresh():
    result = refresh_holding_prices()
    return {"message": f"已更新 {result['updated']} 项行情", **result}


@router.post("/investments/refresh")
def refresh_investments():
    result = refresh_holding_prices()
    return {"message": f"已更新 {result['updated']} 项行情", **result}
