"""Fetch market quotes without a database lease, then apply guarded updates."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from application.snapshots import (
    refresh_family_warehouse_snapshots,
    refresh_warehouse_snapshot,
)
from infrastructure.database import get_connection, rows_to_dicts, family_write_connection
from domain.money import price
from domain.calendar import business_now, business_today
from integrations.market_data import fetch_price
from tenancy import get_auth_context, scoped_member_data_clause


logger = logging.getLogger(__name__)


def refresh_holding_prices(context=None):
    conn = get_connection()
    context = context or get_auth_context(conn)
    scope_clause, scope_params = scoped_member_data_clause("h", context)
    rows = rows_to_dicts(conn.execute(f"""
        SELECT h.id, h.member_id, h.name, h.code, h.market, h.asset_type,
               h.current_price, h.currency, h.exchange_rate_to_base, h.updated_at
        FROM holdings h LEFT JOIN accounts a ON a.id = h.account_id
        WHERE {scope_clause}
          AND (
                h.account_id IS NULL
                OR (a.is_active = 1 AND a.type = 'investment' AND a.is_liability = 0)
          )
    """, tuple(scope_params)).fetchall())
    conn.close()
    now = business_now().isoformat(timespec="seconds")

    def load_quote(row):
        if row["asset_type"] not in {None, "stock", "fund"}:
            return row, None, {
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "status": "skipped",
                "message": "暂未接入该资产类型行情，保留手动价格",
            }
        try:
            quote = fetch_price(row["code"], row["market"], row["asset_type"])
            if quote:
                return row, quote, {
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
                }
            return row, None, {
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "status": "failed",
                "message": "未获取到有效行情",
            }
        except Exception as exc:
            logger.warning(
                "quote_refresh_failed code=%s provider_chain=auto error=%s",
                row["code"],
                exc,
            )
            return row, None, {
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "status": "failed",
                "message": str(exc),
            }

    workers = max(
        1,
        min(int(os.environ.get("QUOTE_MAX_WORKERS", "4")), len(rows) or 1),
    )
    with ThreadPoolExecutor(max_workers=workers) as executor:
        fetched = list(executor.map(load_quote, rows))

    with family_write_connection(context.family_id) as conn:
        affected_member_ids = set()
        for row, quote, detail in fetched:
            if not quote:
                continue
            cursor = conn.execute(
                """
                UPDATE holdings
                SET current_price = ?, updated_at = ?
                WHERE id = ? AND family_id = ? AND code = ?
                  AND COALESCE(market, '') = ?
                  AND COALESCE(asset_type, '') = ?
                  AND COALESCE(currency, '') = ?
                  AND exchange_rate_to_base = ?
                  AND current_price = ?
                  AND COALESCE(updated_at, '') = ?
                """,
                (
                    price(quote["price"]),
                    now,
                    row["id"],
                    context.family_id,
                    row["code"],
                    row["market"] or "",
                    row["asset_type"] or "",
                    row["currency"] or "",
                    row["exchange_rate_to_base"],
                    row["current_price"],
                    row["updated_at"] or "",
                ),
            )
            if not cursor.rowcount:
                detail.update(
                    status="skipped",
                    message="持仓已在刷新期间发生变化",
                )
                continue
            if row["member_id"] is not None:
                affected_member_ids.add(row["member_id"])
            conn.execute(
                """
                INSERT INTO prices
                (family_id, code, price, price_date, source)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    context.family_id,
                    row["code"],
                    price(quote["price"]),
                    business_today().isoformat(),
                    quote["source"],
                ),
            )
        if context.authenticated:
            snapshot_member_ids = set(affected_member_ids)
            if context.scope == "personal":
                snapshot_member_ids.add(context.member_id)
            snapshots = refresh_family_warehouse_snapshots(
                conn,
                context,
                member_ids=snapshot_member_ids,
            )
            snapshot = next(
                item for item in snapshots
                if item["scope"] == context.scope
                and (
                    context.scope == "family"
                    or item.get("member_id") == context.member_id
                )
            )
        else:
            snapshot = refresh_warehouse_snapshot(conn=conn, context=context)

    from queries.finance import get_investment_summary

    details = [detail for _, _, detail in fetched]
    return {
        "updated": sum(item["status"] == "updated" for item in details),
        "failed": sum(item["status"] == "failed" for item in details),
        "skipped": sum(item["status"] == "skipped" for item in details),
        "total": len(rows),
        "source": "multi",
        "sources": sorted({
            item["source"]
            for item in details
            if item.get("status") == "updated" and item.get("source")
        }),
        "updated_at": now,
        "details": details,
        "snapshot": snapshot,
        "summary": get_investment_summary(context=context),
    }
