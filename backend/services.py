import csv
import json
import re
from datetime import date, datetime, timedelta
from io import StringIO

import requests

from database import get_connection, rows_to_dicts


def current_month():
    return date.today().strftime("%Y-%m")


def month_label(month_value):
    if not month_value or len(month_value) < 7:
        return month_value or ""
    return f"{int(month_value[5:7])}月"


def add_months(month_value, offset):
    year = int(month_value[:4])
    month = int(month_value[5:7]) + offset
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year}-{month:02d}"


def month_range(anchor_month, range_key):
    anchor_month = anchor_month or current_month()
    range_key = range_key or "month"
    if range_key == "month":
        return [anchor_month]
    if range_key == "quarter":
        year = int(anchor_month[:4])
        month = int(anchor_month[5:7])
        start = ((month - 1) // 3) * 3 + 1
        return [f"{year}-{item:02d}" for item in range(start, start + 3)]
    if range_key == "year":
        year = int(anchor_month[:4])
        return [f"{year}-{item:02d}" for item in range(1, 13)]
    if range_key == "6m":
        return [add_months(anchor_month, offset) for offset in range(-5, 1)]
    return [add_months(anchor_month, offset) for offset in range(-11, 1)]


def get_snapshot_trend(metric, month=None, range_key="12m", limit=12):
    conn = get_connection()
    month = month or current_month()
    range_key = range_key or "12m"
    if range_key == "month":
        rows = conn.execute(
            f"""
            SELECT snapshot_date AS date, {metric} AS value
            FROM snapshots
            WHERE {metric} > 0
              AND substr(snapshot_date, 1, 7) = ?
            ORDER BY snapshot_date
            """,
            (month,),
        ).fetchall()
        conn.close()
        return [{"date": row["date"], "value": row["value"]} for row in rows]

    months = month_range(month, range_key)
    placeholders = ",".join("?" for _ in months)
    rows = conn.execute(
        f"""
        SELECT substr(snapshot_date, 1, 7) AS date, MAX({metric}) AS value
        FROM snapshots
        WHERE {metric} > 0
          AND substr(snapshot_date, 1, 7) IN ({placeholders})
        GROUP BY substr(snapshot_date, 1, 7)
        ORDER BY date
        """,
        tuple(months),
    ).fetchall()
    conn.close()
    return [{"date": row["date"], "value": row["value"]} for row in rows[-limit:]]


def filter_trend_by_data_start(trend, data_start):
    if not data_start:
        return trend
    start_month = data_start[:7]
    return [
        item
        for item in trend
        if item["date"] >= (data_start if len(item["date"]) == 10 else start_month)
    ]


def merge_realtime_trend_point(trend, month, range_key, value):
    point_date = date.today().isoformat() if month == current_month() else month
    point = {"date": point_date if range_key == "month" else month, "value": round(value, 2)}
    filtered = [item for item in trend if item["date"] != point["date"]]
    if range_key != "month":
        filtered = [item for item in filtered if item["date"][:7] != month]
    filtered.append(point)
    return sorted(filtered, key=lambda item: item["date"])


def month_days(month_value):
    year = int(month_value[:4])
    month = int(month_value[5:7])
    next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (next_month - date(year, month, 1)).days


def calc_holding(row):
    item = dict(row)
    cost = (item.get("buy_price") or 0) * (item.get("quantity") or 0)
    market_value = (item.get("current_price") or 0) * (item.get("quantity") or 0)
    profit = market_value - cost
    profit_rate = profit / cost * 100 if cost else 0
    item["market_value"] = round(market_value, 2)
    item["profit"] = round(profit, 2)
    item["profit_rate"] = round(profit_rate, 2)
    return item


def get_investment_values_by_account(conn):
    rows = conn.execute(
        """
        SELECT account_id, COALESCE(SUM(COALESCE(current_price, 0) * COALESCE(quantity, 0)), 0) AS value
        FROM holdings
        WHERE account_id IS NOT NULL
        GROUP BY account_id
        """
    ).fetchall()
    return {row["account_id"]: row["value"] or 0 for row in rows}


def apply_investment_account_values(accounts, investment_values):
    adjusted = []
    for account in accounts:
        item = dict(account)
        if item.get("type") == "investment" and not item.get("is_liability"):
            holdings_value = investment_values.get(item["id"], 0)
            cash_available = item.get("cash_available") or 0
            item["holdings_value"] = round(holdings_value, 2)
            item["balance"] = round(holdings_value + cash_available, 2)
            item["balance_source"] = "investment_holdings_plus_cash"
        adjusted.append(item)
    return adjusted


def get_effective_accounts(conn):
    accounts = rows_to_dicts(
        conn.execute("SELECT * FROM accounts WHERE is_active = 1 ORDER BY is_liability, owner, balance DESC").fetchall()
    )
    adjusted = apply_investment_account_values(accounts, get_investment_values_by_account(conn))
    return sorted(adjusted, key=lambda item: (item.get("is_liability", 0), item.get("owner") or "", -float(item.get("balance") or 0)))


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


def quote_result(price, source, symbol, trade_time=None):
    return {
        "price": round(float(price), 4),
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
    url = f"https://hq.sinajs.cn/list={sina_code}"
    headers = {"Referer": "https://finance.sina.com.cn"}
    resp = requests.get(url, headers=headers, timeout=QUOTE_TIMEOUT)
    resp.encoding = "gbk"
    price = parse_sina_price(resp.text, sina_code)
    return quote_result(price, "sina", sina_code) if price else None


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
    url = f"https://qt.gtimg.cn/q={symbol}"
    resp = requests.get(url, timeout=QUOTE_TIMEOUT)
    resp.encoding = "gbk"
    try:
        payload = resp.text.split('"')[1]
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
    url = f"https://stooq.com/q/l/?s={symbol}&f=sd2t2c&h&e=csv"
    resp = requests.get(url, timeout=QUOTE_TIMEOUT)
    rows = list(csv.DictReader(StringIO(resp.text)))
    if not rows:
        return None
    row = rows[0]
    close = row.get("Close")
    if not close or close == "N/D":
        return None
    current = float(close)
    return quote_result(current, "stooq", symbol, row.get("Date"))


def fetch_fund_quote(code):
    fund_code = (code or "").strip()
    if not re.fullmatch(r"\d{6}", fund_code):
        return None
    url = f"https://fundgz.1234567.com.cn/js/{fund_code}.js?rt={int(datetime.now().timestamp() * 1000)}"
    headers = {"Referer": "https://fund.eastmoney.com/"}
    resp = requests.get(url, headers=headers, timeout=QUOTE_TIMEOUT)
    match = re.search(r"jsonpgz\((.*)\);?", resp.text)
    if not match:
        return None
    data = json.loads(match.group(1))
    price = data.get("gsz") or data.get("dwjz")
    if not price:
        return None
    return quote_result(float(price), "eastmoney_fund", fund_code, data.get("gztime") or data.get("jzrq"))


def fetch_price(code, market=None, asset_type="stock"):
    asset_type = asset_type or "stock"
    normalized_market = normalize_market(market)
    providers = []
    if asset_type == "fund":
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


def get_holdings():
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT h.*, a.name AS account_name
        FROM holdings h
        LEFT JOIN accounts a ON a.id = h.account_id
        ORDER BY h.id
        """
    ).fetchall()
    conn.close()
    return [calc_holding(row) for row in rows]


def refresh_holding_prices():
    conn = get_connection()
    rows = conn.execute("SELECT id, name, code, market, asset_type, current_price FROM holdings").fetchall()
    updated = 0
    failed = 0
    skipped = 0
    details = []
    now = datetime.now().isoformat(timespec="seconds")
    for row in rows:
        if row["asset_type"] not in {None, "stock", "fund"}:
            skipped += 1
            details.append({
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "status": "skipped",
                "message": "暂未接入该资产类型行情，保留手动价格",
            })
            continue
        try:
            quote = fetch_price(row["code"], row["market"], row["asset_type"])
            if quote:
                conn.execute(
                    "UPDATE holdings SET current_price = ?, updated_at = ? WHERE id = ?",
                    (quote["price"], now, row["id"]),
                )
                conn.execute(
                    "INSERT INTO prices (code, price, price_date, source) VALUES (?, ?, ?, ?)",
                    (row["code"], quote["price"], date.today().isoformat(), quote["source"]),
                )
                updated += 1
                details.append({
                    "id": row["id"],
                    "name": row["name"],
                    "code": row["code"],
                    "status": "updated",
                    "old_price": row["current_price"],
                    "price": quote["price"],
                    "source": quote["source"],
                    "symbol": quote["symbol"],
                    "trade_time": quote.get("trade_time"),
                    "updated_at": now,
                })
            else:
                failed += 1
                details.append({
                    "id": row["id"],
                    "name": row["name"],
                    "code": row["code"],
                    "status": "failed",
                    "message": "未获取到有效行情",
                })
        except Exception as exc:
            failed += 1
            details.append({
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "status": "failed",
                "message": str(exc),
            })
            print(f"获取 {row['code']} 失败: {exc}")
    conn.commit()
    conn.close()
    snapshot = refresh_warehouse_snapshot()
    summary = get_investment_summary()
    sources = sorted({
        item["source"]
        for item in details
        if item.get("status") == "updated" and item.get("source")
    })
    return {
        "updated": updated,
        "failed": failed,
        "skipped": skipped,
        "total": len(rows),
        "source": "multi",
        "sources": sources,
        "updated_at": now,
        "details": details,
        "snapshot": snapshot,
        "summary": summary,
    }


def get_recent_transactions(limit=5, month=None):
    conn = get_connection()
    month_filter = "AND substr(t.occurred_at, 1, 7) = ?" if month else ""
    params = (month, limit) if month else (limit,)
    rows = conn.execute(
        f"""
        SELECT
            t.id, t.account_id, t.category_id, t.amount, t.direction, t.occurred_at, t.merchant, t.note,
            a.name AS account_name,
            a.owner AS account_owner,
            c.name AS category_name, c.icon, c.color
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE COALESCE(t.source, 'manual') != 'transfer'
          {month_filter}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


def get_dashboard_summary(month=None, trend_range="12m"):
    month = month or current_month()
    conn = get_connection()
    monthly = conn.execute(
        """
        SELECT
            SUM(CASE WHEN direction = 'income' THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN direction = 'expense' THEN amount ELSE 0 END) AS expense
        FROM transactions
        WHERE substr(occurred_at, 1, 7) = ?
          AND COALESCE(source, 'manual') != 'transfer'
        """,
        (month,),
    ).fetchone()
    budget_total = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM budgets WHERE month = ?",
        (month,),
    ).fetchone()["total"]
    accounts = get_effective_accounts(conn)
    data_start = conn.execute(
        """
        SELECT MIN(data_date) AS data_start
        FROM (
            SELECT substr(created_at, 1, 10) AS data_date
            FROM accounts
            WHERE is_active = 1 AND created_at IS NOT NULL AND created_at != ''
            UNION ALL
            SELECT substr(updated_at, 1, 10) AS data_date
            FROM holdings
            WHERE updated_at IS NOT NULL AND updated_at != ''
        )
        WHERE data_date IS NOT NULL AND data_date != ''
        """
    ).fetchone()["data_start"]
    conn.close()

    asset_total = sum(item["balance"] for item in accounts if not item["is_liability"])
    liability_total = sum(item["balance"] for item in accounts if item["is_liability"])
    net_worth = asset_total - liability_total
    income = monthly["income"] or 0
    expense = monthly["expense"] or 0
    balance = income - expense
    savings_rate = balance / income * 100 if income else 0
    budget_left = budget_total - expense

    allocation = []
    for row in sorted((item for item in accounts if not item["is_liability"]), key=lambda item: item["balance"], reverse=True):
        owner = row.get("owner") or row.get("institution") or "未设置"
        account_type = row.get("type") or "account"
        percent = row["balance"] / asset_total * 100 if asset_total else 0
        allocation.append({
            "id": row["id"],
            "name": f"{owner} · {row['name']}",
            "account_name": row["name"],
            "owner": owner,
            "type": account_type,
            "value": round(row["balance"], 2),
            "percent": round(percent, 1),
        })

    trend = filter_trend_by_data_start(get_snapshot_trend("net_worth", month, trend_range), data_start)
    trend = merge_realtime_trend_point(trend, month, trend_range, net_worth) if accounts else []

    return {
        "net_worth": round(net_worth, 2),
        "asset_total": round(asset_total, 2),
        "liability_total": round(liability_total, 2),
        "monthly_income": round(income, 2),
        "monthly_expense": round(expense, 2),
        "monthly_balance": round(balance, 2),
        "savings_rate": round(savings_rate, 1),
        "asset_allocation": allocation,
        "trend": trend,
        "trend_scope": trend_range,
        "recent_transactions": get_recent_transactions(month=month),
        "budget": {
            "total": round(budget_total, 2),
            "used": round(expense, 2),
            "left": round(budget_left, 2),
            "used_percent": round(expense / budget_total * 100, 1) if budget_total else 0,
        },
    }


def get_accounts_overview():
    conn = get_connection()
    accounts = get_effective_accounts(conn)
    conn.close()
    asset_total = sum(item["balance"] for item in accounts if not item["is_liability"])
    liability_total = sum(item["balance"] for item in accounts if item["is_liability"])
    net_worth = asset_total - liability_total
    return {
        "asset_total": round(asset_total, 2),
        "liability_total": round(liability_total, 2),
        "net_worth": round(net_worth, 2),
        "accounts": accounts,
        "distribution": [
            {
                "name": item["name"],
                "value": item["balance"],
                "percent": round(item["balance"] / asset_total * 100, 1) if asset_total and not item["is_liability"] else 0,
            }
            for item in accounts
            if not item["is_liability"]
        ],
    }


def get_expense_analysis(month=None, expense_range="month", cashflow_range="month"):
    month = month or current_month()
    expense_months = month_range(month, expense_range)
    cashflow_months = month_range(month, cashflow_range)
    expense_placeholders = ",".join("?" for _ in expense_months)
    cashflow_placeholders = ",".join("?" for _ in cashflow_months)
    conn = get_connection()
    category_rows = conn.execute(
        f"""
        SELECT c.id, c.name, c.icon, c.color, COALESCE(SUM(t.amount), 0) AS amount
        FROM categories c
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'expense'
            AND COALESCE(t.source, 'manual') != 'transfer'
            AND substr(t.occurred_at, 1, 7) IN ({expense_placeholders})
        WHERE c.type = 'expense'
        GROUP BY c.id, c.name, c.icon, c.color
        ORDER BY amount DESC
        """,
        tuple(expense_months),
    ).fetchall()
    cashflow_rows = conn.execute(
        f"""
        SELECT
            CASE WHEN ? = 'month' THEN substr(occurred_at, 1, 10) ELSE substr(occurred_at, 1, 7) END AS month,
            SUM(CASE WHEN direction = 'income' THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN direction = 'expense' THEN amount ELSE 0 END) AS expense
        FROM transactions
        WHERE substr(occurred_at, 1, 7) IN ({cashflow_placeholders})
          AND COALESCE(source, 'manual') != 'transfer'
        GROUP BY CASE WHEN ? = 'month' THEN substr(occurred_at, 1, 10) ELSE substr(occurred_at, 1, 7) END
        ORDER BY month
        """,
        (cashflow_range, *cashflow_months, cashflow_range),
    ).fetchall()
    conn.close()

    total = sum(row["amount"] for row in category_rows)
    categories = []
    for row in category_rows:
        if not row["amount"]:
            continue
        percent = row["amount"] / total * 100 if total else 0
        categories.append({
            "id": row["id"],
            "name": row["name"],
            "icon": row["icon"],
            "color": row["color"],
            "amount": round(row["amount"], 2),
            "percent": round(percent, 1),
        })
    average_days = sum(month_days(item) for item in expense_months)
    daily_average = total / max(average_days, 1)
    largest = categories[0] if categories else None
    return {
        "month": month,
        "expense_range": expense_range,
        "cashflow_range": cashflow_range,
        "total_expense": round(total, 2),
        "daily_average": round(daily_average, 2),
        "largest_category": largest,
        "categories": categories,
        "cashflow": rows_to_dicts(cashflow_rows),
    }


def get_income_analysis(month=None, income_range="month", trend_range="month"):
    month = month or current_month()
    income_months = month_range(month, income_range)
    trend_months = month_range(month, trend_range)
    income_placeholders = ",".join("?" for _ in income_months)
    trend_placeholders = ",".join("?" for _ in trend_months)
    conn = get_connection()
    category_rows = conn.execute(
        f"""
        SELECT c.id, c.name, c.icon, c.color, COALESCE(SUM(t.amount), 0) AS amount
        FROM categories c
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'income'
            AND COALESCE(t.source, 'manual') != 'transfer'
            AND substr(t.occurred_at, 1, 7) IN ({income_placeholders})
        WHERE c.type = 'income'
        GROUP BY c.id, c.name, c.icon, c.color
        ORDER BY amount DESC
        """,
        tuple(income_months),
    ).fetchall()
    trend_rows = conn.execute(
        f"""
        SELECT
            CASE WHEN ? = 'month' THEN substr(occurred_at, 1, 10) ELSE substr(occurred_at, 1, 7) END AS month,
            SUM(amount) AS income
        FROM transactions
        WHERE direction = 'income'
          AND substr(occurred_at, 1, 7) IN ({trend_placeholders})
          AND COALESCE(source, 'manual') != 'transfer'
        GROUP BY CASE WHEN ? = 'month' THEN substr(occurred_at, 1, 10) ELSE substr(occurred_at, 1, 7) END
        ORDER BY month
        """,
        (trend_range, *trend_months, trend_range),
    ).fetchall()
    conn.close()

    total = sum(row["amount"] for row in category_rows)
    categories = []
    for row in category_rows:
        if not row["amount"]:
            continue
        percent = row["amount"] / total * 100 if total else 0
        categories.append({
            "id": row["id"],
            "name": row["name"],
            "icon": row["icon"],
            "color": row["color"],
            "amount": round(row["amount"], 2),
            "percent": round(percent, 1),
        })
    average_days = sum(month_days(item) for item in income_months)
    daily_average = total / max(average_days, 1)
    largest = categories[0] if categories else None
    return {
        "month": month,
        "income_range": income_range,
        "trend_range": trend_range,
        "total_income": round(total, 2),
        "daily_average": round(daily_average, 2),
        "largest_category": largest,
        "categories": categories,
        "trend": rows_to_dicts(trend_rows),
    }


def get_budget_monthly(month=None):
    month = month or current_month()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT
            b.id, b.amount AS budget, b.alert_threshold,
            c.id AS category_id, c.name, c.icon, c.color,
            COALESCE(SUM(t.amount), 0) AS used
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'expense'
            AND COALESCE(t.source, 'manual') != 'transfer'
            AND substr(t.occurred_at, 1, 7) = b.month
        WHERE b.month = ?
        GROUP BY b.id, b.amount, b.alert_threshold, c.id, c.name, c.icon, c.color, c.sort_order
        ORDER BY c.sort_order
        """,
        (month,),
    ).fetchall()
    conn.close()
    items = []
    total_budget = 0
    total_used = 0
    for row in rows:
        budget = row["budget"] or 0
        used = row["used"] or 0
        total_budget += budget
        total_used += used
        percent = used / budget * 100 if budget else 0
        items.append({
            "id": row["id"],
            "category_id": row["category_id"],
            "name": row["name"],
            "icon": row["icon"],
            "color": row["color"],
            "budget": round(budget, 2),
            "used": round(used, 2),
            "left": round(budget - used, 2),
            "used_percent": round(percent, 1),
            "status": "over" if used > budget else "healthy",
        })
    return {
        "month": month,
        "total_budget": round(total_budget, 2),
        "total_used": round(total_used, 2),
        "left": round(total_budget - total_used, 2),
        "used_percent": round(total_used / total_budget * 100, 1) if total_budget else 0,
        "items": items,
    }


def get_investment_summary(month=None, trend_range="12m"):
    month = month or current_month()
    holdings = get_holdings()
    total_value = sum(item["market_value"] for item in holdings)
    total_cost = sum((item.get("buy_price") or 0) * (item.get("quantity") or 0) for item in holdings)
    total_profit = total_value - total_cost
    conn = get_connection()
    investment_accounts = rows_to_dicts(conn.execute(
        """
        SELECT id, name, owner, COALESCE(cash_available, 0) AS cash_available
        FROM accounts
        WHERE is_active = 1
          AND is_liability = 0
          AND type = 'investment'
        ORDER BY owner, name
        """
    ).fetchall())
    data_start = conn.execute(
        """
        SELECT MIN(substr(updated_at, 1, 10)) AS data_start
        FROM holdings
        WHERE updated_at IS NOT NULL AND updated_at != ''
        """
    ).fetchone()["data_start"]
    conn.close()
    if holdings and not data_start:
        data_start = date.today().isoformat()
    cash_available = sum(item["cash_available"] for item in investment_accounts)
    allocation = {}
    for item in holdings:
        asset_type = item.get("asset_type") or "stock"
        allocation[asset_type] = allocation.get(asset_type, 0) + item["market_value"]
    trend = filter_trend_by_data_start(get_snapshot_trend("investment_value", month, trend_range), data_start)
    trend = merge_realtime_trend_point(trend, month, trend_range, total_value) if total_value else []
    return {
        "total_value": round(total_value, 2),
        "total_profit": round(total_profit, 2),
        "profit_rate": round(total_profit / total_cost * 100, 1) if total_cost else 0,
        "cash_available": round(cash_available, 2),
        "cash_accounts": [
            {
                **item,
                "cash_available": round(item["cash_available"], 2),
            }
            for item in investment_accounts
        ],
        "allocation": [
            {"name": name, "value": round(value, 2), "percent": round(value / total_value * 100, 1) if total_value else 0}
            for name, value in allocation.items()
        ],
        "holdings": holdings,
        "trend": trend,
        "trend_scope": trend_range,
    }


def get_goals_overview(month=None, plan_range="12m"):
    month = month or current_month()
    conn = get_connection()
    rows = rows_to_dicts(conn.execute("SELECT * FROM goals ORDER BY status, due_date").fetchall())
    record_rows = rows_to_dicts(conn.execute(
        """
        SELECT r.amount, r.recorded_at
        FROM goal_records r
        JOIN goals g ON g.id = r.goal_id
        WHERE g.status != 'archived'
          AND substr(r.recorded_at, 1, 7) <= ?
        ORDER BY r.recorded_at
        """,
        (month,),
    ).fetchall())
    conn.close()
    target_total = sum(item["target_amount"] for item in rows if item["status"] != "archived")
    current_total = sum(item["current_amount"] for item in rows if item["status"] != "archived")
    monthly_total = sum(item["monthly_saving"] for item in rows if item["status"] == "active")
    for item in rows:
        item["progress"] = round(item["current_amount"] / item["target_amount"] * 100, 1) if item["target_amount"] else 0
        item["left"] = round(item["target_amount"] - item["current_amount"], 2)
    if plan_range == "year":
        year = int(month[:4])
        end_month = int(month[5:7])
        plan_months = [f"{year}-{item:02d}" for item in range(1, end_month + 1)]
    else:
        plan_months = month_range(month, "6m" if plan_range == "6m" else "12m")
    total_recorded = sum(item["amount"] for item in record_rows)
    baseline_amount = max(current_total - total_recorded, 0)
    actual_points = []
    for period in plan_months:
        actual = baseline_amount + sum(
            item["amount"]
            for item in record_rows
            if item["recorded_at"][:7] <= period
        )
        actual_points.append(actual)
    anchor_actual = actual_points[-1] if actual_points else current_total
    plan = []
    last_index = max(len(plan_months) - 1, 0)
    for index, period in enumerate(plan_months):
        expected = max(anchor_actual - monthly_total * (last_index - index), 0)
        plan.append({
            "period": month_label(period),
            "month": period,
            "actual": round(actual_points[index] / 10000, 1) if actual_points else 0,
            "plan": round(expected / 10000, 1),
        })
    return {
        "month": month,
        "plan_range": plan_range,
        "target_total": round(target_total, 2),
        "current_total": round(current_total, 2),
        "monthly_saving": round(monthly_total, 2),
        "progress": round(current_total / target_total * 100, 1) if target_total else 0,
        "goals": rows,
        "plan": plan,
    }


def refresh_warehouse_snapshot(snapshot_date=None):
    snapshot_date = snapshot_date or date.today().isoformat()
    now = datetime.now().isoformat(timespec="seconds")
    holdings = get_holdings()
    investment_value = sum(item["market_value"] for item in holdings)

    conn = get_connection()
    accounts = get_effective_accounts(conn)
    asset_total = sum(item["balance"] for item in accounts if not item["is_liability"])
    liability_total = sum(item["balance"] for item in accounts if item["is_liability"])
    net_worth = asset_total - liability_total
    cash_value = max(asset_total - investment_value, 0)
    conn.execute(
        """
        INSERT INTO snapshots
        (snapshot_date, asset_total, liability_total, net_worth, investment_value, cash_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_date) DO UPDATE SET
            asset_total = excluded.asset_total,
            liability_total = excluded.liability_total,
            net_worth = excluded.net_worth,
            investment_value = excluded.investment_value,
            cash_value = excluded.cash_value,
            created_at = excluded.created_at
        """,
        (snapshot_date, asset_total, liability_total, net_worth, investment_value, cash_value, now),
    )
    conn.commit()
    conn.close()
    return {
        "snapshot_date": snapshot_date,
        "asset_total": round(asset_total, 2),
        "liability_total": round(liability_total, 2),
        "net_worth": round(net_worth, 2),
        "investment_value": round(investment_value, 2),
        "cash_value": round(cash_value, 2),
        "created_at": now,
    }


def get_warehouse_snapshots(limit=12):
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT snapshot_date, asset_total, liability_total, net_worth, investment_value, cash_value, created_at
        FROM snapshots
        ORDER BY snapshot_date DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return list(reversed(rows_to_dicts(rows)))


def get_warehouse_overview():
    today_snapshot = refresh_warehouse_snapshot()
    snapshots = get_warehouse_snapshots(12)
    start_date = (date.today().replace(day=1) - timedelta(days=365)).isoformat()
    conn = get_connection()
    monthly_rows = conn.execute(
        """
        SELECT
            substr(occurred_at, 1, 7) AS month,
            SUM(CASE WHEN direction = 'income' THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN direction = 'expense' THEN amount ELSE 0 END) AS expense
        FROM transactions
        WHERE occurred_at >= ?
          AND COALESCE(source, 'manual') != 'transfer'
        GROUP BY substr(occurred_at, 1, 7)
        ORDER BY month
        """,
        (start_date,),
    ).fetchall()
    income_category_rows = conn.execute(
        """
        SELECT c.name, c.icon, c.color, COALESCE(SUM(t.amount), 0) AS amount
        FROM categories c
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'income'
            AND t.occurred_at >= ?
            AND COALESCE(t.source, 'manual') != 'transfer'
        WHERE c.type = 'income'
        GROUP BY c.id, c.name, c.icon, c.color
        HAVING amount > 0
        ORDER BY amount DESC
        """,
        (start_date,),
    ).fetchall()
    conn.close()
    return {
        "snapshot": today_snapshot,
        "snapshots": snapshots,
        "monthly_cashflow": rows_to_dicts(monthly_rows),
        "income_categories": rows_to_dicts(income_category_rows),
    }
