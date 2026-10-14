from fastapi import APIRouter

from application.budgets import (
    copy_monthly_budget as copy_monthly_budget_use_case,
    create_or_update_budget as create_or_update_budget_use_case,
    delete_monthly_budget as delete_monthly_budget_use_case,
    monthly_budget as monthly_budget_query,
)
from application.commands import financial_command
from infrastructure.database import current_command_connection
from schemas import BudgetCopyCreate, BudgetCreate
from tenancy import get_auth_context


router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("/monthly")
def monthly_budget(month: str | None = None):
    return monthly_budget_query(month)


@router.post("")
@financial_command(update_snapshot=False)
def create_or_update_budget(budget: BudgetCreate):
    conn = current_command_connection()
    return create_or_update_budget_use_case(
        conn,
        get_auth_context(conn),
        budget,
    )


@router.post("/copy")
@financial_command(update_snapshot=False)
def copy_monthly_budget(payload: BudgetCopyCreate):
    conn = current_command_connection()
    return copy_monthly_budget_use_case(
        conn,
        get_auth_context(conn),
        payload,
    )


@router.delete("/monthly/{month}")
@financial_command(update_snapshot=False)
def delete_monthly_budget(month: str):
    conn = current_command_connection()
    return delete_monthly_budget_use_case(
        conn,
        get_auth_context(conn),
        month,
    )
