import os
from calendar import monthrange
from datetime import date, timedelta

from domain.dates import canonical_business_month
from infrastructure.database import rows_to_dicts
from infrastructure.read_models import consistent_query
from domain.calendar import business_month, business_today
from domain.valuation import market_values_by_account, value_holding
from domain.money import ZERO, money, rate
from tenancy import (
    get_auth_context,
    scoped_account_clause,
    scoped_member_data_clause,
    scoped_resource_clause,
)


BASE_CURRENCY = os.environ.get("BASE_CURRENCY", "CNY").strip().upper() or "CNY"
def current_month():
    return business_month()


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


def months_between(start_month, end_month):
    return (
        (int(end_month[:4]) - int(start_month[:4])) * 12
        + int(end_month[5:7]) - int(start_month[5:7])
    )


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


@consistent_query
def get_snapshot_trend(metric, month=None, range_key="12m", limit=12, context=None, *, conn=None):
    context = context or get_auth_context(conn)
    scope_clause, scope_params = scoped_resource_clause("s", context)
    month = month or current_month()
    range_key = range_key or "12m"
    if range_key == "month":
        rows = conn.execute(
            f"""
            SELECT s.snapshot_date AS date, s.{metric} AS value
            FROM snapshots s
            WHERE {scope_clause}
              AND substr(s.snapshot_date, 1, 7) = ?
            ORDER BY s.snapshot_date
            """,
            (*scope_params, month),
        ).fetchall()
        return [{"date": row["date"], "value": row["value"]} for row in rows]

    months = month_range(month, range_key)
    placeholders = ",".join("?" for _ in months)
    inner_scope_clause, inner_scope_params = scoped_resource_clause("inner_s", context)
    rows = conn.execute(
        f"""
        SELECT substr(s.snapshot_date, 1, 7) AS date, s.{metric} AS value
        FROM snapshots s
        JOIN (
            SELECT
                substr(inner_s.snapshot_date, 1, 7) AS snapshot_month,
                MAX(inner_s.snapshot_date) AS snapshot_date
            FROM snapshots inner_s
            WHERE {inner_scope_clause}
              AND substr(inner_s.snapshot_date, 1, 7) IN ({placeholders})
            GROUP BY 1
        ) latest ON latest.snapshot_date = s.snapshot_date
        WHERE {scope_clause}
        ORDER BY 1
        """,
        (*inner_scope_params, *months, *scope_params),
    ).fetchall()
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
    if month != current_month():
        return trend
    point_date = business_today().isoformat()
    point = {"date": point_date if range_key == "month" else month, "value": round(value, 2)}
    filtered = [item for item in trend if item["date"] != point["date"]]
    if range_key != "month":
        filtered = [item for item in filtered if item["date"][:7] != month]
    filtered.append(point)
    return sorted(filtered, key=lambda item: item["date"])


def month_days(month_value):
    year = int(month_value[:4])
    month = int(month_value[5:7])
    return monthrange(year, month)[1]


def calc_holding(row):
    item = value_holding(row)
    item["base_currency"] = BASE_CURRENCY
    return item


def get_investment_values_by_account(conn, context=None, account_ids=None):
    context = context or get_auth_context(conn)
    clauses = ["h.family_id = ?", "h.account_id IS NOT NULL"]
    params = [context.family_id]
    if context.scope == "personal":
        clauses.append("h.member_id = ?")
        params.append(context.member_id)
    if account_ids is not None:
        normalized_ids = sorted({int(value) for value in account_ids if value is not None})
        if not normalized_ids:
            return {}
        placeholders = ",".join("?" for _ in normalized_ids)
        clauses.append(f"h.account_id IN ({placeholders})")
        params.extend(normalized_ids)
    rows = rows_to_dicts(conn.execute(
        f"""
        SELECT h.account_id, h.buy_price, h.quantity, h.current_price,
               h.exchange_rate_to_base
        FROM holdings h
        WHERE {" AND ".join(clauses)}
        ORDER BY h.account_id, h.id
        """,
        tuple(params),
    ).fetchall())
    return market_values_by_account(rows)


def apply_investment_account_values(accounts, investment_values):
    adjusted = []
    for account in accounts:
        item = dict(account)
        exchange_rate = rate(item.get("exchange_rate_to_base") or 1)
        original_balance = money(item.get("balance") or 0)
        item["original_balance"] = original_balance
        item["base_currency"] = BASE_CURRENCY
        if item.get("type") == "investment" and not item.get("is_liability"):
            holdings_value = money(investment_values.get(item["id"], 0))
            original_cash_available = money(item.get("cash_available") or 0)
            cash_available = money(original_cash_available * exchange_rate)
            item["holdings_value"] = holdings_value
            item["cash_available_original"] = original_cash_available
            item["cash_available"] = cash_available
            item["balance"] = money(holdings_value + cash_available)
            item["balance_source"] = "investment_holdings_plus_cash"
        else:
            item["balance"] = money(original_balance * exchange_rate)
        adjusted.append(item)
    return adjusted


