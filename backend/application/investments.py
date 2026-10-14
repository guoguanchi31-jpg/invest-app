from fastapi import HTTPException

from domain.calendar import business_now
from application.commands import AuditFact, command_result
from infrastructure.database import lock_row, rows_to_dicts
from infrastructure.read_models import consistent_query
from application.investing import (
    create_investment_trade as create_investment_trade_use_case,
    reconcile_investment_cash,
    reverse_investment_trade as reverse_investment_trade_use_case,
    validate_investment_account,
)
from application.market_data import refresh_holding_prices
from domain.money import decimal_value, money, price, quantity
from schemas import (
    HoldingCreate,
    InvestmentCashUpdate,
    InvestmentTradeCreate,
    ReversalCreate,
)
from queries.finance import (
    get_holdings,
    get_investment_summary,
)
from tenancy import (
    can_edit_member,
    can_manage_family,
    get_account_for_access,
    get_auth_context,
    scoped_account_clause,
    scoped_member_data_clause,
)


def _trade_reversal_availability(item, context):
    if item.get("voided_at"):
        return False, "交易已撤销"
    if not can_edit_member(item.get("account_member_id"), context):
        return False, "仅可撤销自己账户的交易"
    if not item.get("account_is_active"):
        return False, "关联账户已归档，不能撤销"
    if item.get("latest_active_trade_id") != item.get("id"):
        return False, "请先撤销同一持仓最近一笔交易"
    required_snapshot_fields = (
        "quantity_before",
        "quantity_after",
        "cost_before",
        "cost_after",
        "cash_amount",
        "account_currency",
    )
    if any(item.get(field) is None for field in required_snapshot_fields):
        return False, "旧记录缺少交易快照，不能直接撤销"
    state_matches = (
        item.get("holding_account_id") == item.get("account_id")
        and quantity(item.get("holding_quantity")) == quantity(item.get("quantity_after"))
        and price(item.get("holding_cost")) == price(item.get("cost_after"))
        and item.get("account_currency") == item.get("current_account_currency")
    )
    if not state_matches:
        return False, "交易后的持仓或账户币种已变化，请核对后再撤销"
    if (
        item.get("trade_type") == "sell"
        and money(item.get("account_cash_available"))
        < money(decimal_value(item.get("cash_amount")))
    ):
        return False, "撤销卖出所需现金不足"
    return True, None


def investment_summary(month: str | None = None, trend_range: str = "12m"):
    return get_investment_summary(month, trend_range)


def investment_holdings():
    return get_holdings()


def update_investment_cash(conn, context, payload: InvestmentCashUpdate):
    return reconcile_investment_cash(conn, context, payload)


