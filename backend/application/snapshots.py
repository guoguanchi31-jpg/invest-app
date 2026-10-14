"""Snapshot coordination with explicit family and member contexts."""

from datetime import datetime

from domain.calendar import business_today
from infrastructure.database import (
    get_connection, is_postgres_connection, family_write_connection, lock_family_write,
)
from queries.valuation import current_valuation
from tenancy import AuthContext


def refresh_warehouse_snapshot(snapshot_date=None, conn=None, context=None):
    if context is None:
        raise RuntimeError("快照刷新必须显式提供家庭上下文")
    if conn is None:
        with family_write_connection(context.family_id) as owned:
            return refresh_warehouse_snapshot(snapshot_date, owned, context)
    lock_family_write(conn, context.family_id)
    snapshot_date = snapshot_date or business_today().isoformat()
    now = datetime.now().isoformat(timespec="seconds")
    member_id = context.member_id if context.scope == "personal" else None
    conn.execute(
        """
        INSERT INTO snapshots
        (family_id, member_id, snapshot_date, asset_total, liability_total,
         net_worth, investment_value, cash_value, created_at)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?)
        ON CONFLICT DO NOTHING
        """,
        (context.family_id, member_id, snapshot_date, now),
    )
    lock_suffix = " FOR UPDATE" if is_postgres_connection(conn) else ""
    if member_id is None:
        scope = "family_id = ? AND member_id IS NULL"
        scope_params = (context.family_id,)
    else:
        scope = "family_id = ? AND member_id = ?"
        scope_params = (context.family_id, member_id)
    snapshot = conn.execute(
        f"""
        SELECT id FROM snapshots
        WHERE {scope} AND snapshot_date = ?
        {lock_suffix}
        """,
        (*scope_params, snapshot_date),
    ).fetchone()
    if not snapshot:
        raise RuntimeError("资产快照创建失败")
    valuation = current_valuation(conn, context, snapshot_date)
    conn.execute(
        """
        UPDATE snapshots
        SET asset_total = ?, liability_total = ?, net_worth = ?,
            investment_value = ?, cash_value = ?, created_at = ?
        WHERE id = ?
        """,
        (
            valuation["asset_total"], valuation["liability_total"], valuation["net_worth"],
            valuation["investment_value"], valuation["cash_value"], now, snapshot["id"],
        ),
    )
    return {**valuation, "created_at": now}


def refresh_family_warehouse_snapshots(
    conn,
    context,
    snapshot_date=None,
    member_ids=None,
):
    family_context = context.with_scope("family")
    results = [
        refresh_warehouse_snapshot(
            snapshot_date,
            conn,
            family_context,
        )
    ]
    member_filter = ""
    member_params = []
    if member_ids is not None:
        member_params = sorted({
            int(member_id)
            for member_id in member_ids
            if member_id is not None
        })
        if not member_params:
            return results
        placeholders = ",".join("?" for _ in member_params)
        member_filter = f"AND fm.id IN ({placeholders})"
    members = conn.execute(
        f"""
        SELECT fm.id AS member_id, fm.display_name, fm.role,
               COALESCE(u.id, 0) AS user_id, COALESCE(u.username, '') AS username
        FROM family_members fm
        LEFT JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = ? AND fm.is_active = 1
          {member_filter}
        ORDER BY fm.id
        """,
        (context.family_id, *member_params),
    ).fetchall()
    for member in members:
        member_context = AuthContext(
            user_id=member["user_id"],
            username=member["username"],
            display_name=member["display_name"],
            family_id=context.family_id,
            family_name=context.family_name,
            member_id=member["member_id"],
            role=member["role"],
            scope="personal",
            authenticated=context.authenticated,
        )
        results.append(
            refresh_warehouse_snapshot(
                snapshot_date,
                conn,
                member_context,
            )
        )
    return results


def refresh_all_warehouse_snapshots(snapshot_date=None, conn=None):
    owns_connection = conn is None
    conn = conn or get_connection()
    try:
        families = conn.execute(
            """
            SELECT f.id AS family_id, f.name AS family_name,
                   fm.id AS member_id, fm.display_name, fm.role,
                   COALESCE(u.id, 0) AS user_id, COALESCE(u.username, '') AS username
            FROM families f
            JOIN family_members fm ON fm.family_id = f.id AND fm.is_active = 1
            LEFT JOIN users u ON u.id = fm.user_id
            ORDER BY f.id, CASE WHEN fm.role = 'owner' THEN 0 ELSE 1 END, fm.id
            """
        ).fetchall()
        family_done = set()
        results = []
        if owns_connection:
            # Finish discovery before acquiring any family write lock.
            conn.close()
            conn = None
        for row in families:
            if row["family_id"] in family_done:
                continue
            context = AuthContext(
                user_id=row["user_id"],
                username=row["username"],
                display_name=row["display_name"],
                family_id=row["family_id"],
                family_name=row["family_name"],
                member_id=row["member_id"],
                role=row["role"],
                authenticated=False,
            )
            if owns_connection:
                with family_write_connection(context.family_id) as family_conn:
                    results.extend(refresh_family_warehouse_snapshots(
                        family_conn, context, snapshot_date,
                    ))
            else:
                # Caller-owned batches follow ascending family order.
                results.extend(
                    refresh_family_warehouse_snapshots(conn, context, snapshot_date)
                )
            family_done.add(row["family_id"])
        return results
    except Exception:
        if owns_connection and conn is not None:
            conn.rollback()
        raise
    finally:
        if owns_connection and conn is not None:
            conn.close()