def get_effective_accounts(conn, context=None):
    context = context or get_auth_context(conn)
    scope_clause, scope_params = scoped_account_clause("accounts", context)
    accounts = rows_to_dicts(
        conn.execute(
            f"""
            SELECT *
            FROM accounts
            WHERE is_active = 1 AND {scope_clause}
            ORDER BY is_liability, owner, balance DESC
            """,
            tuple(scope_params),
        ).fetchall()
    )
    adjusted = apply_investment_account_values(
        accounts,
        get_investment_values_by_account(
            conn,
            context,
            account_ids=[item["id"] for item in accounts],
        ),
    )
    for item in adjusted:
        item["can_edit"] = context.role in {"owner", "admin"} or item.get("member_id") == context.member_id
    return sorted(adjusted, key=lambda item: (item.get("is_liability", 0), item.get("owner") or "", -float(item.get("balance") or 0)))


@consistent_query
def get_holdings(conn=None, context=None):
    context = context or get_auth_context(conn)
    scope_clause, scope_params = scoped_member_data_clause("h", context)
    rows = conn.execute(
        f"""
        SELECT h.*, a.name AS account_name, a.owner AS account_owner,
               CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS included_in_totals,
               CASE WHEN ? IN ('owner', 'admin') OR a.member_id = ? THEN 1 ELSE 0 END AS can_edit
        FROM holdings h
        LEFT JOIN accounts a ON a.id = h.account_id
        WHERE {scope_clause}
          AND (
                h.account_id IS NULL
                OR (a.is_active = 1 AND a.type = 'investment' AND a.is_liability = 0)
          )
        ORDER BY h.id
        """,
        (context.role, context.member_id, *scope_params),
    ).fetchall()
    return [calc_holding(row) for row in rows]


