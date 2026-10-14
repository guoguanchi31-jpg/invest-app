"""Persistence helpers for derived budget allocation summaries."""


def replace_budget_member_allocations(
    conn,
    family_id,
    plan_id,
    now,
    allocations,
):
    conn.execute(
        "DELETE FROM budget_member_allocations WHERE budget_plan_id = ?",
        (plan_id,),
    )
    for member_id, amount in allocations:
        conn.execute(
            """
            INSERT INTO budget_member_allocations
            (family_id, budget_plan_id, member_id, amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (family_id, plan_id, member_id, amount, now, now),
        )


def sync_budget_member_allocations(
    conn,
    family_id,
    plan_id,
    now,
    member_ids=None,
):
    totals = {
        row["member_id"]: row["amount"] or 0
        for row in conn.execute(
            """
            SELECT member_id, SUM(amount) AS amount
            FROM budget_category_allocations
            WHERE budget_plan_id = ?
            GROUP BY member_id
            """,
            (plan_id,),
        ).fetchall()
    }
    for member_id in member_ids or []:
        totals.setdefault(member_id, 0)
    existing = {
        row["member_id"]: row["id"]
        for row in conn.execute(
            """
            SELECT id, member_id
            FROM budget_member_allocations
            WHERE budget_plan_id = ?
            """,
            (plan_id,),
        ).fetchall()
    }
    for member_id, amount in totals.items():
        if member_id in existing:
            conn.execute(
                """
                UPDATE budget_member_allocations
                SET amount = ?, updated_at = ?
                WHERE id = ?
                """,
                (amount, now, existing[member_id]),
            )
        else:
            conn.execute(
                """
                INSERT INTO budget_member_allocations
                (family_id, budget_plan_id, member_id, amount, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (family_id, plan_id, member_id, amount, now, now),
            )
    for member_id in set(existing) - set(totals):
        conn.execute(
            "DELETE FROM budget_member_allocations "
            "WHERE budget_plan_id = ? AND member_id = ?",
            (plan_id, member_id),
        )
