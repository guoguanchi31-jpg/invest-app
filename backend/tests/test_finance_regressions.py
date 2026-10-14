import os
import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import database
from routers import auth
from routers.accounts import (
    adjust_account_balance,
    create_account,
    get_account_detail,
    transfer_between_accounts,
    update_account,
)
from routers.budgets import copy_monthly_budget, create_or_update_budget
from routers.goals import (
    create_goal,
    create_goal_record,
    list_goal_records,
    update_goal_status,
)
from routers.investments import create_investment_trade
from routers.transactions import (
    create_transaction,
    delete_transaction,
    import_statement_transactions,
    preview_statement_import,
    query_ledger,
    update_transaction,
)
from routers.warehouse import download_data_backup
from schemas import (
    AccountCreate,
    BusinessMonth,
    BalanceAdjustmentCreate,
    BudgetCategoryAllocation,
    BudgetCopyCreate,
    BudgetCreate,
    GoalCreate,
    GoalMemberAllocation,
    GoalRecordCreate,
    GoalStatusUpdate,
    InvestmentTradeCreate,
    MemberAmountAllocation,
    StatementImportPayload,
    StatementImportRow,
    TransactionCreate,
    TransferCreate,
)
from services import (
    add_months,
    current_month,
    get_accounts_overview,
    get_budget_monthly,
    get_dashboard_summary,
    get_expense_analysis,
    get_goals_overview,
    get_income_analysis,
    get_investment_summary,
    get_ledger_monthly_overview,
    get_snapshot_trend,
    get_warehouse_overview,
)
from tenancy import use_auth_context


class FinanceRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DATABASE_URL = None
        database.DB_DIR = self.temp_dir.name
        database.DB = os.path.join(self.temp_dir.name, "invest.db")
        database.init_db()
        self.auth_context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        self.auth_context_manager = use_auth_context(self.auth_context)
        self.auth_context_manager.__enter__()

    def tearDown(self):
        self.auth_context_manager.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def run_as_current_user(self, operation):
        with use_auth_context(self.auth_context):
            return operation()

    def add_account(
        self,
        name,
        account_type="debit_card",
        balance=0,
        cash_available=0,
        currency="CNY",
        exchange_rate=1,
        is_active=1,
    ):
        conn = database.get_connection()
        cursor = conn.execute(
            """
            INSERT INTO accounts
            (name, type, balance, cash_available, currency, exchange_rate_to_base,
             is_liability, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, '2026-09-01', '2026-09-01')
            """,
            (
                name,
                account_type,
                balance,
                cash_available,
                currency,
                exchange_rate,
                is_active,
            ),
        )
        conn.commit()
        account_id = cursor.lastrowid
        conn.close()
        return account_id

    def get_account(self, account_id):
        conn = database.get_connection()
        row = dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone())
        conn.close()
        return row

    def owner_member_id(self):
        conn = database.get_connection()
        member_id = conn.execute(
            "SELECT id FROM family_members WHERE role = 'owner' ORDER BY id LIMIT 1"
        ).fetchone()["id"]
        conn.close()
        return member_id

    def save_budget(self, month, category_id, amount):
        return create_or_update_budget(BudgetCreate(
            month=month,
            total_amount=amount,
            categories=[
                BudgetCategoryAllocation(
                    category_id=category_id,
                    amount=amount,
                    member_allocations=[
                        MemberAmountAllocation(
                            member_id=self.owner_member_id(),
                            amount=amount,
                        ),
                    ],
                ),
            ],
        ))

    def goal_payload(self, name, target_amount, current_amount=0, monthly_saving=0):
        return GoalCreate(
            name=name,
            target_amount=target_amount,
            monthly_saving=monthly_saving,
            allocations=[
                GoalMemberAllocation(
                    member_id=self.owner_member_id(),
                    target_amount=target_amount,
                    current_amount=current_amount,
                    monthly_saving=monthly_saving,
                ),
            ],
        )

    def test_transfer_to_investment_account_preserves_total_assets(self):
        bank_id = self.add_account("银行", balance=1000)
        investment_id = self.add_account("投资", account_type="investment")

        transfer_between_accounts(TransferCreate(
            from_account_id=bank_id,
            to_account_id=investment_id,
            amount=100,
            occurred_at="2026-09-23",
        ))

        self.assertEqual(self.get_account(bank_id)["balance"], 900)
        self.assertEqual(self.get_account(investment_id)["cash_available"], 100)
        self.assertEqual(get_accounts_overview()["asset_total"], 1000)

    def test_cross_currency_transfer_preserves_base_currency_assets(self):
        cny_id = self.add_account("人民币", balance=1000)
        usd_id = self.add_account("美元", currency="USD", exchange_rate=7)

        result = transfer_between_accounts(TransferCreate(
            from_account_id=cny_id,
            to_account_id=usd_id,
            amount=700,
            to_amount=100,
            occurred_at="2026-09-23",
        ))

        self.assertEqual(result["to_amount"], 100)
        self.assertEqual(self.get_account(usd_id)["balance"], 100)
        self.assertEqual(get_accounts_overview()["asset_total"], 1000)
        conn = database.get_connection()
        transfer_rows = conn.execute(
            """
            SELECT currency, exchange_rate_to_base, base_amount
            FROM transactions
            WHERE source = 'transfer'
            ORDER BY id
            """
        ).fetchall()
        conn.close()
        self.assertEqual(
            [dict(row) for row in transfer_rows],
            [
                {"currency": "CNY", "exchange_rate_to_base": 1.0, "base_amount": 700.0},
                {"currency": "USD", "exchange_rate_to_base": 7.0, "base_amount": 700.0},
            ],
        )

    def test_foreign_currency_holding_is_converted_to_base_currency(self):
        investment_id = self.add_account("投资", account_type="investment")
        account = self.get_account(investment_id)
        conn = database.get_connection()
        conn.execute(
            """
            INSERT INTO holdings
            (family_id, member_id, name, code, buy_price, quantity, current_price,
             account_id, asset_type, market, currency, exchange_rate_to_base, updated_at)
            VALUES (?, ?, 'US Stock', 'TEST', 8, 10, 10, ?, 'stock', 'us', 'USD', 7, '2026-09-23')
            """,
            (account["family_id"], account["member_id"], investment_id),
        )
        conn.commit()
        conn.close()

        overview = get_accounts_overview()
        investment = next(item for item in overview["accounts"] if item["id"] == investment_id)

        self.assertEqual(investment["holdings_value"], 700)
        self.assertEqual(overview["asset_total"], 700)

    def test_transaction_update_and_delete_restore_investment_cash(self):
        investment_id = self.add_account("投资", account_type="investment", cash_available=500)
        created = create_transaction(TransactionCreate(
            account_id=investment_id,
            amount=100,
            direction="expense",
            occurred_at="2026-09-23",
        ))
        self.assertEqual(self.get_account(investment_id)["cash_available"], 400)

        update_transaction(created["id"], TransactionCreate(
            account_id=investment_id,
            amount=40,
            direction="expense",
            occurred_at="2026-09-23",
        ))
        self.assertEqual(self.get_account(investment_id)["cash_available"], 460)

        delete_transaction(created["id"])
        self.assertEqual(self.get_account(investment_id)["cash_available"], 500)

    def test_transaction_move_and_direction_change_restore_both_accounts(self):
        source_id = self.add_account("来源账户", balance=1000)
        target_id = self.add_account("目标账户", balance=500)
        created = create_transaction(TransactionCreate(
            account_id=source_id,
            amount=100,
            direction="expense",
            occurred_at="2026-09-23",
        ))
        self.assertEqual(self.get_account(source_id)["balance"], 900)

        update_transaction(created["id"], TransactionCreate(
            account_id=target_id,
            amount=40,
            direction="income",
            occurred_at="2026-09-23",
        ))
        self.assertEqual(self.get_account(source_id)["balance"], 1000)
        self.assertEqual(self.get_account(target_id)["balance"], 540)

        delete_transaction(created["id"])
        self.assertEqual(self.get_account(source_id)["balance"], 1000)
        self.assertEqual(self.get_account(target_id)["balance"], 500)

    def test_dashboard_returns_seven_most_recent_transactions(self):
        account_id = self.add_account("日常账户", balance=10000)
        for day in range(1, 10):
            create_transaction(TransactionCreate(
                account_id=account_id,
                amount=day,
                direction="expense",
                occurred_at=f"2026-09-{day:02d}",
            ))

        recent = get_dashboard_summary("2026-09")["recent_transactions"]

        self.assertEqual(len(recent), 7)
        self.assertEqual(recent[0]["occurred_at"], "2026-09-09")
        self.assertEqual(recent[-1]["occurred_at"], "2026-09-03")

    def test_transfer_does_not_pollute_income_or_expense_statistics(self):
        source_id = self.add_account("转出账户", balance=1000)
        target_id = self.add_account("转入账户", balance=500)
        transfer_between_accounts(TransferCreate(
            from_account_id=source_id,
            to_account_id=target_id,
            amount=200,
            occurred_at="2026-09-23",
        ))

        dashboard = get_dashboard_summary("2026-09")
        income = get_income_analysis("2026-09")
        expense = get_expense_analysis("2026-09")

        self.assertEqual(dashboard["monthly_income"], 0)
        self.assertEqual(dashboard["monthly_expense"], 0)
        self.assertEqual(income["total_income"], 0)
        self.assertEqual(expense["total_expense"], 0)
        self.assertEqual(get_accounts_overview()["asset_total"], 1500)

    def test_dashboard_analysis_and_budget_share_monthly_totals(self):
        account_id = self.add_account("日常账户", balance=1000)
        conn = database.get_connection()
        expense_category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        income_category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '工资' AND type = 'income'"
        ).fetchone()["id"]
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, source)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', ?, ?, 'manual')
            """,
            [
                (account_id, income_category_id, 1200, 1200, "income", "2026-09-05"),
                (account_id, expense_category_id, 300, 300, "expense", "2026-09-10"),
                (account_id, expense_category_id, 900, 900, "expense", "2026-10-10"),
            ],
        )
        conn.commit()
        conn.close()
        self.save_budget("2026-09", expense_category_id, 500)

        dashboard = get_dashboard_summary("2026-09")
        income = get_income_analysis("2026-09")
        expense = get_expense_analysis("2026-09")
        budget = get_budget_monthly("2026-09")

        self.assertEqual(dashboard["monthly_income"], income["total_income"])
        self.assertEqual(dashboard["monthly_expense"], expense["total_expense"])
        self.assertEqual(dashboard["monthly_expense"], budget["total_used"])
        self.assertEqual(dashboard["budget"]["total"], budget["total_budget"])
        self.assertEqual(dashboard["monthly_income"], 1200)
        self.assertEqual(dashboard["monthly_expense"], 300)

    def test_ledger_monthly_overview_preserves_scope_filters_and_daily_details(self):
        primary_id = self.add_account("日常账户", balance=5000)
        secondary_id = self.add_account("家庭账户", balance=2000)
        conn = database.get_connection()
        dining_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        clothing_id = conn.execute(
            "SELECT id FROM categories WHERE name = '服饰' AND type = 'expense'"
        ).fetchone()["id"]
        salary_id = conn.execute(
            "SELECT id FROM categories WHERE name = '工资' AND type = 'income'"
        ).fetchone()["id"]
        conn.execute("UPDATE accounts SET owner = '小禾' WHERE id = ?", (secondary_id,))
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, source, voided_at)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', ?, ?, ?, ?)
            """,
            [
                (primary_id, salary_id, 1000, 1000, "income", "2026-09-05", "manual", None),
                (primary_id, dining_id, 300, 300, "expense", "2026-09-10", "manual", None),
                (primary_id, clothing_id, 200, 200, "expense", "2026-09-10", "manual", None),
                (primary_id, dining_id, 100, 100, "expense", "2026-09-20", "manual", None),
                (secondary_id, dining_id, 90, 90, "expense", "2026-09-15", "manual", None),
                (primary_id, salary_id, 700, 700, "income", "2026-08-05", "manual", None),
                (primary_id, dining_id, 50, 50, "expense", "2026-08-06", "manual", None),
                (primary_id, None, 999, 999, "expense", "2026-09-12", "transfer", None),
                (primary_id, dining_id, 800, 800, "expense", "2026-09-13", "manual", "2026-09-14"),
            ],
        )
        conn.commit()
        conn.close()

        overview = get_ledger_monthly_overview("2026-09")
        self.assertEqual(overview["summary"]["income"], 1000)
        self.assertEqual(overview["summary"]["expense"], 690)
        self.assertEqual(overview["summary"]["balance"], 310)
        self.assertEqual(overview["summary"]["previous_balance"], 650)
        expense = overview["directions"]["expense"]
        self.assertEqual(expense["count"], 4)
        self.assertEqual(expense["highest_day"]["date"], "2026-09-10")
        self.assertEqual(expense["highest_day"]["amount"], 500)
        self.assertEqual(len(expense["daily"]), 30)
        self.assertEqual(expense["daily"][9]["count"], 2)
        self.assertEqual(expense["categories"][0]["name"], "餐饮")
        self.assertEqual(expense["categories"][0]["amount"], 490)
        self.assertEqual(expense["categories"][0]["count"], 3)

        primary = get_ledger_monthly_overview("2026-09", account_id=primary_id)
        self.assertEqual(primary["summary"]["expense"], 600)
        self.assertEqual(primary["directions"]["expense"]["count"], 3)
        secondary = get_ledger_monthly_overview("2026-09", owner="小禾")
        self.assertEqual(secondary["summary"]["expense"], 90)
        self.assertEqual(secondary["directions"]["expense"]["count"], 1)
        from dataclasses import replace
        foreign_family = replace(self.auth_context, family_id=self.auth_context.family_id + 1000)
        hidden = get_ledger_monthly_overview("2026-09", account_id=primary_id, context=foreign_family)
        self.assertEqual(hidden["summary"]["income"], 0)
        self.assertEqual(hidden["directions"]["expense"]["count"], 0)
        foreign_member = replace(self.auth_context, scope="personal", member_id=999999)
        hidden = get_ledger_monthly_overview("2026-09", context=foreign_member)
        self.assertEqual(hidden["summary"]["expense"], 0)

    def test_monthly_overview_validates_months_and_handles_calendar_boundaries(self):
        from pydantic import TypeAdapter
        validator = TypeAdapter(BusinessMonth)
        for value in ("2026-13", "2026-00", "0000-01", "2026-9", "2026-09-extra", ""):
            with self.subTest(month=value), self.assertRaises(ValidationError):
                validator.validate_python(value)
        for month, days in (("2024-02", 29), ("2026-02", 28), ("9999-12", 31)):
            overview = get_ledger_monthly_overview(month)
            self.assertEqual(len(overview["directions"]["expense"]["daily"]), days)
            self.assertEqual(overview["summary"]["balance"], 0)
        january = get_ledger_monthly_overview("2026-01")
        self.assertEqual(january["previous_month"], "2025-12")

    def test_monthly_overview_sums_persisted_base_amounts_exactly_for_archived_accounts(self):
        from decimal import Decimal
        account_id = self.add_account("外币归档账户", currency="USD", exchange_rate=8)
        conn = database.get_connection()
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, amount, currency, exchange_rate_to_base, base_amount,
             fx_status, direction, occurred_at, source)
            VALUES (?, 1, 'USD', 7, ?, 'captured', 'expense', ?, 'manual')
            """,
            [
                (account_id, 100000000000000.00, "2026-09-01"),
                *[(account_id, 0.01, "2026-09-01") for _ in range(10)],
            ],
        )
        conn.execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (account_id,))
        conn.commit()
        conn.close()
        overview = get_ledger_monthly_overview("2026-09", account_id=account_id)
        expected = Decimal("100000000000000.10")
        self.assertEqual(overview["summary"]["expense"], expected)
        self.assertEqual(overview["summary"]["balance"], -expected)
        direction = overview["directions"]["expense"]
        self.assertEqual(direction["categories"][0]["amount"], expected)
        self.assertEqual(direction["categories"][0]["name"], "未分类")
        self.assertEqual(direction["daily"][0]["amount"], expected)
        self.assertEqual(direction["count"], 11)

    def test_budget_totals_include_categories_without_a_budget_and_uncategorized_expense(self):
        account_id = self.add_account("日常账户", balance=5000)
        conn = database.get_connection()
        dining_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        clothing_id = conn.execute(
            "SELECT id FROM categories WHERE name = '服饰' AND type = 'expense'"
        ).fetchone()["id"]
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, source)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', 'expense', '2026-09-20', 'manual')
            """,
            [
                (account_id, dining_id, 200, 200),
                (account_id, clothing_id, 2000, 2000),
                (account_id, None, 500, 500),
            ],
        )
        conn.commit()
        conn.close()
        self.save_budget("2026-09", dining_id, 1000)

        budget = get_budget_monthly("2026-09")
        dashboard = get_dashboard_summary("2026-09")

        self.assertEqual(budget["budgeted_used"], 200)
        self.assertEqual(budget["unbudgeted_expense"], 2500)
        self.assertEqual(budget["total_used"], 2700)
        self.assertEqual(budget["left"], -1700)
        self.assertEqual(budget["total_used"], dashboard["monthly_expense"])

    def test_foreign_currency_transactions_use_captured_base_amount(self):
        usd_id = self.add_account("美元账户", currency="USD", exchange_rate=7)
        income = create_transaction(TransactionCreate(
            account_id=usd_id,
            category_name="工资",
            amount=100,
            direction="income",
            occurred_at="2026-09-23",
        ))
        create_transaction(TransactionCreate(
            account_id=usd_id,
            category_name="餐饮",
            amount=10,
            direction="expense",
            occurred_at="2026-09-23",
        ))

        conn = database.get_connection()
        stored = conn.execute(
            """
            SELECT amount, currency, exchange_rate_to_base, base_amount
            FROM transactions WHERE id = ?
            """,
            (income["id"],),
        ).fetchone()
        expense_category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.execute(
            "UPDATE accounts SET exchange_rate_to_base = 8 WHERE id = ?",
            (usd_id,),
        )
        conn.commit()
        conn.close()
        self.save_budget("2026-09", expense_category_id, 100)

        self.assertEqual(stored["amount"], 100)
        self.assertEqual(stored["currency"], "USD")
        self.assertEqual(stored["exchange_rate_to_base"], 7)
        self.assertEqual(stored["base_amount"], 700)
        self.assertEqual(get_dashboard_summary("2026-09")["monthly_income"], 700)
        self.assertEqual(get_income_analysis("2026-09")["total_income"], 700)
        self.assertEqual(get_expense_analysis("2026-09")["total_expense"], 70)
        self.assertEqual(get_budget_monthly("2026-09")["total_used"], 70)

    def test_historical_month_does_not_receive_current_asset_value(self):
        historical_month = add_months(current_month(), -1)
        account_id = self.add_account("当前资产", balance=1700)
        conn = database.get_connection()
        conn.execute(
            "UPDATE accounts SET created_at = ? WHERE id = ?",
            (f"{historical_month}-01", account_id),
        )
        conn.execute(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth,
             investment_value, cash_value, created_at)
            VALUES (?, 500, 0, 500, 0, 500, ?)
            """,
            (f"{historical_month}-15", f"{historical_month}-15"),
        )
        conn.commit()
        conn.close()

        trend = get_dashboard_summary(historical_month, "month")["trend"]

        self.assertEqual(trend, [{"date": f"{historical_month}-15", "value": 500.0}])

    def test_account_with_transactions_cannot_change_accounting_type(self):
        account_id = self.add_account("日常账户", balance=1000)
        create_transaction(TransactionCreate(
            account_id=account_id,
            amount=100,
            direction="income",
            occurred_at="2026-09-23",
        ))

        with self.assertRaises(HTTPException) as context:
            update_account(account_id, AccountCreate(
                name="改成投资账户",
                type="investment",
                owner="冠池",
                currency="CNY",
                exchange_rate_to_base=1,
                is_liability=False,
            ))

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(self.get_account(account_id)["type"], "debit_card")
        self.assertEqual(self.get_account(account_id)["balance"], 1100)
        self.assertEqual(self.get_account(account_id)["cash_available"], 0)

    def test_investment_trend_keeps_snapshots_before_latest_quote_refresh(self):
        month = current_month()
        historical_month = add_months(month, -2)
        investment_id = self.add_account("投资", account_type="investment")
        account = self.get_account(investment_id)
        conn = database.get_connection()
        conn.execute(
            """
            INSERT INTO holdings
            (family_id, member_id, name, code, buy_price, quantity, current_price,
             account_id, asset_type, market, currency, exchange_rate_to_base, updated_at)
            VALUES (?, ?, '测试持仓', 'TEST', 10, 10, 12, ?, 'stock', 'us', 'CNY', 1, ?)
            """,
            (account["family_id"], account["member_id"], investment_id, f"{month}-23"),
        )
        conn.executemany(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth,
             investment_value, cash_value, created_at)
            VALUES (?, ?, 0, ?, ?, 0, ?)
            """,
            [
                (f"{historical_month}-15", 80, 80, 80, f"{historical_month}-15"),
                (f"{month}-01", 100, 100, 100, f"{month}-01"),
            ],
        )
        conn.commit()
        conn.close()

        trend = get_investment_summary(month, "12m")["trend"]

        self.assertIn(
            {"date": historical_month, "value": 80.0},
            trend,
        )

    def test_uncategorized_expense_matches_dashboard_total(self):
        account_id = self.add_account("银行", balance=1000)
        conn = database.get_connection()
        category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, source)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', 'expense', '2026-09-23', 'manual')
            """,
            [
                (account_id, category_id, 100, 100),
                (account_id, None, 50, 50),
            ],
        )
        conn.commit()
        conn.close()

        analysis = get_expense_analysis("2026-09")
        dashboard = get_dashboard_summary("2026-09")

        self.assertEqual(analysis["total_expense"], 150)
        self.assertEqual(dashboard["monthly_expense"], 150)
        self.assertEqual(
            next(item["amount"] for item in analysis["categories"] if item["name"] == "未分类"),
            50,
        )

    def test_uncategorized_income_matches_dashboard_total(self):
        account_id = self.add_account("银行")
        conn = database.get_connection()
        conn.execute(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, source)
            VALUES (?, NULL, 80, 'CNY', 1, 80, 'captured', 'income', '2026-09-23', 'manual')
            """,
            (account_id,),
        )
        conn.commit()
        conn.close()

        analysis = get_income_analysis("2026-09")
        dashboard = get_dashboard_summary("2026-09")

        self.assertEqual(analysis["total_income"], 80)
        self.assertEqual(dashboard["monthly_income"], 80)
        self.assertEqual(analysis["categories"][0]["name"], "未分类")

    def test_concurrent_transaction_delete_refunds_balance_once(self):
        account_id = self.add_account("并发账户", balance=1000)
        transaction_id = create_transaction(TransactionCreate(
            account_id=account_id,
            amount=100,
            direction="expense",
            occurred_at="2026-09-23",
        ))["id"]
        start = Barrier(2)

        def delete_once():
            start.wait()
            with use_auth_context(self.auth_context):
                try:
                    delete_transaction(transaction_id)
                    return 200
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(delete_once) for _ in range(2)]
            statuses = sorted(future.result() for future in futures)

        self.assertEqual(statuses, [200, 404])
        self.assertEqual(self.get_account(account_id)["balance"], 1000)

    def test_transaction_note_edit_preserves_captured_exchange_rate(self):
        account_id = self.add_account("美元账户", currency="USD", exchange_rate=7)
        transaction_id = create_transaction(TransactionCreate(
            account_id=account_id,
            amount=100,
            direction="income",
            occurred_at="2026-09-23",
            note="原备注",
        ))["id"]
        conn = database.get_connection()
        conn.execute(
            "UPDATE accounts SET exchange_rate_to_base = 8 WHERE id = ?",
            (account_id,),
        )
        conn.commit()
        conn.close()

        update_transaction(transaction_id, TransactionCreate(
            account_id=account_id,
            amount=100,
            direction="income",
            occurred_at="2026-09-23",
            note="新备注",
        ))

        conn = database.get_connection()
        row = conn.execute(
            """
            SELECT exchange_rate_to_base, base_amount, note
            FROM transactions WHERE id = ?
            """,
            (transaction_id,),
        ).fetchone()
        conn.close()
        self.assertEqual(dict(row), {
            "exchange_rate_to_base": 7.0,
            "base_amount": 700.0,
            "note": "新备注",
        })
        self.assertEqual(get_income_analysis("2026-09")["total_income"], 700)
        self.assertEqual(self.get_account(account_id)["balance"], 100)

    def test_legacy_foreign_transaction_requires_explicit_fx_migration(self):
        os.remove(database.DB)
        conn = sqlite3.connect(database.DB)
        conn.executescript(
            """
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                institution TEXT,
                balance REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'CNY',
                exchange_rate_to_base REAL NOT NULL DEFAULT 1,
                is_liability INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                category_id INTEGER,
                amount REAL NOT NULL,
                direction TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                merchant TEXT,
                note TEXT,
                source TEXT DEFAULT 'manual',
                created_at TEXT,
                updated_at TEXT
            );
            INSERT INTO accounts
                (name, type, balance, currency, exchange_rate_to_base, created_at, updated_at)
            VALUES
                ('旧美元账户', 'debit_card', 100, 'USD', 8, '2026-01-01', '2026-09-23');
            INSERT INTO transactions
                (account_id, amount, direction, occurred_at, source, created_at, updated_at)
            VALUES
                (1, 100, 'income', '2026-01-10', 'manual', '2026-01-10', '2026-01-10');
            """
        )
        conn.commit()
        conn.close()

        with self.assertRaises(database.UnresolvedTransactionFxError):
            database.init_db()

        conn = database.get_connection()
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(transactions)").fetchall()
        }
        conn.close()
        self.assertNotIn("currency", columns)

        database.init_db(allow_unresolved=True)
        conn = database.get_connection()
        row = conn.execute(
            """
            SELECT currency, exchange_rate_to_base, base_amount, fx_status
            FROM transactions WHERE id = 1
            """
        ).fetchone()
        self.assertEqual(row["currency"], "USD")
        self.assertIsNone(row["exchange_rate_to_base"])
        self.assertIsNone(row["base_amount"])
        self.assertEqual(row["fx_status"], "unresolved")
        database.resolve_transaction_fx(conn, {1: 7})
        conn.commit()
        conn.close()

        database.init_db()
        self.assertEqual(get_income_analysis("2026-01")["total_income"], 700)

    def test_monthly_snapshot_trend_uses_last_value_and_keeps_negative(self):
        first_month = add_months(current_month(), -2)
        second_month = add_months(current_month(), -1)
        conn = database.get_connection()
        conn.executemany(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth,
             investment_value, cash_value, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """,
            [
                (f"{first_month}-01", 1000, 0, 1000, 1000, f"{first_month}-01"),
                (f"{first_month}-28", 500, 0, 500, 500, f"{first_month}-28"),
                (f"{second_month}-28", 0, 100, -100, 0, f"{second_month}-28"),
            ],
        )
        conn.commit()
        conn.close()

        trend = get_snapshot_trend("net_worth", current_month(), "12m")

        self.assertIn({"date": first_month, "value": 500.0}, trend)
        self.assertIn({"date": second_month, "value": -100.0}, trend)
        self.assertNotIn({"date": first_month, "value": 1000.0}, trend)

    def test_budget_plan_rejects_duplicate_categories_and_unbalanced_totals(self):
        conn = database.get_connection()
        dining_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.close()
        member_id = self.owner_member_id()

        with self.assertRaises(ValidationError):
            BudgetCreate(
                month="2026-09",
                total_amount=1000,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=dining_id,
                        amount=500,
                        member_allocations=[
                            MemberAmountAllocation(member_id=member_id, amount=500),
                        ],
                    ),
                    BudgetCategoryAllocation(
                        category_id=dining_id,
                        amount=500,
                        member_allocations=[
                            MemberAmountAllocation(member_id=member_id, amount=500),
                        ],
                    ),
                ],
            )
        with self.assertRaises(ValidationError):
            BudgetCreate(
                month="2026-09",
                total_amount=1000,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=dining_id,
                        amount=1000,
                        member_allocations=[
                            MemberAmountAllocation(member_id=member_id, amount=999.99),
                        ],
                    ),
                ],
            )
        with self.assertRaises(ValidationError):
            BudgetCreate(
                month="2026-09",
                total_amount=1000,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=dining_id,
                        amount=900,
                        member_allocations=[
                            MemberAmountAllocation(member_id=member_id, amount=900),
                        ],
                    ),
                ],
            )

    def test_goal_due_date_requires_a_real_iso_calendar_date(self):
        payload = self.goal_payload("装修", 1000).model_dump()
        with self.assertRaises(ValidationError):
            GoalCreate(**{**payload, "due_date": "2026-02-30"})
        with self.assertRaises(ValidationError):
            GoalCreate(**{**payload, "due_date": "20260930"})
        valid = GoalCreate(**{**payload, "due_date": " 2026-12-31 "})
        self.assertEqual(valid.due_date, "2026-12-31")

    def test_analysis_queries_avoid_postgres_incompatible_grouping_and_having(self):
        class PostgresSyntaxGuard:
            def __init__(self, conn):
                self.conn = conn

            def execute(self, query, params=()):
                normalized = " ".join(query.split()).upper()
                if "GROUP BY CASE" in normalized:
                    raise AssertionError("PostgreSQL requires grouping by the output column")
                if "HAVING AMOUNT" in normalized:
                    raise AssertionError("PostgreSQL does not allow SELECT aliases in HAVING")
                return self.conn.execute(query, params)

            def __getattr__(self, name):
                return getattr(self.conn, name)

        open_connection = database.get_connection
        with patch(
            "infrastructure.database.get_connection",
            side_effect=lambda: PostgresSyntaxGuard(open_connection()),
        ):
            get_expense_analysis("2026-09")
            get_income_analysis("2026-09")
            get_warehouse_overview()

    def test_transfer_rejects_same_inactive_and_invalid_inputs(self):
        active_id = self.add_account("启用")
        inactive_id = self.add_account("停用", is_active=0)

        with self.assertRaises(HTTPException) as same_context:
            transfer_between_accounts(TransferCreate(
                from_account_id=active_id,
                to_account_id=active_id,
                amount=1,
                occurred_at="2026-09-23",
            ))
        self.assertEqual(same_context.exception.status_code, 409)

        with self.assertRaises(HTTPException) as inactive_context:
            transfer_between_accounts(TransferCreate(
                from_account_id=active_id,
                to_account_id=inactive_id,
                amount=1,
                occurred_at="2026-09-23",
            ))
        self.assertEqual(inactive_context.exception.status_code, 409)

        with self.assertRaises(ValidationError):
            TransferCreate(
                from_account_id=active_id,
                to_account_id=inactive_id,
                amount=0,
                occurred_at="not-a-date",
            )

    def test_financial_date_inputs_require_canonical_iso_format(self):
        invalid = "20260901"
        cases = (
            lambda: AccountCreate(
                name="紧凑日期账户", type="debit_card", opening_date=invalid,
            ),
            lambda: TransactionCreate(
                account_id=1, amount=1, direction="expense",
                occurred_at=invalid,
            ),
            lambda: TransferCreate(
                from_account_id=1, to_account_id=2, amount=1,
                occurred_at=invalid,
            ),
            lambda: GoalRecordCreate(amount=1, recorded_at=invalid),
        )
        for build in cases:
            with self.subTest(build=build), self.assertRaises(ValidationError):
                build()
        normalized = TransactionCreate(
            account_id=1,
            amount=1,
            direction="expense",
            occurred_at=" 2026-09-01 ",
        )
        self.assertEqual(normalized.occurred_at, "2026-09-01")

    def test_opening_balance_is_auditable_without_polluting_income(self):
        created = create_account(AccountCreate(
            name="期初存款",
            type="debit_card",
            owner="大宝",
            balance=50000,
            opening_date="2026-09-01",
        ))

        account = self.get_account(created["id"])
        self.assertEqual(account["balance"], 50000)
        self.assertEqual(account["opened_at"], "2026-09-01")
        self.assertEqual(get_dashboard_summary("2026-09")["monthly_income"], 0)
        ledger = query_ledger(account_id=created["id"])
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["source"], "opening")
        self.assertEqual(ledger[0]["base_amount"], 50000)

    def test_balance_adjustment_changes_balance_without_changing_cashflow(self):
        account_id = self.add_account("核对账户", balance=1000)
        result = adjust_account_balance(account_id, BalanceAdjustmentCreate(
            actual_balance=920,
            occurred_at="2026-09-23",
            reason="银行对账差异",
        ))

        self.assertEqual(result["difference"], -80)
        self.assertEqual(self.get_account(account_id)["balance"], 920)
        self.assertEqual(get_dashboard_summary("2026-09")["monthly_expense"], 0)
        detail = get_account_detail(account_id)
        self.assertEqual(detail["transactions"][0]["source"], "adjustment")
        self.assertEqual(detail["transactions"][0]["note"], "银行对账差异")

    def test_unified_ledger_collapses_new_transfer_pair(self):
        source_id = self.add_account("转出", balance=1000)
        target_id = self.add_account("转入", balance=200)
        result = transfer_between_accounts(TransferCreate(
            from_account_id=source_id,
            to_account_id=target_id,
            amount=250,
            occurred_at="2026-09-23",
            note="归集资金",
        ))

        ledger = query_ledger(source="transfer")
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["reference_id"], result["reference_id"])
        self.assertEqual(ledger[0]["from_account_name"], "转出")
        self.assertEqual(ledger[0]["to_account_name"], "转入")
        self.assertEqual(len(ledger[0]["legs"]), 2)

    def test_budget_copy_and_batch_update(self):
        conn = database.get_connection()
        dining_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.close()
        self.save_budget("2026-08", dining_id, 1000)

        copied = copy_monthly_budget(BudgetCopyCreate(
            source_month="2026-08",
            target_month="2026-09",
        ))
        self.assertEqual(copied["copied"], 1)
        self.save_budget("2026-09", dining_id, 1250)
        self.assertEqual(get_budget_monthly("2026-09")["total_budget"], 1250)

    def test_goal_deposit_withdraw_and_archive_workflow(self):
        goal_id = create_goal(self.goal_payload(
            "旅行", 10000, current_amount=1000, monthly_saving=500,
        ))["id"]
        create_goal_record(goal_id, GoalRecordCreate(
            amount=500,
            recorded_at="2026-09-20",
            note="本月存入",
        ))
        create_goal_record(goal_id, GoalRecordCreate(
            amount=-200,
            recorded_at="2026-09-21",
            note="临时取出",
        ))

        records = list_goal_records(goal_id)
        self.assertEqual([item["amount"] for item in records], [-200, 500])
        conn = database.get_connection()
        amount = conn.execute(
            "SELECT current_amount FROM goals WHERE id = ?",
            (goal_id,),
        ).fetchone()["current_amount"]
        conn.close()
        self.assertEqual(amount, 1300)
        update_goal_status(goal_id, GoalStatusUpdate(status="archived"))
        with self.assertRaises(HTTPException):
            create_goal_record(goal_id, GoalRecordCreate(
                amount=100,
                recorded_at="2026-09-22",
            ))

    def test_goal_history_ignores_later_records_and_plan_is_independent(self):
        goal_id = create_goal(self.goal_payload(
            "历史目标", 100000, monthly_saving=5000,
        ))["id"]
        conn = database.get_connection()
        conn.execute(
            "UPDATE goals SET created_at = '2026-08-01T00:00:00' WHERE id = ?",
            (goal_id,),
        )
        conn.commit()
        conn.close()
        create_goal_record(goal_id, GoalRecordCreate(
            amount=10000,
            recorded_at="2026-08-20",
        ))
        august_before = get_goals_overview("2026-08", "6m")
        create_goal_record(goal_id, GoalRecordCreate(
            amount=20000,
            recorded_at="2026-09-20",
        ))
        august_after = get_goals_overview("2026-08", "6m")
        september = get_goals_overview("2026-09", "6m")

        self.assertEqual(august_before["current_total"], 10000)
        self.assertEqual(august_after["current_total"], 10000)
        self.assertEqual(august_after["goals"][0]["current_amount"], 10000)
        self.assertEqual(september["current_total"], 30000)
        august_point = next(item for item in september["plan"] if item["month"] == "2026-08")
        september_point = next(item for item in september["plan"] if item["month"] == "2026-09")
        self.assertEqual((august_point["actual"], september_point["actual"]), (1.0, 3.0))
        self.assertEqual((august_point["plan"], september_point["plan"]), (0.5, 1.0))
        self.assertNotEqual(september_point["plan"], september_point["actual"])

    def test_investment_trade_updates_holding_and_cash_atomically(self):
        account_id = self.add_account(
            "投资账户",
            account_type="investment",
            cash_available=2000,
        )
        account = self.get_account(account_id)
        conn = database.get_connection()
        holding_id = conn.execute(
            """
            INSERT INTO holdings
            (family_id, member_id, name, code, buy_price, quantity, current_price,
             account_id, asset_type, market, currency, exchange_rate_to_base, updated_at)
            VALUES (?, ?, '测试股票', 'TEST', 10, 100, 10, ?, 'stock', 'cn', 'CNY', 1, '2026-09-01')
            """,
            (account["family_id"], account["member_id"], account_id),
        ).lastrowid
        conn.commit()
        conn.close()

        create_investment_trade(InvestmentTradeCreate(
            holding_id=holding_id,
            trade_type="buy",
            quantity=50,
            price=12,
            fee=6,
            occurred_at="2026-09-20",
        ))
        self.assertEqual(self.get_account(account_id)["cash_available"], 1394)
        conn = database.get_connection()
        holding = conn.execute(
            "SELECT quantity, buy_price FROM holdings WHERE id = ?",
            (holding_id,),
        ).fetchone()
        conn.close()
        self.assertEqual(holding["quantity"], 150)
        self.assertAlmostEqual(holding["buy_price"], (1000 + 606) / 150)

        create_investment_trade(InvestmentTradeCreate(
            holding_id=holding_id,
            trade_type="sell",
            quantity=20,
            price=15,
            fee=3,
            occurred_at="2026-09-21",
        ))
        self.assertEqual(self.get_account(account_id)["cash_available"], 1691)
        with self.assertRaises(HTTPException):
            create_investment_trade(InvestmentTradeCreate(
                holding_id=holding_id,
                trade_type="sell",
                quantity=1000,
                price=15,
                occurred_at="2026-09-22",
            ))
        self.assertEqual(self.get_account(account_id)["cash_available"], 1691)

    def test_backup_contains_all_financial_tables(self):
        response = download_data_backup()
        payload = response.body.decode("utf-8")
        for table in ("accounts", "transactions", "investment_trades", "goal_records"):
            self.assertIn(f'"{table}"', payload)

    def test_statement_import_previews_and_skips_duplicates(self):
        account_id = self.add_account("账单账户", balance=1000)
        row = StatementImportRow(
            account_id=account_id,
            amount=88,
            direction="expense",
            occurred_at="2026-09-20",
            category_name="餐饮",
            merchant="测试餐厅",
            note="账单导入",
        )
        payload = StatementImportPayload(rows=[row])

        preview = preview_statement_import(payload)
        self.assertEqual(preview["ready"], 1)
        imported = import_statement_transactions(payload)
        self.assertEqual(imported["imported"], 1)
        self.assertEqual(self.get_account(account_id)["balance"], 912)

        duplicate_preview = preview_statement_import(payload)
        self.assertEqual(duplicate_preview["duplicates"], 1)
        duplicate_import = import_statement_transactions(payload)
        self.assertEqual(duplicate_import["skipped"], 1)
        self.assertEqual(self.get_account(account_id)["balance"], 912)


if __name__ == "__main__":
    unittest.main()
