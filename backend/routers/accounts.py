from fastapi import APIRouter

from application.accounts import (
    accounts_overview as accounts_overview_query,
    adjust_account_balance as adjust_account_balance_use_case,
    create_account as create_account_use_case,
    delete_account as delete_account_use_case,
    get_account_detail as get_account_detail_query,
    list_accounts as list_accounts_query,
    list_archived_accounts as list_archived_accounts_query,
    reconcile_accounts as reconcile_accounts_query,
    restore_account as restore_account_use_case,
    reverse_transfer as reverse_transfer_use_case,
    transfer_between_accounts as transfer_between_accounts_use_case,
    update_account as update_account_use_case,
)
from application.commands import financial_command
from infrastructure.database import current_command_connection
from schemas import AccountCreate, BalanceAdjustmentCreate, ReversalCreate, TransferCreate
from tenancy import get_auth_context


router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/overview")
def accounts_overview():
    return accounts_overview_query()


@router.get("")
def list_accounts():
    return list_accounts_query()


@router.get("/archived")
def list_archived_accounts():
    return list_archived_accounts_query()


@router.get("/reconciliation")
def reconcile_accounts():
    return reconcile_accounts_query()


@router.post("")
@financial_command
def create_account(account: AccountCreate):
    conn = current_command_connection()
    return create_account_use_case(conn, get_auth_context(conn), account)


@router.get("/{account_id}")
def get_account_detail(account_id: int):
    return get_account_detail_query(account_id)


@router.patch("/{account_id}")
@financial_command
def update_account(account_id: int, account: AccountCreate):
    conn = current_command_connection()
    return update_account_use_case(conn, get_auth_context(conn), account_id, account)


@router.delete("/{account_id}")
@financial_command
def delete_account(account_id: int):
    conn = current_command_connection()
    return delete_account_use_case(conn, get_auth_context(conn), account_id)


@router.post("/{account_id}/restore")
@financial_command
def restore_account(account_id: int):
    conn = current_command_connection()
    return restore_account_use_case(conn, get_auth_context(conn), account_id)


@router.post("/{account_id}/adjustments")
@financial_command
def adjust_account_balance(
    account_id: int,
    adjustment: BalanceAdjustmentCreate,
):
    conn = current_command_connection()
    return adjust_account_balance_use_case(
        conn,
        get_auth_context(conn),
        account_id,
        adjustment,
    )


@router.post("/transfer")
@financial_command
def transfer_between_accounts(transfer: TransferCreate):
    conn = current_command_connection()
    return transfer_between_accounts_use_case(
        conn,
        get_auth_context(conn),
        transfer,
    )


@router.post("/transfers/{reference_id}/reverse")
@financial_command
def reverse_transfer(reference_id: str, payload: ReversalCreate):
    conn = current_command_connection()
    return reverse_transfer_use_case(
        conn,
        get_auth_context(conn),
        reference_id,
        payload,
    )
