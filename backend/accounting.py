"""Compatibility exports; rules and persistence live in separate layers."""

from domain.accounting import (
    AccountingConflict,
    account_balance_delta,
    affects_balance,
)
from infrastructure.accounting_store import (
    apply_account_balance_changes,
    apply_account_balance_delta,
    assert_investment_cash_nonnegative,
    reconcile_account_balance,
)

__all__ = [
    "AccountingConflict",
    "account_balance_delta",
    "affects_balance",
    "apply_account_balance_changes",
    "apply_account_balance_delta",
    "assert_investment_cash_nonnegative",
    "reconcile_account_balance",
]
