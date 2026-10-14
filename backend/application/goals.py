from datetime import datetime

from fastapi import HTTPException

from application.commands import AuditFact, command_result
from domain.catalog import get_goal_visual
from domain.calendar import business_now
from infrastructure.read_models import consistent_query
from infrastructure.database import (
    lock_row,
    rows_to_dicts,
)
from domain.money import money
from schemas import GoalCreate, GoalRecordCreate, GoalStatusUpdate, GoalUpdate
from queries.finance import get_goals_overview
from tenancy import assert_family_admin, can_manage_family, get_auth_context


def goal_state(conn, goal_id):
    goal = conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not goal:
        return None
    return {
        "goal": dict(goal),
        "allocations": [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM goal_allocations "
                "WHERE goal_id = ? ORDER BY member_id",
                (goal_id,),
            ).fetchall()
        ],
    }


def require_family_plan_admin(context):
    assert_family_admin(context)
    if context.scope != "family":
        raise HTTPException(status_code=403, detail="请切换到家庭模式设置家庭目标")


def get_scoped_goal(conn, goal_id, context=None):
    context = context or get_auth_context(conn)
    personal_join = ""
    params = [goal_id, context.family_id]
    if context.scope == "personal":
        personal_join = """
          AND EXISTS (
              SELECT 1 FROM goal_allocations ga
              WHERE ga.goal_id = goals.id AND ga.member_id = ?
          )
        """
        params.append(context.member_id)
    goal = conn.execute(
        f"""
        SELECT * FROM goals
        WHERE id = ? AND family_id = ? {personal_join}
        """,
        tuple(params),
    ).fetchone()
    return goal


def validate_goal_members(conn, family_id, allocations):
    member_ids = [item.member_id for item in allocations]
    placeholders = ",".join("?" for _ in member_ids)
    rows = conn.execute(
        f"""
        SELECT id FROM family_members
        WHERE family_id = ? AND is_active = 1 AND id IN ({placeholders})
        """,
        (family_id, *member_ids),
    ).fetchall()
    if {row["id"] for row in rows} != set(member_ids):
        raise HTTPException(status_code=404, detail="目标分配中包含无效家庭成员")


