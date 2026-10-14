import importlib
import asyncio
import os
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

import database
import application.market_data as market_data_application
from application.backup import export_family_backup
import queries.finance as finance_queries
from architecture_check import validate_architecture
import snapshot_scheduler
from commands import command_result, financial_command
from schema_migrations import CURRENT_SCHEMA_VERSION, run_schema_migrations
from routers import auth
from routers.accounts import create_account, reconcile_accounts
from routers.investments import add_holding
from routers.transactions import create_transaction
from routers.warehouse import preview_restore
from schemas import AccountCreate, HoldingCreate, LoginData, TransactionCreate
from security import validate_runtime_security
from tenancy import AuthContext, get_auth_context, use_auth_context


class ArchitectureRegressions(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DATABASE_URL = None
        database.DB_DIR = self.temp_dir.name
        database.DB = os.path.join(self.temp_dir.name, "invest.db")
        database.init_db()
        auth._login_attempts.clear()
        self.auth_context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        self.auth_context_manager = use_auth_context(self.auth_context)
        self.auth_context_manager.__enter__()

    def tearDown(self):
        self.auth_context_manager.__exit__(None, None, None)
        auth._login_attempts.clear()
        self.temp_dir.cleanup()

    def test_main_import_does_not_run_migrations(self):
        import main

        with patch.object(database, "init_db") as migrate:
            importlib.reload(main)
        migrate.assert_not_called()

    def test_dependency_direction_and_financial_boundaries(self):
        self.assertEqual(validate_architecture(), [])

    def test_healthcheck_verifies_database_and_schema(self):
        result = auth.healthcheck()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["schema_version"], database.get_schema_version())
        self.assertEqual(result["snapshot_job"]["status"], "never")

    def test_snapshot_job_persists_success_and_failure_status(self):
        succeeded = snapshot_scheduler.run_snapshot_job("2026-09-29")
        self.assertEqual(succeeded["status"], "succeeded")
        status = snapshot_scheduler.get_snapshot_job_status()
        self.assertEqual(status["status"], "succeeded")
        self.assertIsNotNone(status["last_succeeded_at"])

        with patch.object(
            snapshot_scheduler,
            "refresh_all_warehouse_snapshots",
            side_effect=RuntimeError("snapshot failed"),
        ):
            failed = snapshot_scheduler.run_snapshot_job("2026-09-30")
        self.assertEqual(failed["status"], "failed")
        status = snapshot_scheduler.get_snapshot_job_status()
        self.assertEqual(status["status"], "failed")
        self.assertTrue(status["has_error"])
        self.assertIsNotNone(status["last_succeeded_at"])

    def test_snapshot_running_state_is_visible_before_work_finishes(self):
        observed = {}

        def inspect_running(_snapshot_date):
            observed.update(snapshot_scheduler.get_snapshot_job_status())
            return []

        with patch.object(
            snapshot_scheduler,
            "refresh_all_warehouse_snapshots",
            side_effect=inspect_running,
        ):
            result = snapshot_scheduler.run_snapshot_job("2026-10-01")
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(observed["status"], "running")
        self.assertEqual(observed["last_requested_for"], "2026-10-01")
        conn = database.get_connection()
        try:
            run = conn.execute(
                "SELECT status FROM background_job_runs "
                "WHERE requested_for = '2026-10-01'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(run["status"], "succeeded")

    def test_snapshot_job_skips_when_postgres_lock_is_held(self):
        class LockedConnection:
            def __init__(self):
                self.rolled_back = False
                self.closed = False

            def execute(self, _sql, _params=()):
                return type("Cursor", (), {
                    "fetchone": lambda _self: {"acquired": False},
                })()

            def rollback(self):
                self.rolled_back = True

            def close(self):
                self.closed = True

        conn = LockedConnection()
        with patch.object(snapshot_scheduler, "get_connection", return_value=conn), \
                patch.object(snapshot_scheduler, "is_postgres_connection", return_value=True), \
                patch.object(snapshot_scheduler, "refresh_all_warehouse_snapshots") as refresh:
            result = snapshot_scheduler.run_snapshot_job("2026-09-29")

        self.assertEqual(result, {"status": "skipped", "reason": "already_running"})
        self.assertTrue(conn.rolled_back)
        self.assertTrue(conn.closed)
        refresh.assert_not_called()

    def test_vercel_runtime_does_not_start_in_process_scheduler_by_default(self):
        import main

        async def scenario():
            with patch.dict(os.environ, {"VERCEL": "1"}, clear=False):
                os.environ.pop("ENABLE_SNAPSHOT_SCHEDULER", None)
                with patch.object(main, "validate_runtime_security"), \
                        patch.object(main, "assert_schema_current"), \
                        patch.object(main, "save_snapshot_safely", new=AsyncMock()) as save:
                    async with main.lifespan(None):
                        pass
                    save.assert_not_awaited()

        asyncio.run(scenario())

    def test_schema_migration_upgrade_and_repeat_are_idempotent(self):
        conn = database.get_connection()
        try:
            conn.execute("DROP TABLE background_job_status")
            conn.execute(
                "DELETE FROM schema_migrations WHERE version >= ?",
                (3,),
            )
            conn.commit()

            run_schema_migrations(conn, False)
            run_schema_migrations(conn, False)
            conn.commit()

            versions = conn.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
            status_table = conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'background_job_status'
                """
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(
            [row["version"] for row in versions],
            list(range(1, CURRENT_SCHEMA_VERSION + 1)),
        )
        self.assertIsNotNone(status_table)

    def test_v12_renames_shopping_and_preserves_transaction_references(self):
        account_id = create_account(AccountCreate(
            name="分类迁移账户",
            type="debit_card",
            balance=1000,
        ))["id"]
        conn = database.get_connection()
        family_id = conn.execute(
            "SELECT family_id FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()["family_id"]
        shopping_id = conn.execute(
            """
            INSERT INTO categories
            (family_id, name, type, icon, color, sort_order)
            VALUES (?, '购物', 'expense', '🛍️', '#c8914b', 99)
            RETURNING id
            """,
            (family_id,),
        ).fetchone()["id"]
        conn.commit()
        conn.close()
        transaction_id = create_transaction(TransactionCreate(
            account_id=account_id,
            category_id=shopping_id,
            amount=20,
            direction="expense",
            occurred_at="2026-09-29",
        ))["id"]

        conn = database.get_connection()
        try:
            conn.execute("DELETE FROM schema_migrations WHERE version = 12")
            run_schema_migrations(conn, False)
            run_schema_migrations(conn, False)
            category = conn.execute(
                """
                SELECT c.name, c.icon
                FROM transactions t
                JOIN categories c ON c.id = t.category_id
                WHERE t.id = ?
                """,
                (transaction_id,),
            ).fetchone()
            shopping_count = conn.execute(
                "SELECT COUNT(*) AS count FROM categories WHERE name = '购物'"
            ).fetchone()["count"]
        finally:
            conn.close()

        self.assertEqual(dict(category), {"name": "服饰", "icon": "👕"})
        self.assertEqual(shopping_count, 0)

    def test_v9_migration_does_not_invent_a_baseline_for_existing_accounts(self):
        account = create_account(AccountCreate(name="旧库账户", type="debit_card", balance=100))["id"]
        with database.write_connection() as conn:
            conn.execute("ALTER TABLE accounts DROP COLUMN history_basis")
            conn.execute("ALTER TABLE audit_events DROP COLUMN payload_version")
            conn.execute("DELETE FROM schema_migrations WHERE version = 9")
            before = dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (account,)).fetchone())
            run_schema_migrations(conn, False)
            run_schema_migrations(conn, False)
            after = dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (account,)).fetchone())
            self.assertEqual(after.pop("history_basis"), "unknown")
            self.assertEqual(before, after)
            self.assertEqual(conn.execute(
                "SELECT payload_version FROM audit_events WHERE entity_type = 'account'",
            ).fetchone()["payload_version"], 0)

    def test_v10_migration_normalizes_legacy_dates_before_balance_comparison(self):
        account_id = create_account(AccountCreate(
            name="紧凑日期旧账户",
            type="debit_card",
            balance=100,
            opening_date="2026-09-01",
        ))["id"]
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER business_date_accounts_opened_at_update")
            conn.execute("DROP TRIGGER business_date_transactions_occurred_at_update")
            conn.execute("DELETE FROM schema_migrations WHERE version = 10")
            conn.execute(
                "UPDATE accounts SET opened_at = '20260901' WHERE id = ?",
                (account_id,),
            )
            conn.execute(
                "UPDATE transactions SET occurred_at = '20260901' "
                "WHERE account_id = ? AND source = 'opening'",
                (account_id,),
            )
            conn.commit()
            run_schema_migrations(conn, False)
            run_schema_migrations(conn, False)
            conn.commit()
            self.assertEqual(
                conn.execute(
                    "SELECT opened_at FROM accounts WHERE id = ?",
                    (account_id,),
                ).fetchone()["opened_at"],
                "2026-09-01",
            )
            self.assertEqual(
                conn.execute(
                    "SELECT occurred_at FROM transactions "
                    "WHERE account_id = ? AND source = 'opening'",
                    (account_id,),
                ).fetchone()["occurred_at"],
                "2026-09-01",
            )
            with self.assertRaises(Exception):
                conn.execute(
                    "UPDATE accounts SET opened_at = '20260901' WHERE id = ?",
                    (account_id,),
                )
            conn.rollback()
        finally:
            conn.close()

        create_transaction(TransactionCreate(
            account_id=account_id,
            amount=10,
            direction="expense",
            occurred_at="2026-09-02",
        ))
        conn = database.get_connection()
        try:
            balance = conn.execute(
                "SELECT balance FROM accounts WHERE id = ?",
                (account_id,),
            ).fetchone()["balance"]
        finally:
            conn.close()
        self.assertEqual(balance, 90)
        self.assertEqual(
            preview_restore(export_family_backup())["counts"]["accounts"],
            1,
        )

    def test_date_migration_reports_preexisting_balance_application_mismatch(self):
        account_id = create_account(AccountCreate(
            name="迁移前漏扣账户",
            type="debit_card",
            balance=100,
            opening_date="2026-09-01",
        ))["id"]
        transaction_id = create_transaction(TransactionCreate(
            account_id=account_id,
            amount=10,
            direction="expense",
            occurred_at="2026-09-28",
        ))["id"]
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER business_date_accounts_opened_at_update")
            conn.execute("DROP TRIGGER business_date_transactions_occurred_at_update")
            conn.execute("DELETE FROM schema_migrations WHERE version = 10")
            conn.execute(
                "UPDATE accounts SET opened_at = '20260901', balance = 100 "
                "WHERE id = ?",
                (account_id,),
            )
            conn.execute(
                "UPDATE transactions SET occurred_at = '20260901' "
                "WHERE account_id = ? AND source = 'opening'",
                (account_id,),
            )
            conn.execute(
                "UPDATE transactions SET balance_applied = 0 WHERE id = ?",
                (transaction_id,),
            )
            conn.commit()
            run_schema_migrations(conn, False)
            conn.commit()
            stored = dict(conn.execute(
                "SELECT occurred_at, balance_applied FROM transactions WHERE id = ?",
                (transaction_id,),
            ).fetchone())
            balance = conn.execute(
                "SELECT balance FROM accounts WHERE id = ?",
                (account_id,),
            ).fetchone()["balance"]
        finally:
            conn.close()

        self.assertEqual(stored, {
            "occurred_at": "2026-09-28",
            "balance_applied": 0,
        })
        self.assertEqual(balance, 100)
        item = reconcile_accounts()["items"][0]
        self.assertTrue(item["matches"])
        self.assertEqual(item["application"]["status"], "inconsistent")
        self.assertEqual(
            item["application"]["issues"][0]["transaction_id"],
            transaction_id,
        )
        self.assertFalse(item["reconstructable"])
        self.assertIsNotNone(item["limitation"])

    def test_v10_migration_rejects_ambiguous_stored_dates(self):
        account_id = create_account(AccountCreate(
            name="非法日期旧账户",
            type="debit_card",
            opening_date="2026-09-01",
        ))["id"]
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER business_date_accounts_opened_at_update")
            conn.execute("DELETE FROM schema_migrations WHERE version = 10")
            conn.execute(
                "UPDATE accounts SET opened_at = '09/01/2026' WHERE id = ?",
                (account_id,),
            )
            conn.commit()
            with self.assertRaisesRegex(
                RuntimeError,
                rf"accounts\.id={account_id}.*opened_at",
            ):
                run_schema_migrations(conn, False)
            conn.rollback()
            version_10 = conn.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 10"
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNone(version_10)

    def test_v10_migration_merges_snapshot_dates_that_become_identical(self):
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER business_date_snapshots_snapshot_date_insert")
            conn.execute("DELETE FROM schema_migrations WHERE version = 10")
            for snapshot_date, net_worth, created_at in (
                ("2026-09-01", 100, "2026-09-01T10:00:00"),
                ("20260901", 200, "2026-09-01T11:00:00"),
            ):
                conn.execute(
                    """
                    INSERT INTO snapshots
                    (family_id, member_id, snapshot_date, asset_total,
                     liability_total, net_worth, investment_value, cash_value,
                     created_at)
                    VALUES (?, NULL, ?, ?, 0, ?, 0, ?, ?)
                    """,
                    (
                        self.auth_context.family_id,
                        snapshot_date,
                        net_worth,
                        net_worth,
                        net_worth,
                        created_at,
                    ),
                )
            conn.commit()
            run_schema_migrations(conn, False)
            conn.commit()
            rows = conn.execute(
                "SELECT snapshot_date, net_worth FROM snapshots"
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual(
            [dict(row) for row in rows],
            [{"snapshot_date": "2026-09-01", "net_worth": 200}],
        )

    def test_v11_snapshot_governance_matches_legacy_backup_preview(self):
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER business_date_snapshots_snapshot_date_insert")
            conn.execute("DELETE FROM snapshots")
            for snapshot_date, net_worth, created_at in (
                ("2026-10-01", 100, "2026-10-01T10:00:00"),
                ("20261001", 200, "2026-10-01T11:00:00"),
            ):
                conn.execute(
                    """
                    INSERT INTO snapshots
                    (family_id, member_id, snapshot_date, asset_total,
                     liability_total, net_worth, investment_value, cash_value,
                     created_at)
                    VALUES (?, NULL, ?, ?, 0, ?, 0, ?, ?)
                    """,
                    (
                        self.auth_context.family_id,
                        snapshot_date,
                        net_worth,
                        net_worth,
                        net_worth,
                        created_at,
                    ),
                )
            conn.commit()
            exported = export_family_backup()
            conn.execute("DELETE FROM schema_migrations WHERE version = 11")
            run_schema_migrations(conn, False)
            conn.commit()
            migrated = [
                dict(row)
                for row in conn.execute(
                    "SELECT snapshot_date, net_worth FROM snapshots ORDER BY id"
                ).fetchall()
            ]
        finally:
            conn.close()

        preview = preview_restore(exported)
        self.assertEqual(migrated, [{
            "snapshot_date": "2026-10-01",
            "net_worth": 200,
        }])
        self.assertEqual(preview["counts"]["snapshots"], 1)
        self.assertEqual(
            preview["snapshot_compatibility"]["collisions"][0]["kept"]["created_at"],
            "2026-10-01T11:00:00",
        )

    def test_failed_sqlite_initialization_rolls_back_schema_changes(self):
        original_db = database.DB
        database.DB = os.path.join(self.temp_dir.name, "failed-migration.db")

        def fail_migration(conn, _is_postgres):
            conn.execute("CREATE TABLE migration_failure_marker (id INTEGER)")
            raise RuntimeError("migration failed")

        try:
            with patch.object(database, "run_schema_migrations", side_effect=fail_migration):
                with self.assertRaisesRegex(RuntimeError, "migration failed"):
                    database.init_db()
            conn = database.get_connection()
            try:
                marker = conn.execute(
                    """
                    SELECT name FROM sqlite_master
                    WHERE type = 'table' AND name = 'migration_failure_marker'
                    """
                ).fetchone()
            finally:
                conn.close()
        finally:
            database.DB = original_db

        self.assertIsNone(marker)

    def test_investment_cash_migration_reports_existing_invalid_rows(self):
        context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        with use_auth_context(context):
            account_id = create_account(AccountCreate(
                name="迁移前异常账户",
                type="investment",
                balance=100,
            ))["id"]
        conn = database.get_connection()
        try:
            conn.execute("DROP TRIGGER investment_cash_nonnegative_insert")
            conn.execute("DROP TRIGGER investment_cash_nonnegative_update")
            conn.execute("DELETE FROM schema_migrations WHERE version >= 4")
            conn.execute(
                "UPDATE accounts SET cash_available = -1 WHERE id = ?",
                (account_id,),
            )
            conn.commit()
            with self.assertRaisesRegex(RuntimeError, "family=1 account="):
                run_schema_migrations(conn, False)
            conn.rollback()
            version = conn.execute(
                "SELECT MAX(version) AS version FROM schema_migrations"
            ).fetchone()["version"]
        finally:
            conn.close()
        self.assertEqual(version, 3)

    def test_login_is_rate_limited_after_repeated_failures(self):
        with patch.object(auth, "LOGIN_MAX_ATTEMPTS", 2):
            self.assertFalse(auth.login(LoginData(username="admin", password="bad"))["ok"])
            self.assertFalse(auth.login(LoginData(username="admin", password="bad"))["ok"])
            with self.assertRaises(HTTPException) as rejected:
                auth.login(LoginData(username="admin", password="bad"))
        self.assertEqual(rejected.exception.status_code, 429)

    def test_production_rejects_missing_or_weak_secrets(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            with self.assertRaises(RuntimeError):
                validate_runtime_security()
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "APP_PASSWORD": "a-long-production-password",
            "APP_AUTH_SECRET": "s" * 48,
        }, clear=True):
            validate_runtime_security()

    def test_nginx_uses_static_first_backend_fallback(self):
        config = (
            PROJECT_DIR / "deploy/nginx/snippets/app-locations.conf"
        ).read_text()
        self.assertIn("location @backend", config)
        self.assertIn("try_files $uri $uri/ @backend;", config)
        self.assertNotIn("location ~ ^/(login|auth|family", config)

    def test_nginx_security_headers_cover_overriding_static_locations(self):
        locations = (
            PROJECT_DIR / "deploy/nginx/snippets/app-locations.conf"
        ).read_text()
        security = (
            PROJECT_DIR / "deploy/nginx/snippets/security-headers.conf"
        ).read_text()
        self.assertGreaterEqual(
            locations.count("include /etc/nginx/snippets/security-headers.conf;"),
            3,
        )
        self.assertIn("connect-src 'self'", security)
        self.assertNotIn("connect-src https:", security)
        self.assertIn("frame-ancestors 'none'", security)

    def test_postgres_restore_is_single_transaction(self):
        script = (PROJECT_DIR / "deploy/scripts/restore-postgres.sh").read_text()
        self.assertIn("psql --single-transaction -v ON_ERROR_STOP=1", script)

    def test_quote_fetch_releases_read_connection_before_network_io(self):
        context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        with use_auth_context(context):
            account_id = create_account(AccountCreate(
                name="投资",
                type="investment",
                balance=100,
            ))["id"]
            add_holding(HoldingCreate(
                name="测试",
                code="TEST",
                buy_price=1,
                quantity=1,
                current_price=1,
                account_id=account_id,
            ))

        real_get_connection = database.get_connection
        tracked = []

        class TrackedConnection:
            def __init__(self, connection):
                self.connection = connection
                self.closed = False

            def __getattr__(self, name):
                return getattr(self.connection, name)

            def close(self):
                self.closed = True
                self.connection.close()

        def tracked_connection():
            connection = TrackedConnection(real_get_connection())
            tracked.append(connection)
            return connection

        def fetch_price_after_close(*_args):
            self.assertTrue(tracked[0].closed)
            return {"price": 2, "source": "test", "symbol": "TEST"}

        with patch.object(market_data_application, "get_connection", side_effect=tracked_connection), \
                patch.object(market_data_application, "fetch_price", side_effect=fetch_price_after_close):
            result = market_data_application.refresh_holding_prices(context=context)
        self.assertEqual(result["updated"], 1)

    def test_stale_quote_cannot_overwrite_changed_holding_identity_or_price(self):
        context = auth.context_from_token(
            auth.create_access_token_for_username("admin"),
            "family",
        )
        with use_auth_context(context):
            account_id = create_account(AccountCreate(
                name="行情账户",
                type="investment",
                balance=100,
            ))["id"]
            holding_id = add_holding(HoldingCreate(
                name="旧标的",
                code="OLD",
                buy_price=1,
                quantity=1,
                current_price=1,
                account_id=account_id,
            ))["id"]

        def change_while_fetching(*_args):
            conn = database.get_connection()
            conn.execute(
                """
                UPDATE holdings
                SET code = 'NEW', market = 'US', asset_type = 'fund',
                    currency = 'USD', exchange_rate_to_base = 7,
                    current_price = 9, updated_at = 'manual-newer'
                WHERE id = ?
                """,
                (holding_id,),
            )
            conn.commit()
            conn.close()
            return {"price": 2, "source": "test", "symbol": "OLD"}

        with patch.object(
            market_data_application,
            "fetch_price",
            side_effect=change_while_fetching,
        ):
            result = market_data_application.refresh_holding_prices(context=context)
        holding = database.get_connection()
        try:
            row = holding.execute(
                "SELECT code, current_price, updated_at FROM holdings WHERE id = ?",
                (holding_id,),
            ).fetchone()
        finally:
            holding.close()
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(dict(row), {
            "code": "NEW",
            "current_price": 9.0,
            "updated_at": "manual-newer",
        })

    def test_database_rows_preserve_decimal_until_the_response_boundary(self):
        value = Decimal("1234567890123456.12345678")
        result = database.rows_to_dicts([{"amount": value}])
        self.assertIs(result[0]["amount"], value)

    def test_postgres_decimal_investment_values_combine_without_float_coercion(self):
        accounts = database.rows_to_dicts([{
            "id": 1,
            "type": "investment",
            "is_liability": 0,
            "balance": Decimal("0.00"),
            "cash_available": Decimal("100.12"),
            "exchange_rate_to_base": Decimal("1.2500000000"),
        }])
        result = finance_queries.apply_investment_account_values(
            accounts,
            {1: Decimal("374.8500000000")},
        )[0]

        self.assertIsInstance(result["balance"], Decimal)
        self.assertEqual(result["cash_available"], Decimal("125.15"))
        self.assertEqual(result["holdings_value"], Decimal("374.85"))
        self.assertEqual(result["balance"], Decimal("500.00"))

    def test_idempotency_fingerprint_preserves_decimal_precision(self):
        @financial_command(update_snapshot=False)
        def exact_decimal_command(value: Decimal):
            return command_result({"ok": True})

        exact_decimal_command(
            Decimal("9999999999999999.00000001"),
            idempotency_key="exact-decimal",
        )
        with self.assertRaises(HTTPException) as rejected:
            exact_decimal_command(
                Decimal("9999999999999999.00000002"),
                idempotency_key="exact-decimal",
            )
        self.assertEqual(rejected.exception.status_code, 409)

    def test_async_auth_does_not_block_and_keeps_task_local_identity(self):
        contexts = {
            "first": AuthContext(
                1, "first", "第一位", 10, "家庭一", 101, "owner",
                authenticated=True,
            ),
            "second": AuthContext(
                2, "second", "第二位", 20, "家庭二", 202, "member",
                authenticated=True,
            ),
        }

        def slow_context(token, scope):
            time.sleep(0.1)
            return contexts[token].with_scope(scope)

        async def authenticate(token, scope):
            context = await auth.require_auth(f"Bearer {token}", scope)
            return context, get_auth_context()

        async def heartbeat(started_at):
            await asyncio.sleep(0.01)
            return asyncio.get_running_loop().time() - started_at

        async def scenario():
            started_at = asyncio.get_running_loop().time()
            first, second, delay = await asyncio.gather(
                authenticate("first", "family"),
                authenticate("second", "personal"),
                heartbeat(started_at),
            )
            return first, second, delay

        with patch.object(auth, "context_from_token", side_effect=slow_context):
            first, second, heartbeat_delay = asyncio.run(scenario())

        self.assertLess(heartbeat_delay, 0.08)
        self.assertEqual(first[0], first[1])
        self.assertEqual(second[0], second[1])
        self.assertEqual(first[0].family_id, 10)
        self.assertEqual(second[0].family_id, 20)
        self.assertEqual(second[0].scope, "personal")

    def test_missing_request_identity_is_rejected_without_owner_fallback(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(get_auth_context)
            with self.assertRaises(HTTPException) as rejected:
                future.result()
        self.assertEqual(rejected.exception.status_code, 401)
        with self.assertRaises(RuntimeError):
            auth.create_access_token_for_username("missing-user")


if __name__ == "__main__":
    unittest.main()
