"""Historical transfer valuation and the bounded loss of a stored FX rate."""
from decimal import localcontext

from domain.money import MONEY_QUANTUM, RATE_QUANTUM, decimal_value, money, money_equal, rate


def transfer_valuation(from_amount, from_rate, to_amount, *, same_currency):
    with localcontext() as ctx:
        ctx.prec = 60
        exact_base = money(from_amount) * rate(from_rate)
        destination_rate = rate(from_rate) if same_currency else rate(exact_base / money(to_amount))
        if destination_rate <= 0:
            raise ValueError("到账金额对应的历史汇率低于可保存精度，请核对转账金额")
        return money(exact_base), destination_rate


def recipient_rounding_is_valid(recipient, legs):
    """Only a complete transfer pair can prove a recipient's rounding residual.

    The expense leg is independently valued. Both stored base amounts must match;
    no current account rate is consulted. This also accepts legacy transfers whose
    recipient rate was derived from the rounded (rather than exact) source base.
    """
    if len(legs) != 2 or recipient.get("direction") != "income":
        return False
    source = next((leg for leg in legs if leg.get("direction") == "expense"), None)
    if not source or any(leg.get("source") != "transfer" for leg in legs):
        return False
    if (
        source.get("account_id") == recipient.get("account_id")
        or source.get("family_id") != recipient.get("family_id")
        or source.get("occurred_at") != recipient.get("occurred_at")
        or source.get("voided_at") != recipient.get("voided_at")
        or source.get("amount", 0) <= 0
        or source.get("exchange_rate_to_base", 0) <= 0
        or source.get("base_amount") is None
        or source["base_amount"] != recipient["base_amount"]
    ):
        return False
    with localcontext() as ctx:
        ctx.prec = 60
        if not money_equal(
            source["base_amount"], money(source["amount"]) * rate(source["exchange_rate_to_base"]),
        ):
            return False
        amount = money(recipient["amount"])
        residual = abs(amount * rate(recipient["exchange_rate_to_base"]) - decimal_value(recipient["base_amount"]))
        return residual <= amount * RATE_QUANTUM / 2 + MONEY_QUANTUM / 2
