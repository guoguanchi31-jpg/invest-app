"""Current valuation, composed on the caller's snapshot without writing it."""

from datetime import datetime

from domain.calendar import business_today
from domain.money import ZERO, money
from queries.finance import get_effective_accounts, get_holdings


def current_valuation(conn, context, snapshot_date=None):
    accounts = get_effective_accounts(conn, context)
    holdings = get_holdings(conn=conn, context=context)
    assets = money(sum((a["balance"] for a in accounts if not a["is_liability"]), ZERO))
    liabilities = money(sum((a["balance"] for a in accounts if a["is_liability"]), ZERO))
    investment = money(sum(
        (h["market_value"] for h in holdings if h["included_in_totals"]), ZERO,
    ))
    return {
        "snapshot_date": snapshot_date or business_today().isoformat(),
        "asset_total": assets,
        "liability_total": liabilities,
        "net_worth": money(assets - liabilities),
        "investment_value": investment,
        "cash_value": money(assets - investment),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "scope": context.scope,
        "member_id": context.member_id if context.scope == "personal" else None,
    }
