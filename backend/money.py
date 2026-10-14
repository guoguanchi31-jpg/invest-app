"""Compatibility exports for decimal domain primitives."""

from domain.money import (
    MONEY_QUANTUM,
    PRICE_QUANTUM,
    QUANTITY_QUANTUM,
    RATE_QUANTUM,
    ZERO,
    decimal_text,
    decimal_value,
    money,
    money_equal,
    money_json,
    price,
    price_json,
    quantity,
    quantize,
    rate,
)

__all__ = [
    "MONEY_QUANTUM",
    "PRICE_QUANTUM",
    "QUANTITY_QUANTUM",
    "RATE_QUANTUM",
    "ZERO",
    "decimal_text",
    "decimal_value",
    "money",
    "money_equal",
    "money_json",
    "price",
    "price_json",
    "quantity",
    "quantize",
    "rate",
]
