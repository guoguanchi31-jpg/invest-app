from fastapi import APIRouter

from application.commands import financial_command
from application.ledger import (
    correct_transaction_application as correct_transaction_application_use_case,
    create_transaction as create_transaction_use_case,
    delete_transaction as delete_transaction_use_case,
    expense_analysis as expense_analysis_query,
    export_ledger as export_ledger_query,
    import_statement_transactions as import_statement_transactions_use_case,
    income_analysis as income_analysis_query,
    ledger_monthly_overview as ledger_monthly_overview_query,
    list_ledger as list_ledger_query,
    list_transactions as list_transactions_query,
    preview_statement_import as preview_statement_import_query,
    query_ledger,
    recent_transactions as recent_transactions_query,
    update_transaction as update_transaction_use_case,
)
from schemas import (
    BusinessDate,
    BusinessMonth,
    StatementImportPayload,
    TransactionApplicationCorrection,
    TransactionCreate,
)
from infrastructure.database import current_command_connection
from tenancy import get_auth_context


router = APIRouter(tags=["transactions"])


@router.get("/transactions/recent")
def recent_transactions(limit: int = 5):
    return recent_transactions_query(limit)


@router.get("/ledger")
def list_ledger(
    month: str | None = None,
    account_id: int | None = None,
    owner: str | None = None,
    direction: str | None = None,
    source: str | None = None,
    category_id: int | None = None,
    date_from: BusinessDate | None = None,
    date_to: BusinessDate | None = None,
    search: str | None = None,
    page: int | None = None,
    page_size: int = 30,
    record_scope: str = "effective",
):
    return list_ledger_query(
        month=month,
        account_id=account_id,
        owner=owner,
        direction=direction,
        source=source,
        category_id=category_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
        page=page,
        page_size=page_size,
        record_scope=record_scope,
    )


@router.get("/ledger/export")
def export_ledger():
    return export_ledger_query()


@router.get("/ledger/monthly-overview")
def ledger_monthly_overview(
    month: BusinessMonth | None = None,
    account_id: int | None = None,
    owner: str | None = None,
):
    return ledger_monthly_overview_query(
        month=month,
        account_id=account_id,
        owner=owner,
    )


@router.post("/transactions/import/preview")
def preview_statement_import(payload: StatementImportPayload):
    return preview_statement_import_query(payload)


@router.post("/transactions/import")
@financial_command
def import_statement_transactions(payload: StatementImportPayload):
    conn = current_command_connection()
    return import_statement_transactions_use_case(
        conn,
        get_auth_context(conn),
        payload,
    )


@router.get("/transactions")
def list_transactions(month: str | None = None, range_key: str = "month"):
    return list_transactions_query(month, range_key)


@router.post("/transactions")
@financial_command
def create_transaction(transaction: TransactionCreate):
    conn = current_command_connection()
    return create_transaction_use_case(
        conn,
        get_auth_context(conn),
        transaction,
    )


@router.patch("/transactions/{transaction_id}")
@financial_command
def update_transaction(transaction_id: int, transaction: TransactionCreate):
    conn = current_command_connection()
    return update_transaction_use_case(
        conn,
        get_auth_context(conn),
        transaction_id,
        transaction,
    )


@router.patch("/transactions/{transaction_id}/application")
@financial_command
def correct_transaction_application(
    transaction_id: int,
    correction: TransactionApplicationCorrection,
):
    conn = current_command_connection()
    return correct_transaction_application_use_case(
        conn,
        get_auth_context(conn),
        transaction_id,
        correction,
    )


@router.delete("/transactions/{transaction_id}")
@financial_command
def delete_transaction(transaction_id: int):
    conn = current_command_connection()
    return delete_transaction_use_case(
        conn,
        get_auth_context(conn),
        transaction_id,
    )


@router.get("/expenses/analysis")
def expense_analysis(
    month: str | None = None,
    expense_range: str = "month",
    cashflow_range: str = "month",
):
    return expense_analysis_query(month, expense_range, cashflow_range)


@router.get("/income/analysis")
def income_analysis(
    month: str | None = None,
    income_range: str = "month",
    trend_range: str = "month",
):
    return income_analysis_query(month, income_range, trend_range)


__all__ = [
    "create_transaction",
    "delete_transaction",
    "expense_analysis",
    "export_ledger",
    "import_statement_transactions",
    "income_analysis",
    "ledger_monthly_overview",
    "list_ledger",
    "list_transactions",
    "preview_statement_import",
    "query_ledger",
    "recent_transactions",
    "router",
    "update_transaction",
]