@consistent_query
def list_investment_trades(
    account_id: int | None = None,
    holding_id: int | None = None,
    page: int | None = None,
    page_size: int = 50,
    *,
    conn=None,
):
    if page is not None and page < 1:
        raise HTTPException(status_code=422, detail="页码必须大于零")
    page_size = min(max(page_size, 1), 100)
    context = get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    clauses = [account_scope]
    params = list(account_scope_params)
    if account_id:
        clauses.append("it.account_id = ?")
        params.append(account_id)
    if holding_id:
        clauses.append("it.holding_id = ?")
        params.append(holding_id)
    total = conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM investment_trades it
        JOIN accounts a ON a.id = it.account_id
        WHERE {" AND ".join(clauses)}
        """,
        tuple(params),
    ).fetchone()["count"]
    pagination = ""
    query_params = list(params)
    if page is not None:
        pagination = "LIMIT ? OFFSET ?"
        query_params.extend([page_size, (page - 1) * page_size])
    rows = conn.execute(
        f"""
        SELECT
            it.*, h.name AS holding_name, h.code AS holding_code,
            a.name AS account_name, a.owner AS account_owner,
            a.currency AS current_account_currency,
            a.member_id AS account_member_id,
            a.is_active AS account_is_active,
            a.cash_available AS account_cash_available,
            h.account_id AS holding_account_id,
            h.quantity AS holding_quantity,
            h.buy_price AS holding_cost,
            (
                SELECT MAX(active_trade.id)
                FROM investment_trades active_trade
                WHERE active_trade.holding_id = it.holding_id
                  AND active_trade.voided_at IS NULL
            ) AS latest_active_trade_id
        FROM investment_trades it
        LEFT JOIN holdings h ON h.id = it.holding_id
        LEFT JOIN accounts a ON a.id = it.account_id
        WHERE {" AND ".join(clauses)}
        ORDER BY it.occurred_at DESC, it.id DESC
        {pagination}
        """,
        tuple(query_params),
    ).fetchall()
    items = rows_to_dicts(rows)
    for item in items:
        can_reverse, reason = _trade_reversal_availability(item, context)
        item["can_reverse"] = can_reverse
        item["reverse_disabled_reason"] = reason
    if page is None:
        return items
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


def create_investment_trade(conn, context, trade: InvestmentTradeCreate):
    return create_investment_trade_use_case(conn, trade, context)


def reverse_investment_trade(conn, context, trade_id: int, payload: ReversalCreate):
    return reverse_investment_trade_use_case(
        conn,
        context,
        trade_id,
        payload,
    )


def legacy_holdings():
    return get_holdings()


def add_holding(conn, context, holding: HoldingCreate):
    now = business_now().isoformat(timespec="seconds")
    if holding.account_id:
        lock_row(conn, "accounts", holding.account_id)
    account = validate_investment_account(conn, holding.account_id, context)
    cursor = conn.execute(
        """
        INSERT INTO holdings
        (family_id, member_id, name, code, buy_price, quantity, current_price,
         account_id, asset_type, market, currency, exchange_rate_to_base, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (
            context.family_id,
            account["member_id"] if account else context.member_id,
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
    holding_id = cursor.fetchone()["id"]
    after = dict(conn.execute(
        "SELECT * FROM holdings WHERE id = ?",
        (holding_id,),
    ).fetchone())
    member_id = account["member_id"] if account else context.member_id
    return command_result(
        {"id": holding_id, "message": "添加成功"},
        affected_account_ids=(holding.account_id,) if holding.account_id else (),
        affected_member_ids=(member_id,),
        audit_facts=(AuditFact(
            action="录入持仓",
            entity_type="holding",
            entity_id=holding_id,
            summary=f"录入持仓：{holding.name}",
            account_ids=(holding.account_id,) if holding.account_id else (),
            after_value=after,
        ),),
    )


def update_holding(conn, context, holding_id: int, holding: HoldingCreate):
    now = business_now().isoformat(timespec="seconds")
    holding_scope, holding_scope_params = scoped_member_data_clause("holdings", context)
    existing = conn.execute(
        f"SELECT * FROM holdings WHERE id = ? AND {holding_scope}",
        (holding_id, *holding_scope_params),
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="持仓不存在")
    previous_account_id = existing["account_id"]
    for account_id in sorted({
        value for value in (existing["account_id"], holding.account_id) if value
    }):
        lock_row(conn, "accounts", account_id)
    existing = lock_row(conn, "holdings", holding_id)
    if not existing or existing["account_id"] != previous_account_id:
        raise HTTPException(status_code=409, detail="持仓已变更，请刷新")
    if existing["account_id"]:
        get_account_for_access(
            conn,
            existing["account_id"],
            write=True,
            context=context,
        )
    elif not can_manage_family(context) and existing["member_id"] != context.member_id:
        raise HTTPException(status_code=403, detail="只能修改自己的持仓")
    account = validate_investment_account(conn, holding.account_id, context)
    has_history = conn.execute(
        "SELECT id FROM investment_trades WHERE holding_id = ? LIMIT 1",
        (holding_id,),
    ).fetchone()
    if has_history and any(
        existing[key] != getattr(holding, key)
        for key in ("account_id", "currency", "code", "market")
    ):
        raise HTTPException(status_code=409, detail="含交易历史的持仓不能改变账户、币种或标的")
    active_trade = conn.execute(
        "SELECT id FROM investment_trades "
        "WHERE holding_id = ? AND voided_at IS NULL LIMIT 1",
        (holding_id,),
    ).fetchone()
    if active_trade and (
        quantity(existing["quantity"]) != quantity(holding.quantity)
        or price(existing["buy_price"]) != price(holding.buy_price)
    ):
        raise HTTPException(status_code=409, detail="请通过买卖或撤销交易更正持仓数量和成本")
    conn.execute(
        """
        UPDATE holdings
        SET name = ?, code = ?, buy_price = ?, quantity = ?, current_price = ?,
            account_id = ?, asset_type = ?, market = ?, currency = ?,
            exchange_rate_to_base = ?, member_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            holding.name, holding.code, holding.buy_price, holding.quantity,
            holding.current_price, holding.account_id, holding.asset_type,
            holding.market, holding.currency, holding.exchange_rate_to_base,
            account["member_id"] if account else existing["member_id"],
            now, holding_id,
        ),
    )
    after = dict(conn.execute(
        "SELECT * FROM holdings WHERE id = ?",
        (holding_id,),
    ).fetchone())
    next_member_id = account["member_id"] if account else existing["member_id"]
    account_ids = tuple(dict.fromkeys(
        value for value in (existing["account_id"], holding.account_id) if value
    ))
    return command_result(
        {"message": "持仓已更新"},
        affected_account_ids=account_ids,
        affected_member_ids=(existing["member_id"], next_member_id),
        audit_facts=(AuditFact(
            action="修改持仓",
            entity_type="holding",
            entity_id=holding_id,
            summary=f"修改持仓：{holding.name}",
            account_ids=account_ids,
            before_value=dict(existing),
            after_value=after,
        ),),
    )


def delete_holding(conn, context, holding_id: int):
    holding_scope, holding_scope_params = scoped_member_data_clause("holdings", context)
    existing = conn.execute(
        f"SELECT * FROM holdings WHERE id = ? AND {holding_scope}",
        (holding_id, *holding_scope_params),
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="持仓不存在")
    if existing["account_id"]:
        lock_row(conn, "accounts", existing["account_id"])
        get_account_for_access(
            conn,
            existing["account_id"],
            write=True,
            context=context,
        )
    elif not can_manage_family(context) and existing["member_id"] != context.member_id:
        raise HTTPException(status_code=403, detail="只能删除自己的持仓")
    locked = lock_row(conn, "holdings", holding_id)
    if not locked or locked["account_id"] != existing["account_id"]:
        raise HTTPException(status_code=409, detail="持仓归属已变化，请刷新后重试")
    existing = locked
    if conn.execute(
        "SELECT 1 FROM investment_trades WHERE holding_id = ? LIMIT 1",
        (holding_id,),
    ).fetchone():
        raise HTTPException(status_code=409, detail="含交易历史的持仓不能删除，请通过卖出或撤销维护数量")
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    return command_result(
        {"message": "删除成功"},
        affected_account_ids=(
            (existing["account_id"],) if existing["account_id"] else ()
        ),
        affected_member_ids=(existing["member_id"],),
        audit_facts=(AuditFact(
            action="删除持仓",
            entity_type="holding",
            entity_id=holding_id,
            summary=f"删除持仓：{existing['name']}",
            account_ids=(existing["account_id"],) if existing["account_id"] else (),
            before_value=dict(existing),
        ),),
    )


def legacy_refresh():
    result = refresh_holding_prices()
    return {"message": f"已更新 {result['updated']} 项行情", **result}


def refresh_investments():
    result = refresh_holding_prices()
    return {"message": f"已更新 {result['updated']} 项行情", **result}
