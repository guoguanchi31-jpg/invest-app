import csv
import json
import re
from datetime import datetime
from io import StringIO

import requests


QUOTE_TIMEOUT = 5


def normalize_market(market=None):
    raw_market = (market or "").strip().lower()
    aliases = {
        "sha": "sh",
        "sse": "sh",
        "xshg": "sh",
        "沪": "sh",
        "上海": "sh",
        "sza": "sz",
        "szse": "sz",
        "xshe": "sz",
        "深": "sz",
        "深圳": "sz",
        "bse": "bj",
        "北": "bj",
        "北京": "bj",
        "hkg": "hk",
        "港股": "hk",
        "香港": "hk",
        "nasdaq": "us",
        "nyse": "us",
        "amex": "us",
        "美股": "us",
        "美国": "us",
    }
    return aliases.get(raw_market, raw_market)


def quote_result(value, source, symbol, trade_time=None):
    return {
        "price": round(float(value), 4),
        "source": source,
        "symbol": symbol,
        "trade_time": trade_time,
    }


def to_sina_code(code, market=None):
    raw_code = (code or "").strip().lower()
    raw_market = normalize_market(market)
    if raw_code.startswith(("sh", "sz", "bj", "hk", "gb_")):
        return raw_code
    if raw_market == "sh":
        return f"sh{raw_code.zfill(6)}"
    if raw_market == "sz":
        return f"sz{raw_code.zfill(6)}"
    if raw_market == "bj":
        return f"bj{raw_code.zfill(6)}"
    if raw_market == "hk":
        return f"hk{raw_code.zfill(5)}"
    if raw_market == "us":
        return f"gb_{raw_code}"
    code6 = raw_code.zfill(6)
    if code6.startswith(("6", "9")):
        return f"sh{code6}"
    if code6.startswith(("4", "8")):
        return f"bj{code6}"
    return f"sz{code6}"


def parse_sina_price(text, sina_code):
    try:
        payload = text.split('"')[1]
    except IndexError:
        return None
    parts = payload.split(",")
    if not parts or not parts[0]:
        return None
    if sina_code.startswith("gb_"):
        if len(parts) < 2:
            return None
        current = float(parts[1] or 0)
    elif sina_code.startswith("hk"):
        if len(parts) < 7:
            return None
        current = float(parts[6] or 0)
    else:
        if len(parts) < 4:
            return None
        current = float(parts[3] or 0)
    return current if current > 0 else None


def fetch_sina_quote(code, market=None):
    sina_code = to_sina_code(code, market)
    response = requests.get(
        f"https://hq.sinajs.cn/list={sina_code}",
        headers={"Referer": "https://finance.sina.com.cn"},
        timeout=QUOTE_TIMEOUT,
    )
    response.raise_for_status()
    response.encoding = "gbk"
    value = parse_sina_price(response.text, sina_code)
    return quote_result(value, "sina", sina_code) if value else None


def to_tencent_code(code, market=None):
    raw_code = (code or "").strip().lower()
    raw_market = normalize_market(market)
    if raw_code.startswith(("sh", "sz", "bj", "hk", "us")):
        return raw_code
    if raw_market == "hk":
        return f"hk{raw_code.zfill(5)}"
    if raw_market == "us":
        return f"us{raw_code.upper()}"
    if raw_market in {"sh", "sz", "bj"}:
        return f"{raw_market}{raw_code.zfill(6)}"
    code6 = raw_code.zfill(6)
    if code6.startswith(("6", "9")):
        return f"sh{code6}"
    if code6.startswith(("4", "8")):
        return f"bj{code6}"
    return f"sz{code6}"


def fetch_tencent_quote(code, market=None):
    symbol = to_tencent_code(code, market)
    response = requests.get(f"https://qt.gtimg.cn/q={symbol}", timeout=QUOTE_TIMEOUT)
    response.raise_for_status()
    response.encoding = "gbk"
    try:
        payload = response.text.split('"')[1]
    except IndexError:
        return None
    parts = payload.split("~")
    if len(parts) < 4 or not parts[1]:
        return None
    current = float(parts[3] or 0)
    return quote_result(current, "tencent", symbol) if current > 0 else None


def fetch_stooq_quote(code, market=None):
    raw_code = (code or "").strip().lower()
    symbol = raw_code if "." in raw_code else f"{raw_code}.us"
    response = requests.get(
        f"https://stooq.com/q/l/?s={symbol}&f=sd2t2c&h&e=csv",
        timeout=QUOTE_TIMEOUT,
    )
    response.raise_for_status()
    rows = list(csv.DictReader(StringIO(response.text)))
    if not rows:
        return None
    row = rows[0]
    close = row.get("Close")
    if not close or close == "N/D":
        return None
    return quote_result(float(close), "stooq", symbol, row.get("Date"))


def fetch_fund_quote(code):
    fund_code = (code or "").strip()
    if not re.fullmatch(r"\d{6}", fund_code):
        return None
    response = requests.get(
        f"https://fundgz.1234567.com.cn/js/{fund_code}.js"
        f"?rt={int(datetime.now().timestamp() * 1000)}",
        headers={"Referer": "https://fund.eastmoney.com/"},
        timeout=QUOTE_TIMEOUT,
    )
    response.raise_for_status()
    match = re.search(r"jsonpgz\((.*)\);?", response.text)
    if not match:
        return None
    data = json.loads(match.group(1))
    value = data.get("gsz") or data.get("dwjz")
    if not value:
        return None
    return quote_result(
        float(value),
        "eastmoney_fund",
        fund_code,
        data.get("gztime") or data.get("jzrq"),
    )


def fetch_price(code, market=None, asset_type="stock"):
    normalized_market = normalize_market(market)
    if (asset_type or "stock") == "fund":
        providers = [lambda: fetch_fund_quote(code)]
    elif normalized_market == "us":
        providers = [
            lambda: fetch_stooq_quote(code, market),
            lambda: fetch_sina_quote(code, market),
            lambda: fetch_tencent_quote(code, market),
        ]
    else:
        providers = [
            lambda: fetch_sina_quote(code, market),
            lambda: fetch_tencent_quote(code, market),
        ]
    last_error = None
    for provider in providers:
        try:
            result = provider()
            if result:
                return result
        except Exception as exc:
            last_error = exc
    if last_error:
        raise last_error
    return None
