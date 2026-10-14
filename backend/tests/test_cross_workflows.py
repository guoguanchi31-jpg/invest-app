"""Run identical accounting workflows on SQLite and an optional real PostgreSQL.

INVEST_TEST_POSTGRES_URL must point at a test cluster whose user can create DBs.
Each test creates and drops its own database; no existing database is modified.
"""
import asyncio
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal
from datetime import datetime
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from pydantic import ValidationError

import database
import queries.finance as finance_queries
from queries.commands import get_command_status
import infrastructure.read_models as read_models
from application.ledger import query_ledger
from application.warehouse import get_warehouse_overview
from domain.calendar import business_today
from backup import fingerprint, prepare_family_restore, restore, snapshot
from routers import accounts, auth, transactions
from routers.budgets import create_or_update_budget
from routers.categories import create_category
from routers.family import create_family_member
from routers.goals import create_goal, create_goal_record
from routers.investments import add_holding, create_investment_trade
from schemas import (
    AccountCreate, BudgetCategoryAllocation,
    BudgetCreate, CategoryCreate, FamilyMemberCreate, GoalCreate,
    GoalMemberAllocation, GoalRecordCreate, HoldingCreate,
    InvestmentTradeCreate, MemberAmountAllocation, ReversalCreate,
    TransactionCreate, TransferCreate,
)
from application.snapshots import refresh_warehouse_snapshot
from services import get_accounts_overview, get_investment_summary, get_goals_overview
from tenancy import use_auth_context
from tests.restore_cases import RestoreWorkflows
from tests.concurrency_cases import ConcurrentCashWorkflows
from tests.history_cases import HistoryWorkflows
from tests.upgrade_cases import UpgradeWorkflows
from tests.clock import freeze_business_time


