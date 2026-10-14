"""Upgrade fixtures and real transactions shared by SQLite and PostgreSQL."""
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from decimal import Decimal
from threading import Event
from unittest.mock import patch

from fastapi import HTTPException

import database
import application.ledger as ledger_application
from application.backup import export_family_backup, fingerprint
from application.commands import command_fingerprint
from queries.commands import get_command_status
from routers import accounts, transactions, warehouse
from schemas import TransactionApplicationCorrection, TransactionCreate
from schema_migrations import run_schema_migrations
from tenancy import use_auth_context


class UpgradeWorkflows:
    def remove_date_guard(self, conn, table, field):
        name = f"business_date_{table}_{field}"
        if database.DATABASE_URL:
            conn.execute(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{name}"')
        else:
            for timing in ("insert", "update"):
                conn.execute(f'DROP TRIGGER IF EXISTS "{name}_{timing}"')

    def seed_missed_application(self, account_type="debit_card"):
        account_id = self.account("历史漏扣", account_type, 100)
        transaction_id = transactions.create_transaction(self.transaction(account_id, 10))["id"]
        field = "cash_available" if account_type == "investment" else "balance"
        with database.write_connection() as conn:
            conn.execute("UPDATE transactions SET balance_applied = 0 WHERE id = ?", (transaction_id,))
            conn.execute(f"UPDATE accounts SET {field} = 100 WHERE id = ?", (account_id,))
        return account_id, transaction_id

    def correction(self, balance=100):
        return TransactionApplicationCorrection(
            expected_account_balance=balance, expected_balance_applied=False,
            reason="根据原始账单确认历史漏扣",
        )

    def test_unversioned_command_migration_preserves_terminal_key_and_scope_isolation(self):
        account_id = self.account("升级幂等", balance=100)
        payload = self.transaction(account_id, 10)
        result = transactions.create_transaction(payload, idempotency_key="legacy-upgrade")
        legacy = command_fingerprint(
            self.auth_context, transactions.create_transaction.__wrapped__,
            {"transaction": payload}, 1,
        )
        with database.write_connection() as conn:
            conn.execute("UPDATE financial_commands SET fingerprint = ? WHERE command_key = ?", (legacy, "legacy-upgrade"))
            if not database.DATABASE_URL:
                for guard in ("financial_command_fingerprint_version_valid", "financial_command_scope_valid"):
                    for timing in ("insert", "update"):
                        conn.execute(f'DROP TRIGGER IF EXISTS "{guard}_{timing}"')
            conn.execute("ALTER TABLE financial_commands DROP COLUMN fingerprint_version")
            conn.execute("ALTER TABLE financial_commands DROP COLUMN data_scope")
            conn.execute("DELETE FROM schema_migrations WHERE version = 11")
            run_schema_migrations(conn, bool(database.DATABASE_URL))
            run_schema_migrations(conn, bool(database.DATABASE_URL))
        self.assertEqual(get_command_status("legacy-upgrade"), {
            "status": "committed", "protocol_version": 0, "scope_known": False,
        })
        for context in (self.auth_context, self.auth_context.with_scope("personal")):
            with use_auth_context(context), self.assertRaises(HTTPException) as replay:
                transactions.create_transaction(payload, idempotency_key="legacy-upgrade")
            self.assertEqual(replay.exception.code, "COMMAND_RESULT_EXPIRED")
        for context in (replace(self.auth_context, user_id=99999), self.other_family()):
            with use_auth_context(context):
                self.assertEqual(get_command_status("legacy-upgrade")["status"], "unknown")
                with self.assertRaises(HTTPException):
                    transactions.create_transaction(payload, idempotency_key="legacy-upgrade")
        with database.write_connection() as conn:
            conn.execute("UPDATE financial_commands SET fingerprint_version = 1, response = NULL, response_expires_at = '2000-01-01' WHERE command_key = 'legacy-upgrade'")
        with self.assertRaises(HTTPException) as expired:
            transactions.create_transaction(payload, idempotency_key="legacy-upgrade")
        self.assertEqual(expired.exception.code, "COMMAND_RESULT_EXPIRED")
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account_id,))["balance"], 90)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND source = 'manual'", (account_id,))["n"], 1)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = 'transaction' AND entity_id = ?", (str(result["id"]),))["n"], 1)
        saved = export_family_backup()
        warehouse.restore_backup(self.restore_request(saved))
        self.assertEqual(get_command_status("legacy-upgrade")["status"], "invalidated")
        with self.assertRaises(HTTPException) as invalidated:
            transactions.create_transaction(payload, idempotency_key="legacy-upgrade")
        self.assertEqual(invalidated.exception.code, "COMMAND_INVALIDATED")
        self.assertEqual(get_command_status("never-submitted")["status"], "unknown")

    def test_inflight_legacy_receipt_is_unknown_until_atomic_commit_and_retry_waits(self):
        self.prepare_concurrent_read()
        account_id = self.account("旧命令执行中", balance=100)
        payload = self.transaction(account_id, 10)
        legacy = command_fingerprint(
            self.auth_context, transactions.create_transaction.__wrapped__,
            {"transaction": payload}, 1,
        )
        entered, release, retry_started = Event(), Event(), Event()
        apply_delta = ledger_application.apply_account_balance_delta

        def held_write(conn, *args):
            apply_delta(conn, *args)
            conn.execute("UPDATE financial_commands SET fingerprint = ?, fingerprint_version = 1, data_scope = NULL WHERE command_key = 'inflight-legacy'", (legacy,))
            entered.set()
            if not release.wait(30):
                raise RuntimeError("test release timed out")

        def write():
            with use_auth_context(self.auth_context):
                return transactions.create_transaction(payload, idempotency_key="inflight-legacy")

        def retry():
            retry_started.set()
            try:
                return write()
            except HTTPException as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool, patch.object(
            ledger_application, "apply_account_balance_delta", side_effect=held_write,
        ):
            first = pool.submit(write)
            try:
                self.assertTrue(entered.wait(30))
                self.assertEqual(get_command_status("inflight-legacy")["status"], "unknown")
                second = pool.submit(retry)
                self.assertTrue(retry_started.wait(5))
                self.assertFalse(second.done())
            finally:
                release.set()
            first.result(timeout=30)
            self.assertEqual(second.result(timeout=30), "COMMAND_RESULT_EXPIRED")
        self.assertEqual(get_command_status("inflight-legacy")["status"], "committed")
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account_id,))["balance"], 90)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM transactions WHERE source = 'manual'")["n"], 1)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = 'transaction'")["n"], 1)

    def test_preexisting_missed_dates_are_diagnosed_readonly_after_migration_for_all_account_types(self):
        account_ids = []
        for account_type in ("debit_card", "credit_card", "investment"):
            account_id = self.account(f"旧日期-{account_type}", account_type, 100)
            account_ids.append(account_id)
            for date in ("2026-08-31", "2026-09-01", "2026-09-28"):
                for direction in ("income", "expense"):
                    transactions.create_transaction(TransactionCreate(
                        account_id=account_id, amount=10, direction=direction, occurred_at=date,
                    ))
            voided = transactions.create_transaction(self.transaction(account_id, 10))["id"]
            with database.write_connection() as conn:
                self.remove_date_guard(conn, "accounts", "opened_at")
                conn.execute("UPDATE transactions SET voided_at = '2026-09-29T00:00:00' WHERE id = ?", (voided,))
                conn.execute("UPDATE transactions SET balance_applied = 0 WHERE account_id = ? AND source = 'manual'", (account_id,))
                field = "cash_available" if account_type == "investment" else "balance"
                conn.execute(f"UPDATE accounts SET opened_at = '20260901', {field} = 100 WHERE id = ?", (account_id,))
        with database.write_connection() as conn:
            conn.execute("DELETE FROM schema_migrations WHERE version >= 10")
            run_schema_migrations(conn, bool(database.DATABASE_URL))
            run_schema_migrations(conn, bool(database.DATABASE_URL))
        before = fingerprint(export_family_backup())
        report = accounts.reconcile_accounts()
        ledger = transactions.list_ledger(record_scope="all_records")
        for item in report["items"]:
            self.assertIn(item["account_id"], account_ids)
            self.assertEqual(item["actual"], 100)
            self.assertTrue(item["matches"])
            self.assertFalse(item["healthy"])
            self.assertEqual(item["history"]["status"], "complete")
            self.assertEqual(item["application"]["issue_count"], 4)
            self.assertEqual(len(item["application"]["issues"]), 5)
            self.assertFalse(item["reconstructable"])
        for row in (row for row in ledger if row["source"] == "manual"):
            if row["occurred_at"] == "2026-08-31":
                self.assertTrue(row["application"]["marker_consistent"])
            elif row["voided_at"]:
                self.assertFalse(row["application"]["requires_correction"])
            else:
                self.assertTrue(row["application"]["requires_correction"])
        with self.assertRaises(HTTPException):
            warehouse.preview_restore(export_family_backup())
        self.assertEqual(fingerprint(export_family_backup()), before)
        for account in report["items"]:
            balance = account["actual"]
            for issue in account["application"]["issues"]:
                if not issue["requires_correction"]:
                    with self.assertRaises(HTTPException):
                        transactions.correct_transaction_application(issue["transaction_id"], self.correction(balance))
                    continue
                key = f"matrix-correction-{issue['transaction_id']}"
                payload = self.correction(balance)
                first = transactions.correct_transaction_application(issue["transaction_id"], payload, idempotency_key=key)
                replay = transactions.correct_transaction_application(issue["transaction_id"], payload, idempotency_key=key)
                self.assertEqual(first, replay)
                balance += issue["correction_delta"]
                self.assertEqual(first["balance"], balance)
            self.assertEqual(balance, 100)
        for account in accounts.reconcile_accounts()["items"]:
            self.assertEqual(account["actual"], 100)
            self.assertTrue(account["matches"])
            self.assertEqual(account["application"]["status"], "voided_only")
            self.assertEqual(account["application"]["issue_count"], 0)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_events WHERE action = '更正流水余额应用'")["n"], 12)

    def test_correction_concurrent_replay_and_audit_survive_same_foreign_and_repeated_restore(self):
        account_id, transaction_id = self.seed_missed_application()
        payload = self.correction()

        def correct():
            with use_auth_context(self.auth_context):
                return transactions.correct_transaction_application(transaction_id, payload, idempotency_key="correct-once")

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: correct(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account_id,))["balance"], 90)
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM audit_events WHERE action = '更正流水余额应用'")["n"], 1)
        saved = export_family_backup()
        other = self.other_family()
        for context in (self.auth_context, other, other):
            with use_auth_context(context):
                restored = warehouse.restore_backup(self.restore_request(saved))
                maps = restored["id_mapping"]
                old = next(row for row in saved["data"]["audit_events"] if row["action"] == "更正流水余额应用")
                event = self.row("SELECT * FROM audit_events WHERE id = ?", (maps["audit_events"][old["id"]],))
                self.assertEqual(event["entity_id"], str(maps["transactions"][transaction_id]))
                for column, applied, balance in (("before_value", 0, 100), ("after_value", 1, 90)):
                    value = json.loads(event[column])
                    self.assertNotIn("_id_namespace", value)
                    self.assertEqual(value["transaction"]["id"], maps["transactions"][transaction_id])
                    self.assertEqual(value["transaction"]["account_id"], maps["accounts"][account_id])
                    self.assertEqual(value["account"]["id"], maps["accounts"][account_id])
                    self.assertEqual(value["account"]["family_id"], context.family_id)
                    self.assertEqual(value["transaction"]["member_id"], value["account"]["member_id"])
                    self.assertEqual(value["transaction"]["balance_applied"], applied)
                    self.assertEqual(Decimal(str(value["transaction"]["amount"])), 10)
                    self.assertEqual(Decimal(str(value["account"]["balance"])), balance)
                self.assertTrue(accounts.reconcile_accounts()["items"][0]["healthy"])
                saved = export_family_backup()
                account_id = maps["accounts"][account_id]
                transaction_id = maps["transactions"][transaction_id]

    def test_correction_conflict_audit_failure_and_cash_constraint_roll_back_every_fact(self):
        account_id, transaction_id = self.seed_missed_application()
        for reason in ("stale", "audit"):
            before = fingerprint(export_family_backup())
            with patch("audit.record_audit_event", side_effect=RuntimeError("audit unavailable")):
                with self.assertRaises(HTTPException if reason == "stale" else RuntimeError):
                    transactions.correct_transaction_application(
                        transaction_id, self.correction(99 if reason == "stale" else 100),
                        idempotency_key=f"failed-{reason}",
                    )
            self.assertEqual(fingerprint(export_family_backup()), before)
            self.assertIsNone(self.row("SELECT * FROM financial_commands WHERE command_key = ?", (f"failed-{reason}",)))
        investment, expense = self.seed_missed_application("investment")
        with database.write_connection() as conn:
            conn.execute("UPDATE accounts SET cash_available = 5 WHERE id = ?", (investment,))
        before = fingerprint(export_family_backup())
        with self.assertRaises(HTTPException):
            transactions.correct_transaction_application(expense, self.correction(5), idempotency_key="cash-constraint")
        self.assertEqual(fingerprint(export_family_backup()), before)
        self.assertIsNone(self.row("SELECT * FROM financial_commands WHERE command_key = 'cash-constraint'"))
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account_id,))["balance"], 100)

    def test_snapshot_upgrade_and_backup_restore_select_identical_records(self):
        self.account("旧快照兼容", balance=100)
        for version in (10, 11):
            with self.subTest(version=version):
                with database.write_connection() as conn:
                    self.remove_date_guard(conn, "snapshots", "snapshot_date")
                    conn.execute("DELETE FROM snapshots")
                    for member_id, date, amount in (
                        (None, "2026-08-01", 100), (None, "20260801", 200),
                        (self.auth_context.member_id, "20260801", 300),
                        (None, "20260802", 400),
                    ):
                        conn.execute(
                            "INSERT INTO snapshots (family_id, member_id, snapshot_date, asset_total, liability_total, net_worth, investment_value, cash_value, created_at) VALUES (?, ?, ?, ?, 0, ?, 0, ?, '2026-08-02T10:00:00')",
                            (self.auth_context.family_id, member_id, date, amount, amount, amount),
                        )
                saved = export_family_backup()
                original = fingerprint(saved)
                preview = warehouse.preview_restore(saved)
                with database.write_connection() as conn:
                    conn.execute("DELETE FROM schema_migrations WHERE version >= ?", (version,))
                    run_schema_migrations(conn, bool(database.DATABASE_URL))
                    run_schema_migrations(conn, bool(database.DATABASE_URL))
                migrated = export_family_backup()["data"]["snapshots"]
                self.assertEqual(len(migrated), 3)
                self.assertEqual(preview["counts"]["snapshots"], 3)
                self.assertEqual(preview["snapshot_compatibility"]["discarded_count"], 1)
                winner = preview["snapshot_compatibility"]["collisions"][0]["kept"]["id"]
                self.assertEqual(Decimal(next(row for row in migrated if row["id"] == winner)["net_worth"]), 200)
                restored = warehouse.restore_backup(self.restore_request(saved))
                for row in migrated:
                    actual = self.row("SELECT snapshot_date, net_worth FROM snapshots WHERE id = ?", (restored["id_mapping"]["snapshots"][row["id"]],))
                    self.assertEqual(actual["snapshot_date"], row["snapshot_date"])
                    self.assertEqual(Decimal(str(actual["net_worth"])), Decimal(row["net_worth"]))
                self.assertEqual(fingerprint(saved), original)
