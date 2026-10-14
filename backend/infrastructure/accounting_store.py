"""Persist accounting changes on the caller's locked command transaction."""

from uuid import uuid4

from domain.accounting import (
    account_balance_deltas,
    plan_balance_reconciliation,
    validate_balance_changes,
    validate_balance_states,
)


def _accounts(conn, account_ids):
    ids = sorted({int(value) for value in account_ids if value is not None})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    return {
        row["id"]: dict(row)
        for row in conn.execute(
            f"""
            SELECT id, name, type, is_liability, balance, cash_available
            FROM accounts WHERE id IN ({placeholders}) ORDER BY id
            """,
            tuple(ids),
        ).fetchall()
    }


def apply_account_balance_delta(conn, account, direction, amount, updated_at):
    return apply_account_balance_changes(
        conn, ((account, direction, amount),), updated_at,
    )[account["id"]]


def apply_account_balance_changes(conn, changes, updated_at):
    deltas = account_balance_deltas(changes)
    accounts = _accounts(conn, deltas)
    validate_balance_changes(accounts, deltas)
    for account_id in sorted(deltas):
        field = "cash_available" if accounts[account_id]["type"] == "investment" else "balance"
        conn.execute(
            f"UPDATE accounts SET {field} = ROUND({field} + ?, 2), "
            "updated_at = ? WHERE id = ?",
            (deltas[account_id], updated_at, account_id),
        )
    return deltas


def assert_investment_cash_nonnegative(conn, account_ids):
    validate_balance_states(_accounts(conn, account_ids).values())


def reconcile_account_balance(
    conn, account, *, actual_balance, expected_balance, occurred_at, reason, updated_at,
):
    correction = plan_balance_reconciliation(
        account, actual_balance=actual_balance, expected_balance=expected_balance,
    )
    conn.execute(
        f"UPDATE accounts SET {correction['field']} = ?, updated_at = ? WHERE id = ?",
        (correction["actual_balance"], updated_at, account["id"]),
    )
    adjustment_id = conn.execute(
        """
        INSERT INTO transactions
        (family_id, member_id, account_id, category_id, amount, currency,
         exchange_rate_to_base, base_amount, fx_status, direction, occurred_at,
         merchant, note, source, reference_id, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'captured', ?, ?, '余额核对', ?,
                'adjustment', ?, ?, ?) RETURNING id
        """,
        (
            account["family_id"], account["member_id"], account["id"],
            correction["amount"], account["currency"], correction["exchange_rate"],
            correction["base_amount"], correction["direction"],
            occurred_at, reason, f"adjustment-{uuid4().hex}", updated_at, updated_at,
        ),
    ).fetchone()["id"]
    return {
        "id": adjustment_id,
        "message": "余额核对已记录",
        "previous_balance": correction["previous_balance"],
        "actual_balance": correction["actual_balance"],
        "difference": correction["difference"],
    }