@consistent_query
def get_recent_transactions(limit=5, month=None, context=None, *, conn=None):
    context = context or get_auth_context(conn)
    scope_clause, scope_params = scoped_account_clause("a", context)
    month_filter = "AND substr(t.occurred_at, 1, 7) = ?" if month else ""
    params = [*scope_params]
    if month:
        params.append(month)
    params.append(limit)
    rows = conn.execute(
        f"""
        SELECT
            t.id, t.account_id, t.category_id, t.amount, t.currency,
            t.exchange_rate_to_base, t.base_amount,
            t.direction, t.occurred_at, t.merchant, t.note,
            a.name AS account_name,
            a.owner AS account_owner,
            c.name AS category_name, c.icon, c.color
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE {scope_clause}
          AND COALESCE(t.source, 'manual') = 'manual'
          {month_filter}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()
    return rows_to_dicts(rows)


@consistent_query
def get_dashboard_summary(month=None, trend_range="12m", context=None, *, conn=None):
    month = month or current_month()
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    monthly = conn.execute(
        f"""
        SELECT
            SUM(CASE WHEN t.direction = 'income' THEN t.base_amount ELSE 0 END) AS income,
            SUM(CASE WHEN t.direction = 'expense' THEN t.base_amount ELSE 0 END) AS expense
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE {account_scope}
          AND substr(t.occurred_at, 1, 7) = ?
          AND COALESCE(t.source, 'manual') = 'manual'
          AND t.voided_at IS NULL
        """,
        (*account_scope_params, month),
    ).fetchone()
    if context.scope == "personal":
        budget_total = conn.execute(
            """
            SELECT COALESCE(SUM(bca.amount), 0) AS total
            FROM budget_plans bp
            LEFT JOIN budget_category_allocations bca
              ON bca.budget_plan_id = bp.id AND bca.member_id = ?
            WHERE bp.family_id = ? AND bp.month = ?
            GROUP BY bp.id
            """,
            (context.member_id, context.family_id, month),
        ).fetchone()
    else:
        budget_total = conn.execute(
            """
            SELECT total_amount AS total
            FROM budget_plans
            WHERE family_id = ? AND month = ?
            """,
            (context.family_id, month),
        ).fetchone()
    budget_total = budget_total["total"] if budget_total else 0
    accounts = get_effective_accounts(conn, context)
    holding_scope, holding_scope_params = scoped_member_data_clause("h", context)
    data_start = conn.execute(
        f"""
        SELECT MIN(data_date) AS data_start
        FROM (
            SELECT substr(a.created_at, 1, 10) AS data_date
            FROM accounts a
            WHERE {account_scope}
              AND a.is_active = 1 AND a.created_at IS NOT NULL AND a.created_at != ''
            UNION ALL
            SELECT substr(h.updated_at, 1, 10) AS data_date
            FROM holdings h
            WHERE {holding_scope}
              AND h.updated_at IS NOT NULL AND h.updated_at != ''
        )
        WHERE data_date IS NOT NULL AND data_date != ''
        """,
        (*account_scope_params, *holding_scope_params),
    ).fetchone()["data_start"]

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

    trend = filter_trend_by_data_start(
        get_snapshot_trend("net_worth", month, trend_range, context=context, conn=conn),
        data_start,
    )
    trend = merge_realtime_trend_point(trend, month, trend_range, net_worth) if accounts else []

    return {
        "base_currency": BASE_CURRENCY,
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
        "recent_transactions": get_recent_transactions(
            limit=7,
            month=month,
            context=context,
            conn=conn,
        ),
        "budget": {
            "total": round(budget_total, 2),
            "used": round(expense, 2),
            "left": round(budget_left, 2),
            "used_percent": round(expense / budget_total * 100, 1) if budget_total else 0,
        },
    }


@consistent_query
def get_accounts_overview(context=None, *, conn=None):
    context = context or get_auth_context(conn)
    accounts = get_effective_accounts(conn, context)
    asset_total = sum(item["balance"] for item in accounts if not item["is_liability"])
    liability_total = sum(item["balance"] for item in accounts if item["is_liability"])
    net_worth = asset_total - liability_total
    return {
        "base_currency": BASE_CURRENCY,
        "asset_total": round(asset_total, 2),
        "liability_total": round(liability_total, 2),
        "net_worth": round(net_worth, 2),
        "accounts": accounts,
        "distribution": [
            {
                "name": f"{item['owner']} · {item['name']}" if context.scope == "family" else item["name"],
                "value": item["balance"],
                "percent": round(item["balance"] / asset_total * 100, 1) if asset_total and not item["is_liability"] else 0,
            }
            for item in accounts
            if not item["is_liability"]
        ],
    }


@consistent_query
def get_expense_analysis(month=None, expense_range="month", cashflow_range="month", context=None, *, conn=None):
    month = month or current_month()
    expense_months = month_range(month, expense_range)
    cashflow_months = month_range(month, cashflow_range)
    expense_placeholders = ",".join("?" for _ in expense_months)
    cashflow_placeholders = ",".join("?" for _ in cashflow_months)
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    category_rows = conn.execute(
        f"""
        SELECT
            c.id,
            COALESCE(c.name, '未分类') AS name,
            COALESCE(c.icon, '🧾') AS icon,
            COALESCE(c.color, '#827f77') AS color,
            SUM(t.base_amount) AS amount
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE {account_scope}
          AND t.direction = 'expense'
          AND COALESCE(t.source, 'manual') = 'manual'
          AND substr(t.occurred_at, 1, 7) IN ({expense_placeholders})
        GROUP BY c.id, c.name, c.icon, c.color
        ORDER BY amount DESC
        """,
        (*account_scope_params, *expense_months),
    ).fetchall()
    cashflow_rows = conn.execute(
        f"""
        SELECT
            CASE WHEN ? = 'month' THEN substr(t.occurred_at, 1, 10) ELSE substr(t.occurred_at, 1, 7) END AS month,
            SUM(CASE WHEN t.direction = 'income' THEN t.base_amount ELSE 0 END) AS income,
            SUM(CASE WHEN t.direction = 'expense' THEN t.base_amount ELSE 0 END) AS expense
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE {account_scope}
          AND substr(t.occurred_at, 1, 7) IN ({cashflow_placeholders})
          AND COALESCE(t.source, 'manual') = 'manual'
        GROUP BY 1
        ORDER BY 1
        """,
        (cashflow_range, *account_scope_params, *cashflow_months),
    ).fetchall()

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
        "base_currency": BASE_CURRENCY,
        "total_expense": round(total, 2),
        "daily_average": round(daily_average, 2),
        "largest_category": largest,
        "categories": categories,
        "cashflow": rows_to_dicts(cashflow_rows),
    }


@consistent_query
def get_income_analysis(month=None, income_range="month", trend_range="month", context=None, *, conn=None):
    month = month or current_month()
    income_months = month_range(month, income_range)
    trend_months = month_range(month, trend_range)
    income_placeholders = ",".join("?" for _ in income_months)
    trend_placeholders = ",".join("?" for _ in trend_months)
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    category_rows = conn.execute(
        f"""
        SELECT
            c.id,
            COALESCE(c.name, '未分类') AS name,
            COALESCE(c.icon, '💰') AS icon,
            COALESCE(c.color, '#827f77') AS color,
            SUM(t.base_amount) AS amount
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE {account_scope}
          AND t.direction = 'income'
          AND COALESCE(t.source, 'manual') = 'manual'
          AND substr(t.occurred_at, 1, 7) IN ({income_placeholders})
        GROUP BY c.id, c.name, c.icon, c.color
        ORDER BY amount DESC
        """,
        (*account_scope_params, *income_months),
    ).fetchall()
    trend_rows = conn.execute(
        f"""
        SELECT
            CASE WHEN ? = 'month' THEN substr(t.occurred_at, 1, 10) ELSE substr(t.occurred_at, 1, 7) END AS month,
            SUM(t.base_amount) AS income
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE {account_scope}
          AND t.direction = 'income'
          AND substr(t.occurred_at, 1, 7) IN ({trend_placeholders})
          AND COALESCE(t.source, 'manual') = 'manual'
        GROUP BY 1
        ORDER BY 1
        """,
        (trend_range, *account_scope_params, *trend_months),
    ).fetchall()

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
        "base_currency": BASE_CURRENCY,
        "total_income": round(total, 2),
        "daily_average": round(daily_average, 2),
        "largest_category": largest,
        "categories": categories,
        "trend": rows_to_dicts(trend_rows),
    }


@consistent_query
def get_ledger_monthly_overview(
    month=None,
    account_id=None,
    owner=None,
    context=None,
    *,
    conn=None,
):
    month = canonical_business_month(month if month is not None else current_month())
    year = int(month[:4])
    month_number = int(month[5:7])
    previous_month = add_months(month, -1)
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    clauses = [
        account_scope,
        "t.voided_at IS NULL",
        "COALESCE(t.source, 'manual') = 'manual'",
        "t.direction IN ('income', 'expense')",
    ]
    params = list(account_scope_params)
    if owner:
        clauses.append("a.owner = ?")
        params.append(owner)
    if account_id:
        clauses.append("t.account_id = ?")
        params.append(account_id)
    where_clause = " AND ".join(clauses)

    # Accumulate persisted amounts as Decimal; SQLite SUM uses binary floats.
    rows = conn.execute(
        f"""
        SELECT
            t.direction, t.base_amount,
            substr(t.occurred_at, 1, 10) AS occurred_date,
            c.id AS category_id,
            COALESCE(c.name, '未分类') AS name,
            COALESCE(c.icon, CASE WHEN t.direction = 'income' THEN '💰' ELSE '🧾' END) AS icon,
            COALESCE(c.color, '#827f77') AS color
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE {where_clause}
          AND substr(t.occurred_at, 1, 7) IN (?, ?)
        ORDER BY t.occurred_at, t.id
        """,
        (*params, previous_month, month),
    ).fetchall()

    totals = {
        previous_month: {"income": ZERO, "expense": ZERO},
        month: {"income": ZERO, "expense": ZERO},
    }
    daily_by_direction = {"income": {}, "expense": {}}
    categories_by_direction = {"income": {}, "expense": {}}
    for row in rows:
        row_month = row["occurred_date"][:7]
        direction = row["direction"]
        amount = money(row["base_amount"] or ZERO)
        totals[row_month][direction] += amount
        if row_month == month:
            day = daily_by_direction[direction].setdefault(
                row["occurred_date"], {"amount": ZERO, "count": 0},
            )
            day["amount"] += amount
            day["count"] += 1
            category = categories_by_direction[direction].setdefault(
                row["category_id"],
                {
                    "id": row["category_id"], "category_id": row["category_id"],
                    "name": row["name"], "icon": row["icon"], "color": row["color"],
                    "amount": ZERO, "count": 0,
                },
            )
            category["amount"] += amount
            category["count"] += 1

    directions = {}
    days_in_month = month_days(month)
    for direction in ("expense", "income"):
        total = money(totals[month][direction])
        category_items = []
        for row in sorted(
            categories_by_direction[direction].values(),
            key=lambda item: (-item["amount"], item["name"]),
        ):
            amount = money(row["amount"] or ZERO)
            category_items.append({
                "id": row["category_id"],
                "category_id": row["category_id"],
                "name": row["name"],
                "icon": row["icon"],
                "color": row["color"],
                "amount": amount,
                "percent": round(amount / total * 100, 1) if total else 0,
                "count": row["count"],
            })
        daily = []
        for day in range(1, days_in_month + 1):
            date_value = date(year, month_number, day).isoformat()
            value = daily_by_direction[direction].get(
                date_value,
                {"amount": ZERO, "count": 0},
            )
            daily.append({
                "date": date_value,
                "amount": money(value["amount"]),
                "count": value["count"],
            })
        active_days = [item for item in daily if item["count"]]
        highest_day = (
            min(active_days, key=lambda item: (-item["amount"], item["date"]))
            if active_days else None
        )
        directions[direction] = {
            "total": total,
            "daily_average": money(total / max(days_in_month, 1)),
            "count": sum(item["count"] for item in daily),
            "highest_day": highest_day,
            "daily": daily,
            "categories": category_items,
        }

    income_total = money(totals[month]["income"])
    expense_total = money(totals[month]["expense"])
    previous_income = money(totals[previous_month]["income"])
    previous_expense = money(totals[previous_month]["expense"])
    return {
        "month": month,
        "previous_month": previous_month,
        "base_currency": BASE_CURRENCY,
        "summary": {
            "income": income_total,
            "expense": expense_total,
            "balance": money(income_total - expense_total),
            "previous_balance": money(previous_income - previous_expense),
        },
        "directions": directions,
    }


@consistent_query
def get_budget_monthly(month=None, context=None, *, conn=None):
    month = month or current_month()
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a2", context)
    plan = conn.execute(
        """
        SELECT id, total_amount
        FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, month),
    ).fetchone()
    plan_id = plan["id"] if plan else None
    family_total = plan["total_amount"] if plan else 0
    allocation_rows = conn.execute(
        """
        SELECT bma.id, bma.member_id,
               fm.display_name AS member_name, bma.amount
        FROM budget_member_allocations bma
        JOIN family_members fm
          ON fm.id = bma.member_id AND fm.family_id = bma.family_id
        WHERE bma.budget_plan_id = ?
        ORDER BY fm.role = 'owner' DESC, fm.id
        """,
        (plan_id,),
    ).fetchall() if plan_id else []
    category_allocation_rows = conn.execute(
        """
        SELECT bca.category_id, bca.member_id, fm.display_name AS member_name,
               bca.amount
        FROM budget_category_allocations bca
        JOIN family_members fm
          ON fm.id = bca.member_id AND fm.family_id = bca.family_id
        WHERE bca.budget_plan_id = ?
        ORDER BY bca.category_id, fm.role = 'owner' DESC, fm.id
        """,
        (plan_id,),
    ).fetchall() if plan_id else []
    personal_allocation = next(
        (row["amount"] for row in allocation_rows if row["member_id"] == context.member_id),
        0,
    )
    total_budget = personal_allocation if context.scope == "personal" else family_total
    rows = conn.execute(
        f"""
        SELECT
            b.amount AS budget, b.alert_threshold,
            c.id AS category_id, c.name, c.icon, c.color,
            COALESCE(SUM(t.base_amount), 0) AS used
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'expense'
            AND COALESCE(t.source, 'manual') = 'manual'
            AND t.voided_at IS NULL
            AND substr(t.occurred_at, 1, 7) = b.month
            AND EXISTS (
                SELECT 1
                FROM accounts budget_account
                WHERE budget_account.id = t.account_id
                  AND budget_account.family_id = b.family_id
                  AND (
                      ? = 'family'
                      OR budget_account.member_id = ?
                  )
            )
        WHERE b.family_id = ?
          AND b.month = ?
        GROUP BY b.id, b.amount, b.alert_threshold,
                 c.id, c.name, c.icon, c.color, c.sort_order
        ORDER BY c.sort_order, b.id
        """,
        (context.scope, context.member_id, context.family_id, month),
    ).fetchall()
    total_expense = conn.execute(
        f"""
        SELECT COALESCE(SUM(t.base_amount), 0) AS total
        FROM transactions t
        JOIN accounts a2 ON a2.id = t.account_id
        WHERE {account_scope}
          AND t.direction = 'expense'
          AND COALESCE(t.source, 'manual') = 'manual'
          AND t.voided_at IS NULL
          AND substr(t.occurred_at, 1, 7) = ?
        """,
        (*account_scope_params, month),
    ).fetchone()["total"] or 0
    member_usage_rows = conn.execute(
        """
        SELECT a.member_id, COALESCE(SUM(t.base_amount), 0) AS used
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE a.family_id = ?
          AND t.direction = 'expense'
          AND COALESCE(t.source, 'manual') = 'manual'
          AND t.voided_at IS NULL
          AND substr(t.occurred_at, 1, 7) = ?
        GROUP BY a.member_id
        """,
        (context.family_id, month),
    ).fetchall()
    category_allocations = {}
    for allocation in category_allocation_rows:
        category_allocations.setdefault(allocation["category_id"], []).append({
            "member_id": allocation["member_id"],
            "member_name": allocation["member_name"],
            "amount": round(allocation["amount"] or 0, 2),
        })
    items = []
    budgeted_used = 0
    for row in rows:
        family_budget = row["budget"] or 0
        category_members = category_allocations.get(row["category_id"], [])
        budget = (
            next(
                (
                    allocation["amount"]
                    for allocation in category_members
                    if allocation["member_id"] == context.member_id
                ),
                0,
            )
            if context.scope == "personal"
            else family_budget
        )
        used = row["used"] or 0
        if context.scope == "personal" and budget <= 0 and used <= 0:
            continue
        if budget > 0:
            budgeted_used += used
        percent = used / budget * 100 if budget else 0
        items.append({
            "id": row["category_id"],
            "category_id": row["category_id"],
            "name": row["name"],
            "icon": row["icon"],
            "color": row["color"],
            "budget": round(budget, 2),
            "family_budget": round(family_budget, 2),
            "used": round(used, 2),
            "left": round(budget - used, 2),
            "used_percent": round(percent, 1),
            "status": "over" if used > budget else "healthy",
            "can_edit": context.scope == "family" and context.role in {"owner", "admin"},
            "member_allocations": category_members,
        })
    usage_by_member = {row["member_id"]: row["used"] or 0 for row in member_usage_rows}
    allocations = [
        {
            "id": row["id"],
            "member_id": row["member_id"],
            "member_name": row["member_name"],
            "amount": round(row["amount"] or 0, 2),
            "used": round(usage_by_member.get(row["member_id"], 0), 2),
            "left": round((row["amount"] or 0) - usage_by_member.get(row["member_id"], 0), 2),
            "percent": round((row["amount"] or 0) / family_total * 100, 1) if family_total else 0,
            "categories": [
                {
                    "category_id": category_id,
                    "name": next(
                        (item["name"] for item in items if item["category_id"] == category_id),
                        "",
                    ),
                    "amount": allocation["amount"],
                }
                for category_id, category_rows in category_allocations.items()
                for allocation in category_rows
                if allocation["member_id"] == row["member_id"] and allocation["amount"] > 0
            ],
        }
        for row in allocation_rows
    ]
    return {
        "id": plan_id,
        "month": month,
        "base_currency": BASE_CURRENCY,
        "scope": context.scope,
        "can_manage": context.scope == "family" and context.role in {"owner", "admin"},
        "family_total_budget": round(family_total, 2),
        "personal_allocation": round(personal_allocation, 2),
        "member_count": len(allocation_rows),
        "category_count": len({item["category_id"] for item in items}),
        "total_budget": round(total_budget, 2),
        "total_used": round(total_expense, 2),
        "budgeted_used": round(budgeted_used, 2),
        "unbudgeted_expense": (
            round(max(total_expense - budgeted_used, 0), 2)
            if items else 0
        ),
        "left": round(total_budget - total_expense, 2),
        "used_percent": round(total_expense / total_budget * 100, 1) if total_budget else 0,
        "items": items,
        "allocations": allocations,
    }