class AccountingWorkflows:
    def test_command_status_reveals_only_a_scoped_terminal_receipt(self):
        accounts.create_account(AccountCreate(
            name="命令状态账户", type="debit_card", balance=0,
            opening_date="2026-09-01",
        ), idempotency_key="scoped-command-status")
        self.assertEqual(
            get_command_status("scoped-command-status"),
            {
                "status": "committed",
                "protocol_version": 2,
                "scope_known": True,
            },
        )
        self.assertEqual(
            get_command_status("missing-command"),
            {
                "status": "unknown",
                "protocol_version": None,
                "scope_known": False,
            },
        )
        with use_auth_context(self.auth_context.with_scope("personal")):
            self.assertEqual(
                get_command_status("scoped-command-status"),
                {
                    "status": "unknown",
                    "protocol_version": None,
                    "scope_known": False,
                },
            )
        with database.write_connection() as conn:
            conn.execute(
                "UPDATE financial_commands "
                "SET fingerprint_version = 1, data_scope = NULL "
                "WHERE command_key = 'scoped-command-status'"
            )
        with use_auth_context(self.auth_context.with_scope("personal")):
            self.assertEqual(
                get_command_status("scoped-command-status"),
                {
                    "status": "committed",
                    "protocol_version": 1,
                    "scope_known": False,
                },
            )
        with use_auth_context(self.other_family()):
            self.assertEqual(
                get_command_status("scoped-command-status"),
                {
                    "status": "unknown",
                    "protocol_version": None,
                    "scope_known": False,
                },
            )

    def test_goal_creation_across_month_boundary_uses_business_clock(self):
        ids = []
        for instant in ("2026-09-30T15:59:59+00:00", "2026-09-30T16:00:00+00:00"):
            with freeze_business_time(instant), patch.dict(os.environ, {"BUSINESS_TIMEZONE": "Asia/Shanghai"}):
                ids.append(create_goal(GoalCreate(
                    name=f"跨月目标-{instant}", target_amount=100,
                    allocations=[GoalMemberAllocation(member_id=self.auth_context.member_id, target_amount=100)],
                ))["id"])
        self.assertEqual(
            {goal["id"] for goal in get_goals_overview("2026-09")["goals"]}, {ids[0]},
        )
        self.assertEqual(
            {goal["id"] for goal in get_goals_overview("2026-10")["goals"]}, set(ids),
        )

    def test_midnight_account_opening_and_expense_share_business_day(self):
        with patch.dict(os.environ, {"BUSINESS_TIMEZONE": "Asia/Shanghai"}):
            with patch("domain.calendar.datetime") as clock:
                clock.now.return_value = datetime.fromisoformat("2026-09-30T16:00:00+00:00")
                account_id = accounts.create_account(AccountCreate(
                    name="凌晨建账", type="debit_card", balance=100,
                ))["id"]
                transactions.create_transaction(TransactionCreate(
                    account_id=account_id, amount=10, direction="expense",
                    occurred_at=business_today().isoformat(),
                ))
        account = self.row("SELECT * FROM accounts WHERE id = ?", (account_id,))
        self.assertEqual(account["opened_at"], "2026-10-01")
        self.assertEqual(account["balance"], 90)
        self.assertEqual(account["created_at"][:10], "2026-10-01")
        report = accounts.reconcile_accounts()
        self.assertEqual(report["difference_count"], 0)

    def prepare_concurrent_read(self):
        if database.DATABASE_URL is None:
            conn = database.get_connection()
            try:
                conn.execute("PRAGMA journal_mode=WAL")
            finally:
                conn.close()

    def buy_during_read(self, account_id):
        return create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account_id, name="读取期间买入", code=uuid4().hex,
                buy_price=100, current_price=100, quantity=1,
            ),
            trade_type="buy", quantity=1, price=100, occurred_at="2026-09-28",
        ))

    def test_summary_keeps_one_snapshot_across_holdings_and_cash(self):
        self.prepare_concurrent_read()
        account_id = self.account("一致性投资", account_type="investment", balance=1000)
        original = finance_queries.get_holdings
        interleaved = False

        def read_then_buy(*args, **kwargs):
            nonlocal interleaved
            result = original(*args, **kwargs)
            if not interleaved:
                interleaved = True
                self.buy_during_read(account_id)
            return result

        with patch.object(finance_queries, "get_holdings", side_effect=read_then_buy):
            result = get_investment_summary()
        self.assertTrue(interleaved)
        self.assertEqual(result["total_value"], 0)
        self.assertEqual(result["cash_available"], 1000)
        latest = get_investment_summary()
        self.assertEqual(latest["total_value"], 100)
        self.assertEqual(latest["cash_available"], 900)

    def test_account_overview_keeps_cash_and_holdings_from_same_snapshot(self):
        self.prepare_concurrent_read()
        account_id = self.account("账户一致性", account_type="investment", balance=1000)
        original = finance_queries.get_investment_values_by_account
        interleaved = False

        def buy_then_read(*args, **kwargs):
            nonlocal interleaved
            if not interleaved:
                interleaved = True
                self.buy_during_read(account_id)
            return original(*args, **kwargs)

        with patch.object(finance_queries, "get_investment_values_by_account", side_effect=buy_then_read):
            result = get_accounts_overview()
        self.assertEqual(result["asset_total"], 1000)
        self.assertEqual(result["accounts"][0]["holdings_value"], 0)
        self.assertEqual(get_accounts_overview()["accounts"][0]["holdings_value"], 100)

    def test_paginated_ledger_total_and_rows_share_snapshot(self):
        self.prepare_concurrent_read()
        account_id = self.account("分页一致性", balance=100)
        transactions.create_transaction(self.transaction(account_id))
        original = database.consistent_read_connection
        interleaved = False

        class InterleavedConnection:
            def execute(inner, sql, params=()):
                nonlocal interleaved
                if "selected AS" in sql and not interleaved:
                    interleaved = True
                    transactions.create_transaction(self.transaction(account_id))
                return inner.connection.execute(sql, params)

        @contextmanager
        def read_transaction():
            with original() as connection:
                wrapper = InterleavedConnection()
                wrapper.connection = connection
                yield wrapper

        with patch.object(read_models, "consistent_read_connection", read_transaction):
            page = query_ledger(source="manual", page=1)
        self.assertTrue(interleaved)
        self.assertEqual(page["total"], 1)
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(page["summary"]["expense"], 5)
        self.assertEqual(query_ledger(source="manual", page=1)["total"], 2)

    def test_warehouse_get_is_read_only_and_uses_current_valuation(self):
        self.account("仓库只读", balance=100)
        before = self.row("SELECT COUNT(*) AS count FROM snapshots")["count"]
        overview = get_warehouse_overview()
        self.assertEqual(overview["snapshot"]["net_worth"], 100)
        self.assertEqual(
            self.row("SELECT COUNT(*) AS count FROM snapshots")["count"], before,
        )

    def test_reconciliation_does_not_report_a_difference_during_a_write(self):
        self.prepare_concurrent_read()
        account_id = self.account("并发核对", balance=100)
        original = database.consistent_read_connection
        interleaved = False

        class InterleavedConnection:
            def execute(inner, sql, params=()):
                nonlocal interleaved
                if (
                    "FROM transactions" in sql
                    and "balance_applied" in sql
                    and not interleaved
                ):
                    interleaved = True
                    transactions.create_transaction(self.transaction(account_id, amount=10))
                return inner.connection.execute(sql, params)

        @contextmanager
        def read_transaction():
            with original() as connection:
                wrapper = InterleavedConnection()
                wrapper.connection = connection
                yield wrapper

        with patch.object(read_models, "consistent_read_connection", read_transaction):
            report = accounts.reconcile_accounts()
        self.assertTrue(interleaved)
        self.assertEqual(report["difference_count"], 0)
        self.assertEqual(report["items"][0]["actual"], 100)
        self.assertEqual(accounts.reconcile_accounts()["items"][0]["actual"], 90)

    def row(self, sql, params=()):
        conn = database.get_connection()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def account(self, name, account_type="debit_card", balance=0):
        return accounts.create_account(AccountCreate(
            name=name, type=account_type, balance=balance, opening_date="2026-09-01",
        ))["id"]

    def transaction(self, account_id, amount=5, direction="expense"):
        return TransactionCreate(
            account_id=account_id, amount=amount, direction=direction, occurred_at="2026-09-28",
        )

    def test_exact_decimal_cash_can_be_fully_invested(self):
        account_id = self.account("精确现金", account_type="investment", balance=0.7)
        result = create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account_id,
                name="小数标的",
                code="DECIMAL",
                buy_price="0.07",
                current_price="0.07",
                quantity="10",
            ),
            trade_type="buy",
            quantity="10",
            price="0.07",
            occurred_at="2026-09-28",
        ))
        self.assertGreater(result["id"], 0)
        self.assertEqual(
            self.row("SELECT cash_available FROM accounts WHERE id = ?", (account_id,))["cash_available"],
            0,
        )

    def test_investment_opening_and_database_constraint_share_nonnegative_rule(self):
        with self.assertRaises(ValidationError):
            AccountCreate(
                name="非法投资账户",
                type="investment",
                balance="-100",
            )
        account_id = self.account("数据库约束账户", account_type="investment")
        conn = database.get_connection()
        try:
            with self.assertRaises(Exception):
                conn.execute(
                    "UPDATE accounts SET cash_available = -1 WHERE id = ?",
                    (account_id,),
                )
                conn.commit()
            conn.rollback()
        finally:
            conn.close()
        self.assertEqual(
            self.row(
                "SELECT cash_available FROM accounts WHERE id = ?",
                (account_id,),
            )["cash_available"],
            0,
        )
        self.assertGreater(self.account("普通账户可透支", balance=-10), 0)
        self.assertGreater(
            self.account("负债账户可为贷方", account_type="credit_card", balance=-10),
            0,
        )

    def test_half_cent_valuation_matches_account_summary_and_snapshot(self):
        account_id = self.account("半分估值", account_type="investment")
        for code in ("HALF-A", "HALF-B"):
            add_holding(HoldingCreate(
                account_id=account_id,
                name=code,
                code=code,
                buy_price="0",
                current_price="0.006",
                quantity="1",
            ))
        account = next(
            row for row in get_accounts_overview()["accounts"]
            if row["id"] == account_id
        )
        investment = get_investment_summary()
        saved = refresh_warehouse_snapshot(context=self.auth_context)
        expected = Decimal("0.02")
        self.assertEqual(account["holdings_value"], expected)
        self.assertEqual(investment["total_value"], expected)
        self.assertEqual(saved["investment_value"], expected)

    def test_invested_income_cannot_be_reduced_or_deleted(self):
        account_id = self.account("投资现金约束", account_type="investment")
        income_id = transactions.create_transaction(TransactionCreate(
            account_id=account_id,
            amount=1000,
            direction="income",
            occurred_at="2026-09-28",
        ))["id"]
        create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account_id,
                name="现金约束标的",
                code="PG-CASH-GUARD",
                buy_price=100,
                current_price=100,
                quantity=8,
            ),
            trade_type="buy",
            quantity=8,
            price=100,
            occurred_at="2026-09-28",
        ))

        operations = (
            lambda: transactions.update_transaction(
                income_id,
                TransactionCreate(
                    account_id=account_id,
                    amount=500,
                    direction="income",
                    occurred_at="2026-09-28",
                ),
            ),
            lambda: transactions.delete_transaction(income_id),
        )
        for operation in operations:
            with self.assertRaises(HTTPException) as rejected:
                operation()
            self.assertEqual(rejected.exception.status_code, 409)

        account = self.row(
            "SELECT cash_available FROM accounts WHERE id = ?",
            (account_id,),
        )
        transaction = self.row(
            "SELECT amount FROM transactions WHERE id = ?",
            (income_id,),
        )
        self.assertEqual(account["cash_available"], 200)
        self.assertEqual(transaction["amount"], 1000)

    def test_authenticated_idempotent_write_replay_and_concurrent_retry(self):
        app = FastAPI()
        for router in (accounts.router, transactions.router):
            app.include_router(router, dependencies=[Depends(auth.require_auth)])
        token = auth.create_access_token_for_username("admin")

        async def request(path, payload, key):
            body = json.dumps(payload).encode()
            messages = []
            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}
            async def send(message):
                messages.append(message)
            await app({
                "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                "method": "POST", "path": path, "raw_path": path.encode(), "query_string": b"",
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"authorization", f"Bearer {token}".encode()),
                    (b"idempotency-key", key.encode()),
                ],
                "scheme": "http", "server": ("test", 80), "client": ("test", 1),
            }, receive, send)
            status = next(item["status"] for item in messages if item["type"] == "http.response.start")
            data = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
            return status, json.loads(data)

        rejected_date = asyncio.run(request("/accounts", {
            "name": "紧凑日期HTTP账户",
            "type": "debit_card",
            "opening_date": "20260901",
        }, "compact-account-date"))
        self.assertEqual(rejected_date[0], 422)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM accounts")["n"], 0)

        status, account = asyncio.run(request("/accounts", {
            "name": "HTTP账户", "type": "debit_card", "opening_date": "2026-09-01",
        }, "account-key"))
        self.assertEqual(status, 200)
        payload = self.transaction(account["id"], 100, "income").model_dump(mode="json")
        self.assertEqual(asyncio.run(request(
            "/transactions",
            {**payload, "occurred_at": "20260928"},
            "compact-transaction-date",
        ))[0], 422)
        first = asyncio.run(request("/transactions", payload, "income-key"))
        replay = asyncio.run(request("/transactions", payload, "income-key"))
        self.assertEqual(first[0], 200)
        self.assertEqual(first, replay)
        self.assertEqual(asyncio.run(request("/transactions", {**payload, "amount": 101}, "income-key"))[0], 409)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(
                lambda _: asyncio.run(request("/transactions", {**payload, "amount": 7}, "concurrent-key")),
                range(2),
            ))
        self.assertEqual(results[0][0], 200)
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account["id"],))["balance"], 107)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM transactions")["n"], 2)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = 'transaction'")["n"], 2)

    def test_archived_account_requires_restore_before_history_correction(self):
        account_a, account_b = self.account("A"), self.account("B")
        income = transactions.create_transaction(self.transaction(account_a, 100, "income"))["id"]
        accounts.transfer_between_accounts(TransferCreate(
            from_account_id=account_a, to_account_id=account_b, amount=100, occurred_at="2026-09-28",
        ))
        accounts.delete_account(account_a)
        for operation in (
            lambda: transactions.delete_transaction(income, idempotency_key="archive-delete"),
            lambda: transactions.update_transaction(income, self.transaction(account_a, 90, "income")),
        ):
            with self.assertRaises(HTTPException) as rejected:
                operation()
            self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.row("SELECT balance, is_active FROM accounts WHERE id = ?", (account_a,)),
                         {"balance": 0, "is_active": 0})
        self.assertIsNotNone(self.row("SELECT id FROM transactions WHERE id = ?", (income,)))
        self.assertIsNone(self.row("SELECT command_key FROM financial_commands WHERE command_key = 'archive-delete'"))
        self.assertEqual(get_accounts_overview()["asset_total"], 100)
        self.assertEqual(self.row("SELECT SUM(balance) AS total FROM accounts")["total"], 100)
        archived = accounts.list_archived_accounts()
        self.assertEqual([item["id"] for item in archived], [account_a])
        detail = accounts.get_account_detail(account_a)
        self.assertEqual(detail["account"]["is_active"], 0)
        self.assertTrue(detail["account"]["can_restore"])
        accounts.restore_account(account_a)
        transactions.delete_transaction(income)
        self.assertEqual(
            self.row("SELECT balance, is_active FROM accounts WHERE id = ?", (account_a,)),
            {"balance": -100, "is_active": 1},
        )
        self.assertEqual(get_accounts_overview()["asset_total"], 0)
        self.assertEqual(self.row("SELECT SUM(balance) AS total FROM accounts")["total"], 0)

    def test_new_audit_does_not_use_related_ids_and_moves_keep_both_accounts(self):
        account_a, account_b = self.account("A"), self.account("B")
        transactions.create_transaction(self.transaction(account_a))
        collision = transactions.create_transaction(self.transaction(account_a))["id"]
        self.assertEqual(collision, account_b)
        transaction_id = transactions.create_transaction(self.transaction(account_b, 7))["id"]
        event = self.row(
            "SELECT * FROM audit_events WHERE entity_type = 'transaction' AND entity_id = ?",
            (str(transaction_id),),
        )
        self.assertIsNone(event["before_value"])
        self.assertEqual(Decimal(str(json.loads(event["after_value"])["amount"])), 7)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_event_accounts WHERE audit_event_id = ?", (event["id"],))["n"], 1)
        self.assertEqual(self.row("SELECT account_id FROM audit_event_accounts WHERE audit_event_id = ?", (event["id"],))["account_id"], account_b)
        self.assertNotIn(event["id"], [item["id"] for item in accounts.get_account_detail(account_a)["activity"]])

        transactions.update_transaction(transaction_id, self.transaction(account_a, 9))
        transactions.delete_transaction(transaction_id)
        for account_id in (account_a, account_b):
            history = accounts.get_account_detail(account_id)["activity"]
            update = next(item for item in history if item["entity_id"] == str(transaction_id) and item["action"] == "修改流水")
            self.assertEqual(json.loads(update["before_value"])["account_id"], account_b)
            self.assertEqual(json.loads(update["after_value"])["account_id"], account_a)
        deleted = next(item for item in accounts.get_account_detail(account_a)["activity"] if item["action"] == "删除流水")
        self.assertEqual(Decimal(str(json.loads(deleted["before_value"])["amount"])), 9)
        self.assertIsNone(deleted["after_value"])

    def test_explicit_insert_ids_support_members_investments_plans_and_backup(self):
        member_id = create_family_member(FamilyMemberCreate(
            display_name="测试成员", username="workflow-member", password="workflow-pass",
        ))["id"]
        self.assertGreater(member_id, 0)
        account_id = self.account("投资", "investment", 1000)
        holding_id = add_holding(HoldingCreate(
            name="标的", code="TEST", account_id=account_id,
            buy_price=10, current_price=10, quantity=1,
        ))["id"]
        trade_id = create_investment_trade(InvestmentTradeCreate(
            holding_id=holding_id, trade_type="buy", quantity=1, price=10, occurred_at="2026-09-28",
        ), idempotency_key="buy-key")["id"]
        event = self.row("SELECT * FROM audit_events WHERE entity_type = 'investment_trade' AND entity_id = ?", (str(trade_id),))
        self.assertIsNone(event["before_value"])
        self.assertEqual(json.loads(event["after_value"])["holding_id"], holding_id)
        category_id = create_category(CategoryCreate(name="测试支出", type="expense"))["id"]
        owner_id = self.row(
            "SELECT id FROM family_members WHERE role = 'owner' ORDER BY id LIMIT 1"
        )["id"]
        budget = BudgetCreate(
            month="2026-09",
            total_amount=100,
            categories=[
                BudgetCategoryAllocation(
                    category_id=category_id,
                    amount=100,
                    member_allocations=[
                        MemberAmountAllocation(member_id=owner_id, amount=100),
                        MemberAmountAllocation(member_id=member_id, amount=0),
                    ],
                ),
            ],
        )
        budget_id = create_or_update_budget(budget)["id"]
        updated_budget = BudgetCreate(
            month="2026-09",
            total_amount=200,
            categories=[
                BudgetCategoryAllocation(
                    category_id=category_id,
                    amount=200,
                    member_allocations=[
                        MemberAmountAllocation(member_id=owner_id, amount=200),
                        MemberAmountAllocation(member_id=member_id, amount=0),
                    ],
                ),
            ],
        )
        self.assertEqual(create_or_update_budget(updated_budget)["id"], budget_id)
        event = self.row("SELECT * FROM audit_events WHERE entity_type = 'budget_plan' ORDER BY id DESC LIMIT 1")
        self.assertEqual(Decimal(str(json.loads(event["before_value"])["total_amount"])), 100)
        self.assertEqual(Decimal(str(json.loads(event["after_value"])["total_amount"])), 200)
        goal_id = create_goal(GoalCreate(
            name="测试目标",
            target_amount=1000,
            allocations=[GoalMemberAllocation(member_id=owner_id, target_amount=1000)],
        ))["id"]
        record_id = create_goal_record(goal_id, GoalRecordCreate(amount=10, recorded_at="2026-09-28"))["id"]
        self.assertGreater(record_id, 0)
        conn = database.get_connection()
        saved = snapshot(conn)
        conn.close()
        prepared = prepare_family_restore(saved, fingerprint(saved))
        with database.write_connection() as conn:
            restored = restore(conn, saved, fingerprint(saved), prepared=prepared)
        account_id = restored["id_mapping"]["accounts"][account_id]
        goal_id = restored["id_mapping"]["goals"][goal_id]
        self.assertEqual(self.row("SELECT cash_available FROM accounts WHERE id = ?", (account_id,))["cash_available"], 990)
        self.assertEqual(self.row("SELECT current_amount FROM goals WHERE id = ?", (goal_id,))["current_amount"], 10)


