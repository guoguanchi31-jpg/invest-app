from fastapi import HTTPException

from infrastructure.accounting_store import reconcile_account_balance
from application.commands import AuditFact, command_result
from domain.calendar import business_now, business_today
from domain.dates import date_on_or_after
from infrastructure.database import lock_row
from domain.money import decimal_value, money, price, quantity, rate
from tenancy import get_account_for_access


def validate_investment_account(conn, account_id, context=None):
    if account_id is None:
        return None
    account = get_account_for_access(
        conn,
        account_id,
        write=True,
        context=context,
    )
    if (
        not account["is_active"]
        or account["is_liability"]
        or account["type"] != "investment"
    ):
        raise HTTPException(
            status_code=409,
            detail="持仓只能关联启用中的非负债投资账户",
        )
    return account


def reconcile_investment_cash(conn, context, payload):
    now = business_now().isoformat(timespec="seconds")
    lock_row(conn, "accounts", payload.account_id)
    account = validate_investment_account(conn, payload.account_id, context)
    before = dict(account)
    response = reconcile_account_balance(
        conn,
        account,
        actual_balance=payload.cash_available,
        expected_balance=payload.expected_cash_available,
        occurred_at=business_today().isoformat(),
        reason=payload.reason,
        updated_at=now,
    )
    after = dict(conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account["id"],),
    ).fetchone())
    return command_result(
        response,
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="修改现金可投",
            entity_type="account",
            entity_id=account["id"],
            summary=f"修改现金可投：{account['name']}",
            reason=payload.reason,
            account_ids=(account["id"],),
            before_value=before,
            after_value=after,
        ),),
    )


def create_investment_trade(conn, trade, context):
    if trade.new_holding:
        new = trade.new_holding
        lock_row(conn, "accounts", new.account_id)
        account = validate_investment_account(conn, new.account_id, context)
        if conn.execute(
            """
            SELECT id FROM holdings
            WHERE account_id = ? AND UPPER(code) = UPPER(?)
              AND COALESCE(market, '') = ?
            """,
            (new.account_id, new.code.strip(), new.market or ""),
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="该账户已有此标的，请在已有持仓上买入",
            )
        now = business_now().isoformat(timespec="seconds")
        holding_id = conn.execute(
            """
            INSERT INTO holdings
            (family_id, member_id, name, code, account_id, asset_type, market,
             currency, exchange_rate_to_base, quantity, buy_price, current_price,
             updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?) RETURNING id
            """,
            (
                context.family_id,
                account["member_id"],
                new.name,
                new.code.strip(),
                new.account_id,
                new.asset_type,
                new.market,
                new.currency,
                new.exchange_rate_to_base,
                trade.price,
                now,
            ),
        ).fetchone()["id"]
    else:
        holding_id = trade.holding_id
    return execute_investment_trade(conn, context, holding_id, trade)


