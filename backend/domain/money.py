from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


MONEY_QUANTUM = Decimal("0.01")
PRICE_QUANTUM = Decimal("0.00000001")
QUANTITY_QUANTUM = Decimal("0.00000001")
RATE_QUANTUM = Decimal("0.0000000001")
ZERO = Decimal("0")


def decimal_value(value, default=ZERO):
    if value is None or value == "":
        return default
    if isinstance(value, Decimal):
        result = value
    else:
        try:
            result = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValueError(f"无效数值：{value}") from exc
    if not result.is_finite():
        raise ValueError(f"无效数值：{value}")
    return result


def quantize(value, quantum):
    return decimal_value(value).quantize(quantum, rounding=ROUND_HALF_UP)


def money(value):
    return quantize(value, MONEY_QUANTUM)


def price(value):
    return quantize(value, PRICE_QUANTUM)


def quantity(value):
    return quantize(value, QUANTITY_QUANTUM)


def rate(value):
    return quantize(value, RATE_QUANTUM)


def money_equal(left, right):
    return money(left) == money(right)


def money_json(value):
    return float(money(value))


def price_json(value):
    return float(price(value))


def decimal_text(value):
    """Lossless JSON representation used by backups, not API responses."""
    return format(decimal_value(value), "f")
