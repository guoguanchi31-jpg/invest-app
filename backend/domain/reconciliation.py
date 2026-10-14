"""Evidence of a ledger baseline, independent of today's balance difference."""

from domain.accounting import account_balance_delta, affects_balance
from domain.dates import stored_business_date
from domain.money import ZERO, money


HISTORY_BASES = frozenset({"unknown", "opening_transaction", "zero_opening"})


def expected_transaction_application(account, transaction):
    """Return the business meaning of balance_applied for one stored fact."""
    if transaction.get("source") == "adjustment":
        return True
    return affects_balance(account, transaction.get("occurred_at"))


def transaction_application_state(account, transaction):
    expected = expected_transaction_application(account, transaction)
    actual = bool(transaction.get("balance_applied", 1))
    return {
        "expected_balance_applied": expected,
        "actual_balance_applied": actual,
        "marker_consistent": actual == expected,
        "requires_correction": actual != expected and not bool(transaction.get("voided_at")),
    }


def transaction_application_diagnostics(account, transactions):
    issues = []
    blocking = []
    for transaction in transactions:
        state = transaction_application_state(account, transaction)
        expected = state["expected_balance_applied"]
        actual = state["actual_balance_applied"]
        if state["marker_consistent"]:
            continue
        voided = bool(transaction.get("voided_at"))
        correction_delta = ZERO
        if not voided:
            direction = transaction.get("direction")
            amount = transaction.get("amount")
            correction_delta = account_balance_delta(account, direction, amount)
            if actual and not expected:
                correction_delta = money(-correction_delta)
        issue = {
            "transaction_id": transaction.get("id"),
            "occurred_at": transaction.get("occurred_at"),
            "actual_balance_applied": actual,
            "expected_balance_applied": expected,
            "amount": money(transaction.get("amount") or 0),
            "direction": transaction.get("direction"),
            "source": transaction.get("source") or "manual",
            "voided_at": transaction.get("voided_at"),
            "requires_correction": not voided,
            "correction_delta": correction_delta,
        }
        issues.append(issue)
        if not voided:
            blocking.append(issue)
    status = "consistent"
    if blocking:
        status = "inconsistent"
    elif issues:
        status = "voided_only"
    return {
        "status": status,
        "marker_consistent": not issues,
        "balance_application_consistent": not blocking,
        "issue_count": len(blocking),
        "issues": issues,
    }


def account_history(account, transactions):
    basis = account.get("history_basis", "unknown")
    field = "cash_available" if account["type"] == "investment" else "balance"
    result = {
        "status": "incomplete", "source": basis,
        "baseline_date": None, "baseline_amount": None, "state_field": field,
    }
    try:
        opened_at = stored_business_date(account.get("opened_at"), nullable=False)
    except (ValueError, TypeError):
        return result
    openings = [row for row in transactions if row.get("source") == "opening"]
    if basis == "zero_opening" and not openings:
        amount = ZERO
    elif basis == "opening_transaction" and len(openings) == 1:
        opening = openings[0]
        if (
            not opening.get("balance_applied", 1)
            or opening.get("voided_at")
            or opening.get("direction") not in {"income", "expense"}
            or money(opening.get("amount") or 0) <= ZERO
        ):
            return result
        try:
            if stored_business_date(
                opening.get("occurred_at"), nullable=False,
            ) != opened_at:
                return result
        except (ValueError, TypeError):
            return result
        amount = account_balance_delta(
            {"is_liability": account.get("is_liability", 0)},
            opening["direction"], opening["amount"],
        )
    else:
        return result
    return {
        **result, "status": "complete",
        "baseline_date": opened_at, "baseline_amount": amount,
    }


def reconstruct_account_state(account, transactions, trades=()):
    """Rebuild the persisted account state from active ledger facts."""
    transaction_total = ZERO
    for row in transactions:
        if not row.get("balance_applied", 1) or row.get("voided_at"):
            continue
        transaction_total = money(
            transaction_total
            + account_balance_delta(account, row["direction"], row["amount"])
        )

    trade_total = ZERO
    if account["type"] == "investment":
        for row in trades:
            if row.get("voided_at"):
                continue
            sign = -1 if row["trade_type"] == "buy" else 1
            trade_total = money(
                trade_total + sign * money(row["cash_amount"])
            )

    expected = money(transaction_total + trade_total)
    field = "cash_available" if account["type"] == "investment" else "balance"
    actual = money(account.get(field) or 0)
    application = transaction_application_diagnostics(account, transactions)
    return {
        "state_field": field,
        "actual": actual,
        "ledger_transactions": transaction_total,
        "investment_settlements": trade_total,
        "expected": expected,
        "difference": money(actual - expected),
        "matches": actual == expected,
        "history": account_history(account, transactions),
        "application": application,
    }
