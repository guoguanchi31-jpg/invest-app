from domain.accounts import AccountStateViolation, validate_account_state
from domain.dates import date_on_or_after
from domain.money import money, money_equal, rate


class AccountingConflict(ValueError):
    pass


def account_balance_delta(account, direction, amount):
    sign = 1 if direction == "income" else -1
    if account["is_liability"]:
        sign *= -1
    return money(sign * money(amount))


def affects_balance(account, occurred_at):
    opened_at = dict(account).get("opened_at")
    return not opened_at or date_on_or_after(occurred_at, opened_at)


def account_balance_deltas(changes):
    """Net each account's changes before validating its final state."""
    deltas = {}
    for account, direction, amount in changes:
        account_id = int(account["id"])
        deltas[account_id] = money(
            deltas.get(account_id, 0)
            + account_balance_delta(account, direction, amount)
        )
    return deltas


def validate_balance_changes(accounts, deltas):
    if set(accounts) != set(deltas):
        raise AccountingConflict("账户已变化，请刷新后重试")

    for account_id in sorted(deltas):
        account = accounts[account_id]
        field = "cash_available" if account["type"] == "investment" else "balance"
        next_value = money(money(account[field]) + deltas[account_id])
        try:
            validate_account_state({**account, field: next_value})
        except AccountStateViolation as exc:
            raise AccountingConflict(f"{exc}，无法完成该操作") from exc


def validate_balance_states(accounts):
    try:
        for account in accounts:
            validate_account_state(dict(account))
    except AccountStateViolation as exc:
        raise AccountingConflict(f"{exc}，无法完成该操作") from exc


def plan_balance_reconciliation(
    account,
    *,
    actual_balance,
    expected_balance,
):
    """Calculate a correction; the caller owns locking and persistence."""
    field = "cash_available" if account["type"] == "investment" else "balance"
    current_balance = money(account[field] or 0)
    if expected_balance is not None and not money_equal(
        current_balance,
        expected_balance,
    ):
        raise AccountingConflict("账户余额已变化，请刷新并重新核对")
    actual_balance = money(actual_balance)
    if (
        account["type"] == "investment"
        and not account["is_liability"]
        and actual_balance < 0
    ):
        raise AccountingConflict("现金可投不能为负数")
    delta = money(actual_balance - current_balance)
    if delta == 0:
        raise AccountingConflict("核对余额与当前余额一致，无需调整")

    if account["is_liability"]:
        direction = "expense" if delta > 0 else "income"
    else:
        direction = "income" if delta > 0 else "expense"
    amount = abs(delta)
    exchange_rate = rate(account["exchange_rate_to_base"] or 1)
    return {
        "field": field,
        "direction": direction,
        "amount": amount,
        "exchange_rate": exchange_rate,
        "base_amount": money(amount * exchange_rate),
        "previous_balance": current_balance,
        "actual_balance": actual_balance,
        "difference": delta,
    }
