from fastapi import APIRouter

from application.commands import financial_command
from application.goals import (
    create_goal as create_goal_use_case,
    create_goal_record as create_goal_record_use_case,
    delete_goal as delete_goal_use_case,
    list_goal_records as list_goal_records_query,
    list_goals as list_goals_query,
    update_goal as update_goal_use_case,
    update_goal_status as update_goal_status_use_case,
)
from schemas import GoalCreate, GoalRecordCreate, GoalStatusUpdate, GoalUpdate
from infrastructure.database import current_command_connection
from tenancy import get_auth_context


router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("")
def list_goals(month: str | None = None, plan_range: str = "12m"):
    return list_goals_query(month, plan_range)


@router.get("/{goal_id}/records")
def list_goal_records(goal_id: int):
    return list_goal_records_query(goal_id)


@router.post("")
@financial_command(update_snapshot=False)
def create_goal(goal: GoalCreate):
    conn = current_command_connection()
    return create_goal_use_case(conn, get_auth_context(conn), goal)


@router.patch("/{goal_id}")
@financial_command(update_snapshot=False)
def update_goal(goal_id: int, goal: GoalUpdate):
    conn = current_command_connection()
    return update_goal_use_case(conn, get_auth_context(conn), goal_id, goal)


@router.patch("/{goal_id}/status")
@financial_command(update_snapshot=False)
def update_goal_status(goal_id: int, payload: GoalStatusUpdate):
    conn = current_command_connection()
    return update_goal_status_use_case(
        conn,
        get_auth_context(conn),
        goal_id,
        payload,
    )


@router.post("/{goal_id}/records")
@financial_command(update_snapshot=False)
def create_goal_record(goal_id: int, record: GoalRecordCreate):
    conn = current_command_connection()
    return create_goal_record_use_case(
        conn,
        get_auth_context(conn),
        goal_id,
        record,
    )


@router.delete("/{goal_id}")
@financial_command(update_snapshot=False)
def delete_goal(goal_id: int):
    conn = current_command_connection()
    return delete_goal_use_case(conn, get_auth_context(conn), goal_id)
