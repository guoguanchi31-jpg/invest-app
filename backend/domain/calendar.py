"""The calendar for new financial facts, independent of host/device timezone."""

import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


DEFAULT_BUSINESS_TIMEZONE = "Asia/Shanghai"


def business_timezone():
    name = os.environ.get("BUSINESS_TIMEZONE", DEFAULT_BUSINESS_TIMEZONE).strip()
    return ZoneInfo(name or DEFAULT_BUSINESS_TIMEZONE)


def business_now(now=None):
    instant = now if now is not None else datetime.now(timezone.utc)
    if instant.tzinfo is None:
        raise ValueError("业务时钟必须传入带时区的时间")
    return instant.astimezone(business_timezone())


def business_today(now=None):
    return business_now(now).date()


def business_month(now=None):
    return business_today(now).isoformat()[:7]