def execute_investment_trade(conn, context, holding_id, trade):
    now = business_now().isoformat(timespec="seconds")
    holding = conn.execute(
        "SELECT * FROM holdings WHERE id = ?",
        (holding_id,),
    ).fetchone()
    if not holding:
        raise HTTPException(status_code=404, detail="持仓不存在")
    if not holding["account_id"]:
        raise HTTPException(status_code=409, detail="请先为持仓关联投资账户")
    account_id = holding["account_id"]
    lock_row(conn, "accounts", account_id)
    holding = lock_row(conn, "holdings", holding_id)
    if not holding or holding["account_id"] != account_id:
        raise HTTPException(status_code=409, detail="持仓已变更，请刷新重试")
    account = validate_investment_account(conn, holding["account_id"], context)
    if holding["family_id"] != account["family_id"]:
        raise HTTPException(status_code=404, detail="持仓不存在")
    if (
        dict(account).get("opened_at")
        and not date_on_or_after(trade.occurred_at, account["opened_at"])
    ):
        raise HTTPException(
            status_code=409,
            detail="建账前的投资请录入已有持仓，实际交易日期不能早于建账日",
        )

    account_rate = rate(account["exchange_rate_to_base"] or 1)
    trade_quantity = quantity(trade.quantity)
    trade_price = price(trade.price)
    trade_fee = price(trade.fee)
    gross_amount = price(trade_quantity * trade_price)
    trade_amount = (
        gross_amount + trade_fee
        if trade.trade_type == "buy"
        else gross_amount - trade_fee
    )
    if trade_amount <= 0:
        raise HTTPException(status_code=409, detail="手续费不能大于或等于卖出金额")
    same_currency = (
        (holding["currency"] or "CNY").upper()
        == (account["currency"] or "CNY").upper()
    )
    if same_currency:
        settlement_rate = rate(1)
        if (
            trade.settlement_rate is not None
            and rate(trade.settlement_rate) != settlement_rate
        ):
            raise HTTPException(status_code=409, detail="同币种交易按原币 1:1 结算")
    elif trade.settlement_rate is None:
        raise HTTPException(status_code=409, detail="跨币种交易请确认结算汇率")
    else:
        settlement_rate = rate(trade.settlement_rate)
    account_cash_amount = money(trade_amount * settlement_rate)
    holding_rate = rate(settlement_rate * account_rate)
    base_amount = money(account_cash_amount * account_rate)

    before_holding = dict(holding)
    before_account = dict(account)
    if trade.trade_type == "buy":
        cash_cursor = conn.execute(
            """
            UPDATE accounts
            SET cash_available = ROUND(cash_available - ?, 2), updated_at = ?
            WHERE id = ? AND cash_available >= ?
            """,
            (account_cash_amount, now, account["id"], account_cash_amount),
        )
        if not cash_cursor.rowcount:
            raise HTTPException(status_code=409, detail="投资账户现金可投不足")
        previous_quantity = quantity(holding["quantity"] or 0)
        next_quantity = quantity(previous_quantity + trade_quantity)
        previous_cost = price(holding["buy_price"] or 0)
        next_cost = price(
            (
                previous_cost * previous_quantity
                + gross_amount
                + trade_fee
            )
            / next_quantity
        )
        conn.execute(
            """
            UPDATE holdings
            SET buy_price = ?, quantity = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_cost, next_quantity, now, holding["id"]),
        )
    else:
        next_quantity = quantity(
            decimal_value(holding["quantity"]) - trade_quantity
        )
        if next_quantity < 0:
            raise HTTPException(status_code=409, detail="卖出数量不能超过当前持仓")
        holding_cursor = conn.execute(
            """
            UPDATE holdings SET quantity = ?, updated_at = ?
            WHERE id = ? AND quantity >= ?
            """,
            (next_quantity, now, holding["id"], trade_quantity),
        )
        if not holding_cursor.rowcount:
            raise HTTPException(status_code=409, detail="卖出数量不能超过当前持仓")
        conn.execute(
            """
            UPDATE accounts
            SET cash_available = ROUND(cash_available + ?, 2), updated_at = ?
            WHERE id = ?
            """,
            (account_cash_amount, now, account["id"]),
        )

    updated_holding = conn.execute(
        "SELECT * FROM holdings WHERE id = ?",
        (holding["id"],),
    ).fetchone()
    trade_id = conn.execute(
        """
        INSERT INTO investment_trades
        (family_id, member_id, holding_id, account_id, trade_type, quantity, price,
         fee, cash_amount, currency, exchange_rate_to_base, base_amount, occurred_at,
         note, created_at, quantity_before, cost_before, quantity_after, cost_after,
         account_currency, settlement_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (
            account["family_id"],
            account["member_id"],
            holding["id"],
            account["id"],
            trade.trade_type,
            trade_quantity,
            trade_price,
            trade_fee,
            account_cash_amount,
            holding["currency"] or "CNY",
            holding_rate,
            base_amount,
            trade.occurred_at,
            trade.note,
            now,
            quantity(holding["quantity"] or 0),
            price(holding["buy_price"] or 0),
            quantity(updated_holding["quantity"]),
            price(updated_holding["buy_price"]),
            account["currency"],
            settlement_rate,
        ),
    ).fetchone()["id"]
    updated_account = conn.execute(
        "SELECT * FROM accounts WHERE id = ?",
        (account["id"],),
    ).fetchone()
    trade_row = dict(conn.execute(
        "SELECT * FROM investment_trades WHERE id = ?",
        (trade_id,),
    ).fetchone())
    response = {
        "id": trade_id,
        "message": "买入已记录" if trade.trade_type == "buy" else "卖出已记录",
        "holding_quantity": quantity(updated_holding["quantity"]),
        "holding_buy_price": price(updated_holding["buy_price"]),
        "cash_available": money(updated_account["cash_available"]),
        "holding_id": holding_id,
    }
    return command_result(
        response,
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="记录投资交易",
            entity_type="investment_trade",
            entity_id=trade_id,
            summary=(
                f"{'买入' if trade.trade_type == 'buy' else '卖出'}"
                f"：{holding['name']} {trade_quantity} × {trade_price}"
            ),
            reason=trade.note,
            account_ids=(account["id"],),
            before_value=None,
            after_value={
                **trade_row,
                "account_before": before_account,
                "account_after": dict(updated_account),
                "holding_before": before_holding,
                "holding_after": dict(updated_holding),
            },
        ),),
    )


