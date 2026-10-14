"""Canonical holding valuation and aggregation rules."""

from domain.money import ZERO, decimal_value, money, price, quantity, rate


def value_holding(row):
    """Round each holding to money precision before account/family aggregation."""
    item = dict(row)
    exchange_rate = rate(item.get("exchange_rate_to_base") or 1)
    holding_quantity = quantity(item.get("quantity") or 0)
    buy_price = price(item.get("buy_price") or 0)
    current_price = price(item.get("current_price") or 0)

    cost_original_exact = buy_price * holding_quantity
    market_original_exact = current_price * holding_quantity
    cost = money(cost_original_exact * exchange_rate)
    market_value = money(market_original_exact * exchange_rate)
    profit = money(market_value - cost)
    profit_rate = decimal_value(profit) / cost * 100 if cost else ZERO

    item["cost"] = cost
    item["cost_original"] = money(cost_original_exact)
    item["market_value_original"] = money(market_original_exact)
    item["market_value"] = market_value
    item["profit"] = profit
    item["profit_rate"] = round(profit_rate, 2)
    return item


def aggregate_valuations(rows):
    valuations = [value_holding(row) for row in rows]
    return {
        "holdings": valuations,
        "market_value": money(sum((item["market_value"] for item in valuations), ZERO)),
        "cost": money(sum((item["cost"] for item in valuations), ZERO)),
    }


def market_values_by_account(rows):
    totals = {}
    for row in rows:
        account_id = row.get("account_id")
        if account_id is None:
            continue
        value = value_holding(row)["market_value"]
        totals[account_id] = money(totals.get(account_id, ZERO) + value)
    return totals
