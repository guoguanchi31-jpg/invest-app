from datetime import datetime

from fastapi import HTTPException

from application.commands import AuditFact, command_result
from domain.catalog import get_category_visual
from infrastructure.database import (
    get_connection,
    lock_row,
)
from domain.budgets import distribute_budget_category_allocations
from infrastructure.budget_allocations import (
    replace_budget_member_allocations,
    sync_budget_member_allocations,
)
from schemas import BudgetCopyCreate, BudgetCreate
from queries.finance import get_budget_monthly
from tenancy import assert_family_admin


def budget_plan_state(conn, plan_id):
    if plan_id is None:
        return None
    plan = conn.execute(
        "SELECT * FROM budget_plans WHERE id = ?",
        (plan_id,),
    ).fetchone()
    if not plan:
        return None
    return {
        **dict(plan),
        "categories": [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM budgets WHERE family_id = ? AND month = ? ORDER BY id",
                (plan["family_id"], plan["month"]),
            ).fetchall()
        ],
        "member_allocations": [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM budget_member_allocations "
                "WHERE budget_plan_id = ? ORDER BY member_id",
                (plan_id,),
            ).fetchall()
        ],
        "category_allocations": [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM budget_category_allocations "
                "WHERE budget_plan_id = ? ORDER BY category_id, member_id",
                (plan_id,),
            ).fetchall()
        ],
    }


def require_family_plan_admin(context):
    assert_family_admin(context)
    if context.scope != "family":
        raise HTTPException(status_code=403, detail="请切换到家庭模式设置家庭预算")


def get_or_create_expense_category(
    conn,
    context,
    category_id=None,
    category_name=None,
):
    if category_id:
        existing = conn.execute(
            """
            SELECT id FROM categories
            WHERE id = ? AND family_id = ? AND type = 'expense' AND is_active = 1
            """,
            (category_id, context.family_id),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="预算分类不存在")
        return existing["id"]
    name = (category_name or "").strip()
    existing = conn.execute(
        """
        SELECT id FROM categories
        WHERE family_id = ? AND name = ? AND type = 'expense' AND is_active = 1
        """,
        (context.family_id, name),
    ).fetchone()
    if existing:
        return existing["id"]
    max_order = conn.execute(
        """
        SELECT COALESCE(MAX(sort_order), 0) AS sort_order
        FROM categories WHERE family_id = ? AND type = 'expense'
        """,
        (context.family_id,),
    ).fetchone()["sort_order"]
    icon, color = get_category_visual(name, "expense")
    created = conn.execute(
        """
        INSERT INTO categories
        (family_id, name, type, icon, color, sort_order)
        VALUES (?, ?, 'expense', ?, ?, ?)
        ON CONFLICT(family_id, name, type) DO NOTHING
        RETURNING id
        """,
        (context.family_id, name, icon, color, max_order + 1),
    ).fetchone()
    if created:
        return created["id"]
    return conn.execute(
        """
        SELECT id FROM categories
        WHERE family_id = ? AND name = ? AND type = 'expense'
        """,
        (context.family_id, name),
    ).fetchone()["id"]


def validate_members(conn, family_id, allocation_groups):
    active_member_ids = {
        row["id"]
        for row in conn.execute(
            """
            SELECT id FROM family_members
            WHERE family_id = ? AND is_active = 1
            """,
            (family_id,),
        ).fetchall()
    }
    for allocations in allocation_groups:
        member_ids = {member_id for member_id, _ in allocations}
        if not member_ids.issubset(active_member_ids):
            raise HTTPException(status_code=404, detail="预算分配中包含无效家庭成员")
        if member_ids != active_member_ids:
            raise HTTPException(
                status_code=409,
                detail="请在每个分类下为每位有效家庭成员设置承担金额，可填写零",
            )
    return sorted(active_member_ids)