def reverse_investment_trade(conn, context, trade_id, payload):
    candidate = conn.execute(
        "SELECT * FROM investment_trades WHERE id = ?",
        (trade_id,),
    ).fetchone()
    if not candidate:
        raise HTTPException(status_code=404, detail="交易不存在")
    lock_row(conn, "accounts", candidate["account_id"])
    holding = lock_row(conn, "holdings", candidate["holding_id"])
    trade = lock_row(conn, "investment_trades", trade_id)
    if (
        not trade
        or trade["account_id"] != candidate["account_id"]
        or trade["holding_id"] != candidate["holding_id"]
    ):
        raise HTTPException(status_code=409, detail="交易关联已变化，请刷新后重试")
    account = get_account_for_access(
        conn,
        trade["account_id"],
        write=True,
        context=context,
    )
    if not account or not holding or trade["voided_at"]:
        raise HTTPException(status_code=409, detail="交易已撤销或关联账户/持仓缺失")
    if not account["is_active"]:
        raise HTTPException(status_code=409, detail="关联账户已归档，不能撤销")
    later = conn.execute(
        """
        SELECT id FROM investment_trades
        WHERE holding_id = ? AND id > ? AND voided_at IS NULL LIMIT 1
        """,
        (trade["holding_id"], trade_id),
    ).fetchone()
    if later:
        raise HTTPException(status_code=409, detail="请先撤销同一持仓最近一笔交易")
    if trade["quantity_before"] is None:
        raise HTTPException(
            status_code=409,
            detail="旧交易缺少成本快照，无法自动撤销；请核对后更正持仓及现金",
        )
    state_matches = (
        holding["account_id"] == trade["account_id"]
        and quantity(holding["quantity"]) == quantity(trade["quantity_after"])
        and price(holding["buy_price"]) == price(trade["cost_after"])
        and account["currency"] == trade["account_currency"]
    )
    if not state_matches:
        raise HTTPException(
            status_code=409,
            detail="交易后持仓或币种已手工修改，请核对后再撤销",
        )

    before = dict(trade)
    now = business_now().isoformat(timespec="seconds")
    delta = money(
        decimal_value(trade["cash_amount"])
        * (1 if trade["trade_type"] == "buy" else -1)
    )
    if money(account["cash_available"]) + delta < 0:
        raise HTTPException(status_code=409, detail="撤销卖出所需现金不足")
    conn.execute(
        """
        UPDATE accounts
        SET cash_available = ROUND(cash_available + ?, 2), updated_at = ?
        WHERE id = ?
        """,
        (delta, now, account["id"]),
    )
    conn.execute(
        """
        UPDATE holdings SET quantity = ?, buy_price = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            trade["quantity_before"],
            trade["cost_before"],
            now,
            holding["id"],
        ),
    )
    conn.execute(
        """
        UPDATE investment_trades
        SET voided_at = ?, void_reason = ?
        WHERE id = ?
        """,
        (now, payload.reason, trade_id),
    )
    after = dict(conn.execute(
        "SELECT * FROM investment_trades WHERE id = ?",
        (trade_id,),
    ).fetchone())
    return command_result(
        {"message": "交易已撤销，现金、数量及持仓成本已还原"},
        affected_account_ids=(account["id"],),
        affected_member_ids=(account["member_id"],),
        audit_facts=(AuditFact(
            action="撤销投资交易",
            entity_type="investment_trade",
            entity_id=trade_id,
            summary=f"撤销投资交易：{holding['name']}",
            reason=payload.reason,
            account_ids=(account["id"],),
            before_value=before,
            after_value=after,
        ),),
    )
