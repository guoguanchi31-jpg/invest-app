from fastapi import APIRouter

from application.commands import financial_command
from application.investments import (
    add_holding as add_holding_use_case,
    create_investment_trade as create_investment_trade_use_case,
    delete_holding as delete_holding_use_case,
    investment_holdings as investment_holdings_query,
    investment_summary as investment_summary_query,
    legacy_holdings as legacy_holdings_query,
    legacy_refresh as legacy_refresh_use_case,
    list_investment_trades as list_investment_trades_query,
    refresh_investments as refresh_investments_use_case,
    reverse_investment_trade as reverse_investment_trade_use_case,
    update_holding as update_holding_use_case,
    update_investment_cash as update_investment_cash_use_case,
)
from schemas import HoldingCreate, InvestmentCashUpdate, InvestmentTradeCreate, ReversalCreate
from infrastructure.database import current_command_connection
from tenancy import get_auth_context


router = APIRouter(tags=["investments"])


@router.get("/investments/summary")
def investment_summary(month: str | None = None, trend_range: str = "12m"):
    return investment_summary_query(month, trend_range)


@router.get("/investments/holdings")
def investment_holdings():
    return investment_holdings_query()


@router.patch("/investments/cash-available")
@financial_command
def update_investment_cash(payload: InvestmentCashUpdate):
    conn = current_command_connection()
    return update_investment_cash_use_case(
        conn,
        get_auth_context(conn),
        payload,
    )


@router.get("/investments/trades")
def list_investment_trades(
    account_id: int | None = None,
    holding_id: int | None = None,
    page: int | None = None,
    page_size: int = 50,
):
    return list_investment_trades_query(
        account_id,
        holding_id,
        page,
        page_size,
    )


@router.post("/investments/trades")
@financial_command
def create_investment_trade(trade: InvestmentTradeCreate):
    conn = current_command_connection()
    return create_investment_trade_use_case(
        conn,
        get_auth_context(conn),
        trade,
    )


@router.post("/investments/trades/{trade_id}/reverse")
@financial_command
def reverse_investment_trade(trade_id: int, payload: ReversalCreate):
    conn = current_command_connection()
    return reverse_investment_trade_use_case(
        conn,
        get_auth_context(conn),
        trade_id,
        payload,
    )


@router.get("/holdings")
def legacy_holdings():
    return legacy_holdings_query()


@router.post("/holdings")
@financial_command
def add_holding(holding: HoldingCreate):
    conn = current_command_connection()
    return add_holding_use_case(conn, get_auth_context(conn), holding)


@router.patch("/holdings/{holding_id}")
@financial_command
def update_holding(holding_id: int, holding: HoldingCreate):
    conn = current_command_connection()
    return update_holding_use_case(
        conn,
        get_auth_context(conn),
        holding_id,
        holding,
    )


@router.delete("/holdings/{holding_id}")
@financial_command
def delete_holding(holding_id: int):
    conn = current_command_connection()
    return delete_holding_use_case(
        conn,
        get_auth_context(conn),
        holding_id,
    )


@router.post("/refresh")
def legacy_refresh():
    return legacy_refresh_use_case()


@router.post("/investments/refresh")
def refresh_investments():
    return refresh_investments_use_case()
