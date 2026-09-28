def account_balance_delta(account, direction, amount):
    sign = 1 if direction == "income" else -1
    if account["is_liability"]:
        sign *= -1
    return sign * amount


def affects_balance(account, occurred_at):
    opened_at = dict(account).get("opened_at")
    return not opened_at or occurred_at >= opened_at


def apply_account_balance_delta(conn, account, direction, amount, updated_at):
    field = "cash_available" if account["type"] == "investment" else "balance"
    delta = account_balance_delta(account, direction, amount)
    conn.execute(
        f"UPDATE accounts SET {field} = {field} + ?, updated_at = ? WHERE id = ?",
        (delta, updated_at, account["id"]),
    )
    return delta