def replace_goal_allocations(conn, context, goal_id, allocations, now, *, creating=False):
    validate_goal_members(conn, context.family_id, allocations)
    existing = {
        row["member_id"]: dict(row)
        for row in conn.execute(
            "SELECT * FROM goal_allocations WHERE goal_id = ?",
            (goal_id,),
        ).fetchall()
    }
    submitted_members = {item.member_id for item in allocations}
    for member_id, row in existing.items():
        if member_id in submitted_members:
            continue
        has_records = conn.execute(
            """
            SELECT 1 FROM goal_records
            WHERE goal_id = ? AND member_id = ? LIMIT 1
            """,
            (goal_id, member_id),
        ).fetchone()
        if abs(row["current_amount"] or 0) > 1e-8 or has_records:
            raise HTTPException(
                status_code=409,
                detail="已有积累记录的成员不能从目标分配中移除",
            )
    for item in allocations:
        previous = existing.get(item.member_id)
        if previous:
            current_amount = previous["current_amount"]
            conn.execute(
                """
                UPDATE goal_allocations
                SET target_amount = ?, monthly_saving = ?, updated_at = ?
                WHERE id = ?
                """,
                (item.target_amount, item.monthly_saving, now, previous["id"]),
            )
        else:
            current_amount = item.current_amount or 0
            conn.execute(
                """
                INSERT INTO goal_allocations
                (family_id, goal_id, member_id, target_amount, current_amount,
                 monthly_saving, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    context.family_id, goal_id, item.member_id, item.target_amount,
                    current_amount, item.monthly_saving, now, now,
                ),
            )
    for member_id in set(existing) - submitted_members:
        conn.execute(
            "DELETE FROM goal_allocations WHERE goal_id = ? AND member_id = ?",
            (goal_id, member_id),
        )
    current_total = conn.execute(
        """
        SELECT COALESCE(SUM(current_amount), 0) AS total
        FROM goal_allocations
        WHERE goal_id = ?
        """,
        (goal_id,),
    ).fetchone()["total"]
    if creating:
        submitted_current = sum(
            (money(item.current_amount or 0) for item in allocations),
            money(0),
        )
        current_total = submitted_current
    return current_total


def list_goals(month: str | None = None, plan_range: str = "12m"):
    return get_goals_overview(month, plan_range)


@consistent_query
def list_goal_records(goal_id: int, *, conn=None):
    context = get_auth_context(conn)
    goal = get_scoped_goal(conn, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")
    member_filter = "AND r.member_id = ?" if context.scope == "personal" else ""
    params = [goal_id]
    if context.scope == "personal":
        params.append(context.member_id)
    rows = conn.execute(
        f"""
        SELECT r.id, r.goal_id, r.member_id, fm.display_name AS member_name,
               r.amount, r.recorded_at, r.note
        FROM goal_records r
        LEFT JOIN family_members fm ON fm.id = r.member_id
        WHERE r.goal_id = ? {member_filter}
        ORDER BY r.recorded_at DESC, r.id DESC
        """,
        tuple(params),
    ).fetchall()
    return rows_to_dicts(rows)


def create_goal(conn, context, goal: GoalCreate):
    now = business_now().isoformat(timespec="seconds")
    icon, color = get_goal_visual(goal.name)
    require_family_plan_admin(context)
    validate_goal_members(conn, context.family_id, goal.allocations)
    current_total = sum(
        (money(item.current_amount or 0) for item in goal.allocations),
        money(0),
    )
    goal_id = conn.execute(
        """
        INSERT INTO goals
        (family_id, member_id, name, icon, target_amount, current_amount,
         monthly_saving, due_date, color, status, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (
            context.family_id, goal.name, icon, goal.target_amount, current_total,
            goal.monthly_saving, goal.due_date, color, goal.status, now, now,
        ),
    ).fetchone()["id"]
    replace_goal_allocations(
        conn,
        context,
        goal_id,
        goal.allocations,
        now,
        creating=True,
    )
    return command_result(
        {"id": goal_id, "message": "家庭目标已创建"},
        audit_facts=(AuditFact(
            action="创建家庭目标",
            entity_type="goal",
            entity_id=goal_id,
            summary=f"创建家庭目标：{goal.name}",
            after_value=goal_state(conn, goal_id),
        ),),
    )


def update_goal(conn, context, goal_id: int, goal: GoalUpdate):
    now = datetime.now().isoformat(timespec="seconds")
    icon, color = get_goal_visual(goal.name)
    require_family_plan_admin(context)
    if not lock_row(conn, "goals", goal_id):
        raise HTTPException(status_code=404, detail="目标不存在")
    existing = get_scoped_goal(conn, goal_id, context)
    if not existing:
        raise HTTPException(status_code=404, detail="目标不存在")
    before = goal_state(conn, goal_id)
    current_total = replace_goal_allocations(
        conn,
        context,
        goal_id,
        goal.allocations,
        now,
    )
    conn.execute(
        """
        UPDATE goals
        SET member_id = NULL, name = ?, icon = ?, target_amount = ?,
            current_amount = ?, monthly_saving = ?, due_date = ?, color = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            goal.name, icon, goal.target_amount, current_total,
            goal.monthly_saving, goal.due_date, color, now, goal_id,
        ),
    )
    return command_result(
        {"message": "家庭目标已更新"},
        audit_facts=(AuditFact(
            action="修改家庭目标",
            entity_type="goal",
            entity_id=goal_id,
            summary=f"修改家庭目标：{goal.name}",
            before_value=before,
            after_value=goal_state(conn, goal_id),
        ),),
    )


def update_goal_status(conn, context, goal_id: int, payload: GoalStatusUpdate):
    now = datetime.now().isoformat(timespec="seconds")
    require_family_plan_admin(context)
    if not lock_row(conn, "goals", goal_id) or not get_scoped_goal(
        conn,
        goal_id,
        context,
    ):
        raise HTTPException(status_code=404, detail="目标不存在")
    before = goal_state(conn, goal_id)
    conn.execute(
        "UPDATE goals SET status = ?, updated_at = ? WHERE id = ?",
        (payload.status, now, goal_id),
    )
    return command_result(
        {"message": "目标状态已更新", "status": payload.status},
        audit_facts=(AuditFact(
            action="变更目标状态",
            entity_type="goal",
            entity_id=goal_id,
            summary=f"变更目标状态：{payload.status}",
            before_value=before,
            after_value=goal_state(conn, goal_id),
        ),),
    )


def create_goal_record(conn, context, goal_id: int, record: GoalRecordCreate):
    record_amount = money(record.amount)
    if record_amount == 0:
        raise HTTPException(status_code=409, detail="存取金额不能为零")
    now = datetime.now().isoformat(timespec="seconds")
    lock_row(conn, "goals", goal_id)
    goal = get_scoped_goal(conn, goal_id, context)
    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")
    if goal["status"] in {"completed", "archived"}:
        raise HTTPException(status_code=409, detail="已完成或已归档的目标不能继续存取")
    if can_manage_family(context) and context.scope == "family":
        member_id = record.member_id or context.member_id
    else:
        if record.member_id is not None and record.member_id != context.member_id:
            raise HTTPException(status_code=403, detail="只能记录自己的目标积累")
        member_id = context.member_id
    allocation = conn.execute(
        """
        SELECT * FROM goal_allocations
        WHERE goal_id = ? AND member_id = ?
        """,
        (goal_id, member_id),
    ).fetchone()
    if not allocation:
        raise HTTPException(status_code=409, detail="该成员未分配此目标")
    if money(allocation["current_amount"] or 0) + record_amount < 0:
        raise HTTPException(status_code=409, detail="取出金额不能超过该成员当前已存")
    before = {
        "goal": dict(goal),
        "allocation": dict(allocation),
    }
    record_id = conn.execute(
        """
        INSERT INTO goal_records
        (family_id, member_id, goal_id, amount, recorded_at, note)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (
            goal["family_id"], member_id, goal_id,
            record_amount, record.recorded_at, record.note,
        ),
    ).fetchone()["id"]
    conn.execute(
        """
        UPDATE goal_allocations
        SET current_amount = ROUND(current_amount + ?, 2), updated_at = ?
        WHERE goal_id = ? AND member_id = ?
        """,
        (record_amount, now, goal_id, member_id),
    )
    conn.execute(
        "UPDATE goals SET current_amount = ROUND(current_amount + ?, 2), updated_at = ? WHERE id = ?",
        (record_amount, now, goal_id),
    )
    response = {
        "id": record_id,
        "message": "目标存入已记录" if record_amount > 0 else "目标取出已记录",
    }
    after = {
        "goal": dict(conn.execute(
            "SELECT * FROM goals WHERE id = ?",
            (goal_id,),
        ).fetchone()),
        "allocation": dict(conn.execute(
            "SELECT * FROM goal_allocations WHERE goal_id = ? AND member_id = ?",
            (goal_id, member_id),
        ).fetchone()),
        "record": dict(conn.execute(
            "SELECT * FROM goal_records WHERE id = ?",
            (record_id,),
        ).fetchone()),
    }
    return command_result(
        response,
        audit_facts=(AuditFact(
            action="记录目标进度",
            entity_type="goal_record",
            entity_id=record_id,
            summary=(
                f"{'存入' if record_amount > 0 else '取出'}目标进度："
                f"{abs(record_amount)}"
            ),
            reason=record.note,
            before_value=before,
            after_value=after,
        ),),
    )


def delete_goal(conn, context, goal_id: int):
    require_family_plan_admin(context)
    if not lock_row(conn, "goals", goal_id):
        raise HTTPException(status_code=404, detail="目标不存在")
    goal = get_scoped_goal(conn, goal_id, context)
    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")
    before = goal_state(conn, goal_id)
    if abs(goal["current_amount"] or 0) > 1e-8 or conn.execute(
        "SELECT 1 FROM goal_records WHERE goal_id = ? LIMIT 1",
        (goal_id,),
    ).fetchone():
        raise HTTPException(status_code=409, detail="已有存取记录的目标不能删除，请改为归档")
    conn.execute("DELETE FROM goal_allocations WHERE goal_id = ?", (goal_id,))
    conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    return command_result(
        {"message": "目标已删除"},
        audit_facts=(AuditFact(
            action="删除家庭目标",
            entity_type="goal",
            entity_id=goal_id,
            summary=f"删除家庭目标：{goal['name']}",
            before_value=before,
        ),),
    )