class SQLiteWorkflows(UpgradeWorkflows, RestoreWorkflows, HistoryWorkflows, ConcurrentCashWorkflows, AccountingWorkflows, unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        state = patch.multiple(database, DB_DIR=folder.name, DB=os.path.join(folder.name, "test.db"), DATABASE_URL=None)
        state.start()
        self.addCleanup(state.stop)
        database.init_db()
        self.auth_context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        auth_scope = use_auth_context(self.auth_context)
        auth_scope.__enter__()
        self.addCleanup(auth_scope.__exit__, None, None, None)


@unittest.skipUnless(os.environ.get("INVEST_TEST_POSTGRES_URL"), "Set INVEST_TEST_POSTGRES_URL for real PostgreSQL workflows")
class PostgreSQLWorkflows(UpgradeWorkflows, RestoreWorkflows, HistoryWorkflows, ConcurrentCashWorkflows, AccountingWorkflows, unittest.TestCase):
    def setUp(self):
        import psycopg
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        admin_url = os.environ["INVEST_TEST_POSTGRES_URL"]
        name = f"invest_test_{uuid4().hex}"
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        def drop_database():
            with psycopg.connect(admin_url, autocommit=True) as conn:
                conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        self.addCleanup(drop_database)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        state = patch.multiple(database, DB_DIR=folder.name, DATABASE_URL=make_conninfo(admin_url, dbname=name))
        state.start()
        self.addCleanup(state.stop)
        database.init_db()
        self.auth_context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        auth_scope = use_auth_context(self.auth_context)
        auth_scope.__enter__()
        self.addCleanup(auth_scope.__exit__, None, None, None)

    def test_account_owner_move_and_transaction_edit_follow_one_lock_order(self):
        member_id = create_family_member(FamilyMemberCreate(
            display_name="并发成员",
            username=f"member-{uuid4().hex[:12]}",
            password="member-pass",
        ))["id"]
        account_id = self.account("并发归属账户")
        transaction_id = transactions.create_transaction(
            self.transaction(account_id, 100, "income")
        )["id"]

        results = self.run_concurrently(
            lambda: accounts.update_account(
                account_id,
                AccountCreate(
                    name="并发归属账户",
                    type="debit_card",
                    member_id=member_id,
                    opening_date="2026-09-01",
                ),
            ),
            lambda: transactions.update_transaction(
                transaction_id,
                TransactionCreate(
                    account_id=account_id,
                    amount=100,
                    direction="income",
                    occurred_at="2026-09-28",
                    note="并发更正",
                ),
            ),
        )

        self.assertTrue(all(isinstance(result, dict) for result in results))
        self.assertEqual(
            self.row("SELECT member_id FROM accounts WHERE id = ?", (account_id,))[
                "member_id"
            ],
            member_id,
        )
        self.assertEqual(
            self.row(
                "SELECT note FROM transactions WHERE id = ?",
                (transaction_id,),
            )["note"],
            "并发更正",
        )

    def test_transfer_reversal_and_buy_cannot_overdraw_investment_cash(self):
        source = self.account("撤销来源", "debit_card", 500)
        investment = self.account("撤销投资", "investment", 0)
        transfer = accounts.transfer_between_accounts(TransferCreate(
            from_account_id=source,
            to_account_id=investment,
            amount=500,
            occurred_at="2026-09-28",
        ))
        holding = add_holding(HoldingCreate(
            account_id=investment,
            name="撤销竞争标的",
            code="REV-RACE",
            buy_price=100,
            current_price=100,
            quantity=1,
        ))["id"]

        results = self.run_concurrently(
            lambda: create_investment_trade(InvestmentTradeCreate(
                holding_id=holding,
                trade_type="buy",
                quantity=3,
                price=100,
                occurred_at="2026-09-28",
            )),
            lambda: accounts.reverse_transfer(
                transfer["reference_id"],
                ReversalCreate(reason="并发撤销"),
            ),
        )

        self.assertEqual(sum(result == 409 for result in results), 1)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertGreaterEqual(
            self.row(
                "SELECT cash_available FROM accounts WHERE id = ?",
                (investment,),
            )["cash_available"],
            0,
        )


class PostgreSQLAdapterTests(unittest.TestCase):
    def test_execute_never_invents_returning_fields(self):
        raw = Mock()
        adapter = database.PostgresConnection(raw)
        for query in (
            "INSERT INTO financial_commands(command_key) VALUES (?) ON CONFLICT(command_key) DO NOTHING",
            "INSERT INTO financial_commands(command_key) VALUES (?)\nON CONFLICT (command_key) DO NOTHING",
            "INSERT INTO accounts(name) VALUES (?)\nRETURNING id",
        ):
            adapter.execute(query, ("value",))
            raw.execute.assert_called_with(query.replace("?", "%s"), ("value",))

    def test_executemany_uses_a_cursor_instead_of_the_connection(self):
        raw = Mock()
        cursor = raw.cursor.return_value
        adapter = database.PostgresConnection(raw)
        rows = [("A",), ("B",)]

        wrapped = adapter.executemany("INSERT INTO categories(name) VALUES (?)", rows)

        raw.executemany.assert_not_called()
        cursor.executemany.assert_called_once_with(
            "INSERT INTO categories(name) VALUES (%s)",
            rows,
        )
        self.assertIs(wrapped.cursor, cursor)
