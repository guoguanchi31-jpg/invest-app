from datetime import datetime

from fastapi import APIRouter, HTTPException

from commands import financial_command
from database import get_connection, get_goal_visual, lock_row, rows_to_dicts
from schemas import GoalCreate, GoalUpdate, GoalRecordCreate, GoalStatusUpdate
from services import get_goals_overview


router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("")
def list_goals(month: str | None = None, plan_range: str = "12m"):
    return get_goals_overview(month, plan_range)


@router.get("/{goal_id}/records")
def list_goal_records(goal_id: int):
    conn = get_connection()
    goal = conn.execute(
        "SELECT id FROM goals WHERE id = ?",
        (goal_id,),
    ).fetchone()
    if not goal:
        conn.close()
        raise HTTPException(status_code=404, detail="目标不存在")
    rows = conn.execute(
        """
        SELECT id, goal_id, amount, recorded_at, note
        FROM goal_records
        WHERE goal_id = ?
        ORDER BY recorded_at DESC, id DESC
        """,
        (goal_id,),
    ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


@router.post("")
@financial_command
def create_goal(goal: GoalCreate):
    now = datetime.now().isoformat(timespec="seconds")
    icon, color = get_goal_visual(goal.name)
    conn = get_connection()
    cursor = conn.execute(
        """
        INSERT INTO goals
        (name, icon, target_amount, current_amount, monthly_saving, due_date, color, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            goal.name,
            icon,
            goal.target_amount,
            goal.current_amount,
            goal.monthly_saving,
            goal.due_date,
            color,
            goal.status,
            now,
            now,
        ),
    )
    conn.commit()
    goal_id = cursor.lastrowid
    conn.close()
    return {"id": goal_id, "message": "目标已创建"}


@router.patch("/{goal_id}")
@financial_command
def update_goal(goal_id: int, goal: GoalUpdate):
    now = datetime.now().isoformat(timespec="seconds")
    icon, color = get_goal_visual(goal.name)
    conn = get_connection()
    if not lock_row(conn, "goals", goal_id):
        raise HTTPException(status_code=404, detail="目标不存在")
    conn.execute(
        """
        UPDATE goals
        SET name = ?, icon = ?, target_amount = ?,
            monthly_saving = ?, due_date = ?, color = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            goal.name,
            icon,
            goal.target_amount,
            goal.monthly_saving,
            goal.due_date,
            color,
            now,
            goal_id,
        ),
    )
    conn.commit()
    conn.close()
    return {"message": "目标已更新"}


@router.patch("/{goal_id}/status")
@financial_command
def update_goal_status(goal_id: int, payload: GoalStatusUpdate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    if not lock_row(conn, "goals", goal_id):
        raise HTTPException(status_code=404, detail="目标不存在")
    cursor = conn.execute(
        "UPDATE goals SET status = ?, updated_at = ? WHERE id = ?",
        (payload.status, now, goal_id),
    )
    conn.commit()
    conn.close()
    return {"message": "目标状态已更新", "status": payload.status}


@router.post("/{goal_id}/records")
@financial_command
def create_goal_record(goal_id: int, record: GoalRecordCreate):
    if abs(record.amount) < 0.000001:
        raise HTTPException(status_code=409, detail="存取金额不能为零")
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    lock_row(conn, "goals", goal_id)
    goal = conn.execute(
        "SELECT id, current_amount, status FROM goals WHERE id = ?",
        (goal_id,),
    ).fetchone()
    if not goal:
        conn.close()
        raise HTTPException(status_code=404, detail="目标不存在")
    if goal["status"] in {"completed", "archived"}:
        conn.close()
        raise HTTPException(status_code=409, detail="已完成或已归档的目标不能继续存取")
    if (goal["current_amount"] or 0) + record.amount < 0:
        conn.close()
        raise HTTPException(status_code=409, detail="取出金额不能超过目标当前已存")
    cursor = conn.execute(
        "INSERT INTO goal_records (goal_id, amount, recorded_at, note) VALUES (?, ?, ?, ?)",
        (goal_id, record.amount, record.recorded_at, record.note),
    )
    conn.execute(
        "UPDATE goals SET current_amount = current_amount + ?, updated_at = ? WHERE id = ?",
        (record.amount, now, goal_id),
    )
    conn.commit()
    record_id = cursor.lastrowid
    conn.close()
    return {
        "id": record_id,
        "message": "目标存入已记录" if record.amount > 0 else "目标取出已记录",
    }


@router.delete("/{goal_id}")
@financial_command
def delete_goal(goal_id: int):
    conn = get_connection()
    goal = lock_row(conn, "goals", goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="目标不存在")
    if abs(goal["current_amount"] or 0) > 1e-8 or conn.execute(
        "SELECT 1 FROM goal_records WHERE goal_id = ? LIMIT 1", (goal_id,),
    ).fetchone():
        raise HTTPException(status_code=409, detail="已有存取记录的目标不能删除，请改为归档")
    conn.execute("DELETE FROM goal_records WHERE goal_id = ?", (goal_id,))
    conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    conn.commit()
    conn.close()
    return {"message": "目标已删除"}
