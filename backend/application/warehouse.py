"""Warehouse use cases that combine current valuation with read models."""

from datetime import timedelta

from domain.calendar import business_today
from infrastructure.database import BASE_CURRENCY, rows_to_dicts
from infrastructure.read_models import consistent_query
from queries.finance import get_warehouse_snapshots
from queries.valuation import current_valuation
from tenancy import get_auth_context, scoped_account_clause


@consistent_query
def get_warehouse_overview(context=None, *, conn=None):
    context = context or get_auth_context(conn)
    today_snapshot = current_valuation(conn, context)
    snapshots = get_warehouse_snapshots(12, context, conn=conn)
    snapshots = sorted(
        [row for row in snapshots if row["snapshot_date"] != today_snapshot["snapshot_date"]]
        + [today_snapshot],
        key=lambda row: row["snapshot_date"],
    )[-12:]
    start_date = (business_today().replace(day=1) - timedelta(days=365)).isoformat()
    account_scope, account_scope_params = scoped_account_clause("a", context)
    monthly_rows = conn.execute(
        f"""
        SELECT
            substr(t.occurred_at, 1, 7) AS month,
            SUM(CASE WHEN t.direction = 'income' THEN t.base_amount ELSE 0 END) AS income,
            SUM(CASE WHEN t.direction = 'expense' THEN t.base_amount ELSE 0 END) AS expense
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE {account_scope}
          AND t.occurred_at >= ?
          AND COALESCE(t.source, 'manual') = 'manual'
        GROUP BY substr(t.occurred_at, 1, 7)
        ORDER BY month
        """,
        (*account_scope_params, start_date),
    ).fetchall()
    income_category_rows = conn.execute(
        f"""
        SELECT c.name, c.icon, c.color,
               COALESCE(SUM(t.base_amount), 0) AS amount
        FROM categories c
        LEFT JOIN transactions t
            ON t.category_id = c.id
            AND t.direction = 'income'
            AND t.occurred_at >= ?
            AND COALESCE(t.source, 'manual') = 'manual'
            AND t.account_id IN (
                SELECT a.id FROM accounts a WHERE {account_scope}
            )
        WHERE c.family_id = ? AND c.type = 'income'
        GROUP BY c.id, c.name, c.icon, c.color
        HAVING COALESCE(SUM(t.base_amount), 0) > 0
        ORDER BY amount DESC
        """,
        (start_date, *account_scope_params, context.family_id),
    ).fetchall()
    return {
        "base_currency": BASE_CURRENCY,
        "snapshot": today_snapshot,
        "snapshots": snapshots,
        "monthly_cashflow": rows_to_dicts(monthly_rows),
        "income_categories": rows_to_dicts(income_category_rows),
    }