@consistent_query
def get_investment_summary(month=None, trend_range="12m", context=None, *, conn=None):
    month = month or current_month()
    context = context or get_auth_context(conn)
    all_holdings = get_holdings(context=context, conn=conn)
    holdings = [item for item in all_holdings if item["included_in_totals"]]
    total_value = money(sum((item["market_value"] for item in holdings), ZERO))
    total_cost = money(sum((item["cost"] for item in holdings), ZERO))
    total_profit = money(total_value - total_cost)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    investment_accounts = rows_to_dicts(conn.execute(
        f"""
        SELECT a.id, a.name, a.owner, a.member_id, a.currency, a.exchange_rate_to_base,
               COALESCE(a.cash_available, 0) AS cash_available
        FROM accounts a
        WHERE {account_scope}
          AND a.is_active = 1
          AND a.is_liability = 0
          AND a.type = 'investment'
        ORDER BY a.owner, a.name
        """,
        tuple(account_scope_params),
    ).fetchall())
    snapshot_scope, snapshot_scope_params = scoped_resource_clause("s", context)
    data_start = conn.execute(
        f"""
        SELECT MIN(s.snapshot_date) AS data_start
        FROM snapshots s
        WHERE {snapshot_scope} AND s.investment_value > 0
        """,
        tuple(snapshot_scope_params),
    ).fetchone()["data_start"]
    if holdings and not data_start:
        data_start = business_today().isoformat()
    for item in investment_accounts:
        original_cash = money(item["cash_available"])
        exchange_rate = rate(item["exchange_rate_to_base"] or 1)
        item["cash_available_original"] = original_cash
        item["cash_available"] = money(original_cash * exchange_rate)
        item["can_edit"] = context.role in {"owner", "admin"} or item["member_id"] == context.member_id
    cash_available = money(sum(
        (item["cash_available"] for item in investment_accounts),
        ZERO,
    ))
    allocation = {}
    for item in holdings:
        asset_type = item.get("asset_type") or "stock"
        allocation[asset_type] = allocation.get(asset_type, ZERO) + item["market_value"]
    trend = filter_trend_by_data_start(
        get_snapshot_trend("investment_value", month, trend_range, context=context, conn=conn),
        data_start,
    )
    if investment_accounts or holdings:
        trend = merge_realtime_trend_point(trend, month, trend_range, total_value)
    return {
        "total_value": total_value,
        "total_profit": total_profit,
        "profit_rate": round(total_profit / total_cost * 100, 1) if total_cost else 0,
        "base_currency": BASE_CURRENCY,
        "cash_available": cash_available,
        "cash_accounts": [
            {
                **item,
                "cash_available": money(item["cash_available"]),
            }
            for item in investment_accounts
        ],
        "allocation": [
            {
                "name": name,
                "value": money(value),
                "percent": round(value / total_value * 100, 1) if total_value else 0,
            }
            for name, value in allocation.items()
        ],
        "holdings": all_holdings,
        "trend": trend,
        "trend_scope": trend_range,
    }


