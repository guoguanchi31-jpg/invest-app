"""Pin only the business clock; authentication and timeout clocks remain real."""
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import patch


@contextmanager
def freeze_business_time(instant="2026-09-28T12:00:00+08:00"):
    now = datetime.fromisoformat(instant)
    if now.tzinfo is None:
        raise ValueError("测试业务时钟必须带时区")
    with patch("domain.calendar.datetime", wraps=datetime) as clock:
        clock.now.return_value = now
        yield now
