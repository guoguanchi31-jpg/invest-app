"""Canonical business-date parsing without database or HTTP dependencies."""
import re
from datetime import date


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LEGACY_COMPACT_DATE = re.compile(r"^\d{8}$")


def canonical_business_month(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise ValueError("月份必须是有效的 YYYY-MM 格式")
    canonical_business_date(f"{value}-01")
    return value


def canonical_business_date(value, *, allow_legacy_compact=False):
    if not isinstance(value, str):
        raise ValueError("日期必须是有效的 YYYY-MM-DD 格式")
    normalized = value.strip()
    if allow_legacy_compact and LEGACY_COMPACT_DATE.fullmatch(normalized):
        normalized = f"{normalized[:4]}-{normalized[4:6]}-{normalized[6:]}"
    if not ISO_DATE.fullmatch(normalized):
        raise ValueError("日期必须是有效的 YYYY-MM-DD 格式")
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("日期必须是有效的 YYYY-MM-DD 格式") from exc
    if parsed.isoformat() != normalized:
        raise ValueError("日期必须是有效的 YYYY-MM-DD 格式")
    return normalized


def parsed_business_date(value, *, allow_legacy_compact=False):
    return date.fromisoformat(canonical_business_date(
        value,
        allow_legacy_compact=allow_legacy_compact,
    ))


def stored_business_date(value, *, nullable):
    if value is None or (nullable and isinstance(value, str) and not value.strip()):
        if nullable:
            return None
        raise ValueError("日期不能为空")
    return canonical_business_date(value, allow_legacy_compact=True)


def date_on_or_after(value, boundary):
    return parsed_business_date(
        value, allow_legacy_compact=True,
    ) >= parsed_business_date(
        boundary, allow_legacy_compact=True,
    )