def replace_monthly_budget(conn, context, budget, now):
    categories = []
    seen_category_ids = set()
    for item in budget.categories:
        category_id = get_or_create_expense_category(
            conn,
            context,
            item.category_id,
            item.category_name,
        )
        if category_id in seen_category_ids:
            raise HTTPException(status_code=409, detail="预算分类不能重复")
        seen_category_ids.add(category_id)
        categories.append((category_id, item))
    direct_member_allocations = [
        (allocation.member_id, allocation.amount)
        for allocation in budget.member_allocations
    ]
    if not categories:
        category_allocations = {}
        active_member_ids = validate_members(
            conn,
            context.family_id,
            [direct_member_allocations],
        )
    elif all(item.member_allocations for _, item in categories):
        category_allocations = {
            category_id: [
                (allocation.member_id, allocation.amount)
                for allocation in item.member_allocations
            ]
            for category_id, item in categories
        }
    else:
        matrix = distribute_budget_category_allocations(
            [(category_id, item.amount) for category_id, item in categories],
            [
                (allocation.member_id, allocation.amount)
                for allocation in budget.member_allocations
            ],
            context.member_id,
        )
        category_allocations = {}
        for category_id, member_id, amount in matrix:
            category_allocations.setdefault(category_id, []).append((member_id, amount))
    if categories:
        active_member_ids = validate_members(
            conn,
            context.family_id,
            category_allocations.values(),
        )

    plan = conn.execute(
        """
        SELECT id FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, budget.month),
    ).fetchone()
    if plan:
        plan_id = plan["id"]
        conn.execute(
            """
            UPDATE budget_plans
            SET total_amount = ?, updated_at = ?
            WHERE id = ?
            """,
            (budget.total_amount, now, plan_id),
        )
    else:
        plan_id = conn.execute(
            """
            INSERT INTO budget_plans
            (family_id, month, total_amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """,
            (context.family_id, budget.month, budget.total_amount, now, now),
        ).fetchone()["id"]

    existing_categories = {
        row["category_id"]: row["id"]
        for row in conn.execute(
            """
            SELECT id, category_id FROM budgets
            WHERE family_id = ? AND month = ?
            """,
            (context.family_id, budget.month),
        ).fetchall()
    }
    for category_id, item in categories:
        if category_id in existing_categories:
            conn.execute(
                """
                UPDATE budgets
                SET member_id = NULL, amount = ?, alert_threshold = ?, updated_at = ?
                WHERE id = ?
                """,
                (item.amount, item.alert_threshold, now, existing_categories[category_id]),
            )
        else:
            conn.execute(
                """
                INSERT INTO budgets
                (family_id, member_id, month, category_id, amount, alert_threshold,
                 created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    context.family_id, budget.month, category_id, item.amount,
                    item.alert_threshold, now, now,
                ),
            )
    removed_category_ids = set(existing_categories) - seen_category_ids
    for category_id in removed_category_ids:
        conn.execute(
            "DELETE FROM budgets WHERE family_id = ? AND month = ? AND category_id = ?",
            (context.family_id, budget.month, category_id),
        )

    conn.execute(
        "DELETE FROM budget_category_allocations WHERE budget_plan_id = ?",
        (plan_id,),
    )
    for category_id, _ in categories:
        for member_id, amount in category_allocations[category_id]:
            conn.execute(
                """
                INSERT INTO budget_category_allocations
                (family_id, budget_plan_id, category_id, member_id, amount,
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    context.family_id, plan_id, category_id, member_id,
                    amount, now, now,
                ),
            )
    if categories:
        sync_budget_member_allocations(
            conn,
            context.family_id,
            plan_id,
            now,
            member_ids=active_member_ids,
        )
    else:
        replace_budget_member_allocations(
            conn,
            context.family_id,
            plan_id,
            now,
            direct_member_allocations,
        )
    return plan_id


def monthly_budget(month: str | None = None):
    return get_budget_monthly(month)


def create_or_update_budget(conn, context, budget: BudgetCreate):
    now = datetime.now().isoformat(timespec="seconds")
    require_family_plan_admin(context)
    existing = conn.execute(
        "SELECT id FROM budget_plans WHERE family_id = ? AND month = ?",
        (context.family_id, budget.month),
    ).fetchone()
    if existing:
        lock_row(conn, "budget_plans", existing["id"])
    before = budget_plan_state(conn, existing["id"] if existing else None)
    plan_id = replace_monthly_budget(conn, context, budget, now)
    after = budget_plan_state(conn, plan_id)
    response = {
        "id": plan_id,
        "message": "家庭预算已保存",
        "category_count": len(budget.categories),
        "member_count": len({
            allocation.member_id
            for allocation in (
                budget.member_allocations
                or [
                    item
                    for category in budget.categories
                    for item in category.member_allocations
                ]
            )
        }),
    }
    return command_result(
        response,
        audit_facts=(AuditFact(
            action="保存家庭预算",
            entity_type="budget_plan",
            entity_id=plan_id,
            summary=f"保存家庭预算：{budget.month}",
            before_value=before,
            after_value=after,
        ),),
    )


def copy_monthly_budget(conn, context, payload: BudgetCopyCreate):
    if payload.source_month == payload.target_month:
        raise HTTPException(status_code=409, detail="来源月份和目标月份不能相同")
    now = datetime.now().isoformat(timespec="seconds")
    require_family_plan_admin(context)
    source = conn.execute(
        """
        SELECT id, total_amount
        FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, payload.source_month),
    ).fetchone()
    if not source:
        raise HTTPException(status_code=404, detail="来源月份没有可沿用的预算")
    target = conn.execute(
        """
        SELECT id FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, payload.target_month),
    ).fetchone()
    for plan_id in sorted({
        row["id"] for row in (source, target) if row is not None
    }):
        lock_row(conn, "budget_plans", plan_id)
    source = conn.execute(
        """
        SELECT id, total_amount
        FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, payload.source_month),
    ).fetchone()
    target = conn.execute(
        """
        SELECT id FROM budget_plans
        WHERE family_id = ? AND month = ?
        """,
        (context.family_id, payload.target_month),
    ).fetchone()
    if not source:
        raise HTTPException(status_code=409, detail="来源预算已变化，请刷新后重试")
    before = budget_plan_state(conn, target["id"] if target else None)
    if target and not payload.overwrite:
        existing_count = conn.execute(
            """
            SELECT COUNT(*) AS count FROM budgets
            WHERE family_id = ? AND month = ?
            """,
            (context.family_id, payload.target_month),
        ).fetchone()["count"]
        return command_result({
                "message": "目标月份已有预算，未覆盖",
                "copied": 0,
                "skipped": existing_count,
            })
    if target:
        target_id = target["id"]
        conn.execute(
            "UPDATE budget_plans SET total_amount = ?, updated_at = ? WHERE id = ?",
            (source["total_amount"], now, target_id),
        )
        conn.execute(
            "DELETE FROM budgets WHERE family_id = ? AND month = ?",
            (context.family_id, payload.target_month),
        )
        conn.execute(
            "DELETE FROM budget_member_allocations WHERE budget_plan_id = ?",
            (target_id,),
        )
        conn.execute(
            "DELETE FROM budget_category_allocations WHERE budget_plan_id = ?",
            (target_id,),
        )
    else:
        target_id = conn.execute(
            """
            INSERT INTO budget_plans
            (family_id, month, total_amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """,
            (context.family_id, payload.target_month, source["total_amount"], now, now),
        ).fetchone()["id"]
    categories = conn.execute(
        """
        SELECT category_id, amount, alert_threshold
        FROM budgets
        WHERE family_id = ? AND month = ?
        ORDER BY id
        """,
        (context.family_id, payload.source_month),
    ).fetchall()
    for item in categories:
        conn.execute(
            """
            INSERT INTO budgets
            (family_id, member_id, month, category_id, amount, alert_threshold,
             created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
            """,
            (
                context.family_id, payload.target_month, item["category_id"],
                item["amount"], item["alert_threshold"], now, now,
            ),
        )
    category_allocations = conn.execute(
        """
        SELECT category_id, member_id, amount
        FROM budget_category_allocations
        WHERE budget_plan_id = ?
        ORDER BY category_id, member_id
        """,
        (source["id"],),
    ).fetchall()
    source_member_allocations = conn.execute(
        """
        SELECT member_id, amount
        FROM budget_member_allocations
        WHERE budget_plan_id = ?
        ORDER BY member_id
        """,
        (source["id"],),
    ).fetchall()
    amounts_by_category_member = {
        (item["category_id"], item["member_id"]): item["amount"]
        for item in category_allocations
    }
    active_members = conn.execute(
        """
        SELECT id FROM family_members
        WHERE family_id = ?
          AND (
              is_active = 1
              OR id IN (
                  SELECT member_id
                  FROM budget_category_allocations
                  WHERE budget_plan_id = ?
              )
          )
        ORDER BY id
        """,
        (context.family_id, source["id"]),
    ).fetchall()
    for category in categories:
        for member in active_members:
            conn.execute(
                """
                INSERT INTO budget_category_allocations
                (family_id, budget_plan_id, category_id, member_id, amount,
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    context.family_id, target_id, category["category_id"], member["id"],
                    amounts_by_category_member.get(
                        (category["category_id"], member["id"]),
                        0,
                    ),
                    now, now,
                ),
            )
    replace_budget_member_allocations(
        conn,
        context.family_id,
        target_id,
        now,
        [
            (allocation["member_id"], allocation["amount"])
            for allocation in source_member_allocations
        ],
    )
    response = {
        "id": target_id,
        "message": f"已沿用 {len(source_member_allocations)} 位成员预算",
        "copied": len(source_member_allocations),
        "skipped": 0,
    }
    return command_result(
        response,
        audit_facts=(AuditFact(
            action="复制家庭预算",
            entity_type="budget_plan",
            entity_id=target_id,
            summary=(
                f"复制家庭预算：{payload.source_month} → {payload.target_month}"
            ),
            before_value=before,
            after_value=budget_plan_state(conn, target_id),
        ),),
    )


def delete_monthly_budget(conn, context, month: str):
    require_family_plan_admin(context)
    plan = conn.execute(
        "SELECT id FROM budget_plans WHERE family_id = ? AND month = ?",
        (context.family_id, month),
    ).fetchone()
    if not plan:
        raise HTTPException(status_code=404, detail="预算不存在")
    lock_row(conn, "budget_plans", plan["id"])
    before = budget_plan_state(conn, plan["id"])
    conn.execute(
        "DELETE FROM budget_category_allocations WHERE budget_plan_id = ?",
        (plan["id"],),
    )
    conn.execute(
        "DELETE FROM budget_member_allocations WHERE budget_plan_id = ?",
        (plan["id"],),
    )
    conn.execute(
        "DELETE FROM budgets WHERE family_id = ? AND month = ?",
        (context.family_id, month),
    )
    conn.execute("DELETE FROM budget_plans WHERE id = ?", (plan["id"],))
    return command_result(
        {"message": "月度预算已删除"},
        audit_facts=(AuditFact(
            action="删除家庭预算",
            entity_type="budget_plan",
            entity_id=plan["id"],
            summary=f"删除家庭预算：{month}",
            before_value=before,
        ),),
    )