@consistent_query
def get_goals_overview(month=None, plan_range="12m", context=None, *, conn=None):
    month = month or current_month()
    context = context or get_auth_context(conn)
    personal_filter = ""
    goal_params = [context.family_id]
    if context.scope == "personal":
        personal_filter = """
          AND EXISTS (
              SELECT 1 FROM goal_allocations visible_allocation
              WHERE visible_allocation.goal_id = g.id
                AND visible_allocation.member_id = ?
          )
        """
        goal_params.append(context.member_id)
    rows = rows_to_dicts(conn.execute(
        f"""
        SELECT g.*
        FROM goals g
        WHERE g.family_id = ? {personal_filter}
        ORDER BY g.status, g.due_date, g.id
        """,
        tuple(goal_params),
    ).fetchall())
    goal_ids = [row["id"] for row in rows]
    placeholders = ",".join("?" for _ in goal_ids)
    allocation_rows = rows_to_dicts(conn.execute(
        f"""
        SELECT ga.*, fm.display_name AS member_name
        FROM goal_allocations ga
        JOIN family_members fm
          ON fm.id = ga.member_id AND fm.family_id = ga.family_id
        WHERE ga.goal_id IN ({placeholders})
        ORDER BY fm.role = 'owner' DESC, fm.id
        """,
        tuple(goal_ids),
    ).fetchall()) if goal_ids else []
    record_filter = "AND r.member_id = ?" if context.scope == "personal" else ""
    record_params = [*goal_ids]
    if context.scope == "personal":
        record_params.append(context.member_id)
    record_rows = rows_to_dicts(conn.execute(
        f"""
        SELECT r.goal_id, r.member_id, r.amount, r.recorded_at
        FROM goal_records r
        WHERE r.goal_id IN ({placeholders}) {record_filter}
        ORDER BY r.recorded_at
        """,
        tuple(record_params),
    ).fetchall()) if goal_ids else []
    allocations_by_goal = {}
    for allocation in allocation_rows:
        allocations_by_goal.setdefault(allocation["goal_id"], []).append(allocation)
    records_by_goal = {}
    for record in record_rows:
        records_by_goal.setdefault(record["goal_id"], []).append(record)
    for item in rows:
        allocations = allocations_by_goal.get(item["id"], [])
        selected_allocation = next(
            (
                allocation for allocation in allocations
                if allocation["member_id"] == context.member_id
            ),
            None,
        )
        family_target = item["target_amount"]
        family_current = item["current_amount"]
        family_monthly = item["monthly_saving"]
        if context.scope == "personal" and selected_allocation:
            item["target_amount"] = selected_allocation["target_amount"]
            item["current_amount"] = selected_allocation["current_amount"]
            item["monthly_saving"] = selected_allocation["monthly_saving"]
            item["member_id"] = context.member_id
            item["member_name"] = selected_allocation["member_name"]
        else:
            item["member_id"] = None
            item["member_name"] = None
        item["family_target_amount"] = family_target
        item["family_current_amount"] = family_current
        item["family_monthly_saving"] = family_monthly
        item["allocations"] = [
            {
                "id": allocation["id"],
                "member_id": allocation["member_id"],
                "member_name": allocation["member_name"],
                "target_amount": round(allocation["target_amount"], 2),
                "current_amount": round(allocation["current_amount"], 2),
                "monthly_saving": round(allocation["monthly_saving"], 2),
                "progress": round(
                    allocation["current_amount"] / allocation["target_amount"] * 100,
                    1,
                ) if allocation["target_amount"] else 0,
            }
            for allocation in allocations
        ]
        item["can_edit"] = context.scope == "family" and context.role in {"owner", "admin"}
        item["can_contribute"] = (
            selected_allocation is not None
            or (
                context.scope == "family"
                and context.role in {"owner", "admin"}
                and bool(allocations)
            )
        )
        records = records_by_goal.get(item["id"], [])
        if context.scope == "personal":
            all_record_amount = sum(record["amount"] for record in records)
            initial_amount = item["current_amount"] - all_record_amount
        else:
            all_record_amount = sum(record["amount"] for record in records)
            initial_amount = family_current - all_record_amount
        record_months = [record["recorded_at"][:7] for record in records if record.get("recorded_at")]
        created_month = (item.get("created_at") or "")[:7]
        start_candidates = [value for value in [created_month, *record_months] if len(value) == 7]
        item["initial_amount"] = round(initial_amount, 2)
        item["plan_start_month"] = min(start_candidates) if start_candidates else month
        item["current_amount"] = round(
            initial_amount + sum(
                record["amount"]
                for record in records
                if record["recorded_at"][:7] <= month
            ),
            2,
        )
        item["progress"] = round(item["current_amount"] / item["target_amount"] * 100, 1) if item["target_amount"] else 0
        item["left"] = round(item["target_amount"] - item["current_amount"], 2)
    visible_rows = [
        item for item in rows
        if item["plan_start_month"] <= month
    ]
    target_total = sum(item["target_amount"] for item in visible_rows if item["status"] != "archived")
    current_total = sum(item["current_amount"] for item in visible_rows if item["status"] != "archived")
    monthly_total = sum(item["monthly_saving"] for item in visible_rows if item["status"] == "active")
    if plan_range == "year":
        year = int(month[:4])
        end_month = int(month[5:7])
        plan_months = [f"{year}-{item:02d}" for item in range(1, end_month + 1)]
    else:
        plan_months = month_range(month, "6m" if plan_range == "6m" else "12m")
    actual_points = []
    plan_points = []
    for period in plan_months:
        actual = 0
        expected = 0
        for goal in rows:
            if goal["status"] == "archived" or goal["plan_start_month"] > period:
                continue
            records = records_by_goal.get(goal["id"], [])
            actual += goal["initial_amount"] + sum(
                record["amount"]
                for record in records
                if record["recorded_at"][:7] <= period
            )
            planned_months = months_between(goal["plan_start_month"], period) + 1
            expected += min(
                goal["target_amount"],
                goal["initial_amount"] + goal["monthly_saving"] * planned_months,
            )
        actual_points.append(actual)
        plan_points.append(expected)
    plan = []
    for index, period in enumerate(plan_months):
        plan.append({
            "period": month_label(period),
            "month": period,
            "actual": round(actual_points[index] / 10000, 1) if actual_points else 0,
            "plan": round(plan_points[index] / 10000, 1),
        })
    return {
        "month": month,
        "plan_range": plan_range,
        "target_total": round(target_total, 2),
        "current_total": round(current_total, 2),
        "monthly_saving": round(monthly_total, 2),
        "progress": round(current_total / target_total * 100, 1) if target_total else 0,
        "goals": visible_rows,
        "plan": plan,
    }


@consistent_query
def get_warehouse_snapshots(limit=12, context=None, *, conn=None):
    context = context or get_auth_context(conn)
    snapshot_scope, snapshot_scope_params = scoped_resource_clause("s", context)
    rows = conn.execute(
        f"""
        SELECT s.snapshot_date, s.asset_total, s.liability_total, s.net_worth,
               s.investment_value, s.cash_value, s.created_at
        FROM snapshots s
        WHERE {snapshot_scope}
        ORDER BY s.snapshot_date DESC
        LIMIT ?
        """,
        (*snapshot_scope_params, limit),
    ).fetchall()
    return list(reversed(rows_to_dicts(rows)))
