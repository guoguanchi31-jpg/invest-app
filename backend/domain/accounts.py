"""Account state rules that do not depend on HTTP or database frameworks."""

from dataclasses import dataclass

from domain.money import money


@dataclass(frozen=True)
class AccountStateViolation(ValueError):
    account_id: int | None
    account_name: str
    rule: str

    def __str__(self):
        label = f"“{self.account_name}”" if self.account_name else ""
        return f"投资账户{label}现金可投不能为负数"


def balance_field(account):
    return "cash_available" if account["type"] == "investment" else "balance"


def account_state_defaults(account):
    """Match SQL defaults for omitted state fields; explicit values stay intact."""
    return {"is_liability": 0, "balance": 0, "cash_available": 0, **dict(account)}


def validate_account_state(account):
    """Validate persisted state without changing ordinary or liability semantics."""
    account = account_state_defaults(account)
    if (
        account["type"] == "investment"
        and not bool(account["is_liability"])
        and money(account.get("cash_available") or 0) < 0
    ):
        raise AccountStateViolation(
            account.get("id"),
            account.get("name") or "",
            "non_liability_investment_cash_nonnegative",
        )
    return account


def validate_opening_state(*, account_type, is_liability, opening_balance, name=""):
    state = {
        "id": None,
        "name": name,
        "type": account_type,
        "is_liability": int(bool(is_liability)),
        "cash_available": opening_balance if account_type == "investment" else 0,
        "balance": opening_balance if account_type != "investment" else 0,
    }
    return validate_account_state(state)
