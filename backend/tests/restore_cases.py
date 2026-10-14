"""Restore invariants shared by real SQLite and PostgreSQL workflow suites."""
import json
from pathlib import Path
from threading import Event
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4
from decimal import Decimal

from fastapi import HTTPException

import database
from application.backup import export_family_backup, fingerprint, prepare_family_restore
from application.commands import _command_jsonable
from application.ledger import statement_import_reference
from infrastructure.restore_store import insert_restored_rows
from routers import accounts, categories, transactions, warehouse
from routers.budgets import create_or_update_budget
from routers.goals import create_goal, create_goal_record
from routers.investments import create_investment_trade
from schemas import BudgetCreate, BudgetCategoryAllocation, GoalCreate, GoalMemberAllocation, GoalRecordCreate, HoldingCreate, InvestmentTradeCreate, MemberAmountAllocation
from schemas import CategoryCreate, StatementImportPayload, StatementImportRow, TransferCreate, ReversalCreate
from tenancy import AuthContext, use_auth_context


class RestoreWorkflows:
    def test_audit_payload_ids_follow_same_family_foreign_family_and_repeated_restores(self):
        account = self.account("审计投资", "investment", 1000)
        cash = self.account("审计现金")
        transfer = accounts.transfer_between_accounts(TransferCreate(
            from_account_id=account, to_account_id=cash, amount=20, occurred_at="2026-09-28",
        ))
        trade = create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account, name="审计标的", code="AUDIT",
                buy_price=100, current_price=100, quantity=1,
            ), trade_type="buy", quantity=1, price=100, occurred_at="2026-09-28",
        ))
        category = categories.create_category(CategoryCreate(name="审计预算", type="expense"))["id"]
        create_or_update_budget(BudgetCreate(
            month="2026-09", total_amount=100,
            categories=[BudgetCategoryAllocation(
                category_id=category, amount=100,
                member_allocations=[MemberAmountAllocation(member_id=self.auth_context.member_id, amount=100)],
            )],
        ))
        goal = create_goal(GoalCreate(
            name="审计目标", target_amount=1000,
            allocations=[GoalMemberAllocation(member_id=self.auth_context.member_id, target_amount=1000)],
        ))["id"]
        create_goal_record(goal, GoalRecordCreate(amount=10, recorded_at="2026-09-28"))
        deleted = transactions.create_transaction(self.transaction(cash, 5))["id"]
        transactions.delete_transaction(deleted)
        saved = export_family_backup()
        other = self.other_family()
        for context in (self.auth_context, other, other):
            with self.subTest(family=context.family_id), use_auth_context(context):
                restored = warehouse.restore_backup(self.restore_request(saved))
                maps = restored["id_mapping"]
                current = export_family_backup()
                events = {row["id"]: row for row in current["data"]["audit_events"]}
                for old in saved["data"]["audit_events"]:
                    event = events[maps["audit_events"][old["id"]]]
                    self.assertEqual(event["payload_version"], old["payload_version"])
                    for field in ("before_value", "after_value"):
                        if not old[field]:
                            continue
                        before, after = json.loads(old[field]), json.loads(event[field])
                        entity = old["entity_type"]

                        def assert_row(old_row, new_row, table, foreign_keys=()):
                            old_id = old_row["id"]
                            expected = maps[table].get(old_id, old_id if str(old_id).startswith("legacy:") else f"legacy:{old_id}")
                            self.assertEqual(new_row["id"], expected)
                            for key, target in foreign_keys:
                                if old_row.get(key) is not None:
                                    self.assertEqual(new_row[key], maps[target][old_row[key]])
                            if "family_id" in old_row:
                                self.assertEqual(new_row["family_id"], context.family_id)
                            if old_row.get("member_id") is not None:
                                self.assertEqual(new_row["member_id"], maps["family_members"][old_row["member_id"]])
                            for key in ("amount", "target_amount", "current_amount", "monthly_saving", "balance", "cash_available", "quantity", "buy_price", "price", "cash_amount"):
                                if key in old_row:
                                    self.assertEqual(new_row[key], old_row[key])

                        if entity in {"goal", "goal_record"}:
                            assert_row(before["goal"], after["goal"], "goals")
                            self.assertEqual(
                                str(after["goal"]["id"] if entity == "goal" else after.get("record", {}).get("id", event["entity_id"])),
                                event["entity_id"],
                            )
                            if entity == "goal":
                                for left, right in zip(before["allocations"], after["allocations"]):
                                    assert_row(left, right, "goal_allocations", [("goal_id", "goals")])
                            else:
                                assert_row(before["allocation"], after["allocation"], "goal_allocations", [("goal_id", "goals")])
                                if "record" in before:
                                    assert_row(before["record"], after["record"], "goal_records", [("goal_id", "goals")])
                        elif entity == "budget_plan":
                            assert_row(before, after, "budget_plans")
                            for key, table, links in (
                                ("categories", "budgets", [("category_id", "categories")]),
                                ("member_allocations", "budget_member_allocations", [("budget_plan_id", "budget_plans")]),
                                ("category_allocations", "budget_category_allocations", [("budget_plan_id", "budget_plans"), ("category_id", "categories")]),
                            ):
                                for left, right in zip(before[key], after[key]):
                                    assert_row(left, right, table, links)
                        elif entity == "investment_trade":
                            assert_row(before, after, "investment_trades", [("account_id", "accounts"), ("holding_id", "holdings")])
                            for key, table in (("account_before", "accounts"), ("account_after", "accounts"), ("holding_after", "holdings")):
                                assert_row(before[key], after[key], table)
                        elif entity == "transfer":
                            for left, right in zip(before, after):
                                if "direction" in left:
                                    assert_row(left, right, "transactions", [("account_id", "accounts")])
                                    self.assertEqual(right["reference_id"], event["entity_id"])
                                else:
                                    assert_row(left, right, "accounts")
                        elif entity == "transaction":
                            assert_row(before, after, "transactions", [("account_id", "accounts")])
                            self.assertEqual(after["id"], event["entity_id"])
                saved = current
        self.assertGreater(trade["id"], 0)
        self.assertTrue(transfer["reference_id"])

    def other_family(self):
        with database.write_connection() as conn:
            family = conn.execute(
                "INSERT INTO families(name, created_at, updated_at) VALUES ('另一家庭', 'now', 'now') RETURNING id",
            ).fetchone()["id"]
            member = conn.execute(
                "INSERT INTO family_members(member_key, family_id, display_name, role, created_at, updated_at) "
                "VALUES (?, ?, '另一成员', 'owner', 'now', 'now') RETURNING id",
                (uuid4().hex, family),
            ).fetchone()["id"]
        return AuthContext(
            user_id=0, username="", display_name="另一成员", family_id=family,
            family_name="另一家庭", member_id=member, role="owner", authenticated=False,
        )

    def restore_request(self, saved):
        preview = warehouse.preview_restore(saved)
        return warehouse.RestoreRequest(
            backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True,
        )

    def test_restore_replay_preserves_later_writes_and_recovery_copy(self):
        account_id = self.account("重试恢复", balance=100)
        saved = export_family_backup()
        transactions.create_transaction(self.transaction(account_id))
        request = self.restore_request(saved)
        restored = warehouse.restore_backup(request, idempotency_key="restore-retry")
        new_id = restored["id_mapping"]["accounts"][account_id]
        self.assertNotEqual(new_id, account_id)
        transactions.create_transaction(self.transaction(new_id, 7))
        copies = list(Path(database.DB_DIR).rglob("before-restore-*.json"))
        replay = warehouse.restore_backup(request, idempotency_key="restore-retry")
        self.assertEqual(replay, json.loads(json.dumps(_command_jsonable(restored))))
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (new_id,))["balance"], 93)
        self.assertEqual(list(Path(database.DB_DIR).rglob("before-restore-*.json")), copies)
        self.assertEqual(self.row(
            "SELECT status, invalidated FROM financial_commands WHERE command_key = 'restore-retry'",
        ), {"status": "committed", "invalidated": 0})
        recovery = json.loads(copies[0].read_text())
        self.assertEqual(Decimal(recovery["data"]["accounts"][0]["balance"]), 95)

    def test_restore_retry_racing_with_commit_returns_original_result(self):
        self.account("恢复提交竞态", balance=100)
        request = self.restore_request(export_family_backup())
        committed = None

        def commit_then_prepare(payload, expected):
            nonlocal committed
            if committed is None:
                # Simulate another request committing after the first replay
                # SELECT but before this request reads the book to prepare.
                with patch("routers.warehouse.prepare_family_restore", prepare_family_restore):
                    committed = warehouse.restore_backup(request, idempotency_key="restore-race")
            return prepare_family_restore(payload, expected)

        with patch("routers.warehouse.prepare_family_restore", side_effect=commit_then_prepare):
            replay = warehouse.restore_backup(request, idempotency_key="restore-race")
        self.assertEqual(replay, json.loads(json.dumps(_command_jsonable(committed))))
        self.assertEqual(len(list(Path(database.DB_DIR).rglob("before-restore-*.json"))), 1)

    def test_restore_failed_file_or_insert_leaves_entire_book_unchanged(self):
        account_id = self.account("原子恢复", balance=100)
        saved = export_family_backup()
        transactions.create_transaction(self.transaction(account_id), idempotency_key="old-write")
        request = self.restore_request(saved)
        before = fingerprint(export_family_backup())
        for failure in (
            patch("application.backup.os.fsync", side_effect=OSError("disk unavailable")),
            patch("application.backup.insert_restored_rows", side_effect=RuntimeError("insert failed")),
        ):
            copies_before = set(Path(database.DB_DIR).rglob("before-restore-*.json"))
            with failure, self.assertRaises((OSError, RuntimeError)):
                warehouse.restore_backup(request, idempotency_key="retry-failure")
            self.assertEqual(
                set(Path(database.DB_DIR).rglob("before-restore-*.json")),
                copies_before,
            )
            self.assertEqual(fingerprint(export_family_backup()), before)
            self.assertIsNone(self.row(
                "SELECT * FROM financial_commands WHERE command_key = 'retry-failure'",
            ))
            self.assertEqual(self.row(
                "SELECT status FROM financial_commands WHERE command_key = 'old-write'",
            )["status"], "committed")
        restored = warehouse.restore_backup(request, idempotency_key="retry-failure")
        self.assertEqual(restored["counts"]["accounts"], 1)

    def test_restore_preview_rejects_database_record_constraints(self):
        account_id = self.account(
            "非法持仓恢复", account_type="investment", balance=1000,
        )
        trade = create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account_id,
                name="非法持仓",
                code="INVALID",
                buy_price=10,
                current_price=10,
                quantity=1,
            ),
            trade_type="buy",
            quantity=1,
            price=10,
            occurred_at="2026-09-28",
        ))
        saved = export_family_backup()
        holding = next(
            row for row in saved["data"]["holdings"]
            if row["id"] == trade["holding_id"]
        )
        holding["quantity"] = Decimal("-1")

        with self.assertRaises(HTTPException) as rejected:
            warehouse.preview_restore(saved)
        self.assertEqual(rejected.exception.status_code, 422)
        self.assertIn("持仓数量不能为负数", rejected.exception.detail)
        self.assertEqual(
            list(Path(database.DB_DIR).rglob("before-restore-*.json")),
            [],
        )

    def test_restore_rechecks_fingerprint_after_preparation(self):
        account_id = self.account("准备期间变化", balance=100)
        saved = export_family_backup()
        request = self.restore_request(saved)

        def prepare_and_write(payload, expected):
            recovery = prepare_family_restore(payload, expected)
            transactions.create_transaction(self.transaction(account_id, 7))
            return recovery

        with patch("routers.warehouse.prepare_family_restore", side_effect=prepare_and_write):
            with self.assertRaises(HTTPException) as rejected:
                warehouse.restore_backup(request, idempotency_key="stale-restore")
        self.assertEqual(rejected.exception.code, "BUSINESS_CONFLICT")
        self.assertEqual(self.row("SELECT balance FROM accounts WHERE id = ?", (account_id,))["balance"], 93)
        self.assertIsNone(self.row("SELECT * FROM financial_commands WHERE command_key = 'stale-restore'"))
        self.assertEqual(
            list(Path(database.DB_DIR).rglob("before-restore-*.json")),
            [],
        )

    def test_restore_into_another_family_remaps_links_and_keeps_import_deduplication(self):
        source = self.account("来源", balance=100)
        target = self.account("目标")
        imported = StatementImportRow(
            account_id=source, amount=10, direction="expense", occurred_at="2026-09-28",
            merchant="商户", external_id="external-001",
        )
        transactions.import_statement_transactions(StatementImportPayload(rows=[imported]))
        transfer = accounts.transfer_between_accounts(TransferCreate(
            from_account_id=source, to_account_id=target, amount=20, occurred_at="2026-09-28",
        ))
        parent = categories.create_category(CategoryCreate(name="父分类", type="expense"))["id"]
        child = categories.create_category(CategoryCreate(name="子分类", type="expense"))["id"]
        with database.write_connection() as conn:
            conn.execute("UPDATE categories SET parent_id = ? WHERE id = ?", (parent, child))
        saved = export_family_backup()
        before_source = fingerprint(saved)
        other = self.other_family()
        with use_auth_context(other):
            restored = warehouse.restore_backup(self.restore_request(saved), idempotency_key="cross-restore")
            mapping = restored["id_mapping"]
            self.assertNotEqual(mapping["accounts"][source], source)
            new_reference = restored["transfer_reference_mapping"][transfer["reference_id"]]
            self.assertNotEqual(new_reference, transfer["reference_id"])
            self.assertEqual(self.row(
                "SELECT parent_id FROM categories WHERE id = ?", (mapping["categories"][child],),
            )["parent_id"], mapping["categories"][parent])
            imported.account_id = mapping["accounts"][source]
            result = transactions.import_statement_transactions(StatementImportPayload(rows=[imported], skip_duplicates=False))
            self.assertEqual(result["imported"], 0)
            self.assertEqual(result["skipped"], 1)
            accounts.reverse_transfer(new_reference, ReversalCreate(reason="恢复后撤销"))
            self.assertEqual(self.row(
                "SELECT balance FROM accounts WHERE id = ?", (mapping["accounts"][source],),
            )["balance"], 90)
            events = accounts.get_account_detail(mapping["accounts"][source])["activity"]
            transfer_event = next(event for event in events if event["action"] == "资金划转")
            self.assertEqual(transfer_event["entity_id"], new_reference)
            legs = json.loads(transfer_event["after_value"])
            self.assertEqual({leg["account_id"] for leg in legs}, set(mapping["accounts"].values()))
            keys = [row["member_key"] for row in export_family_backup()["members"]]
            self.assertTrue(set(keys).isdisjoint(row["member_key"] for row in saved["members"]))
        self.assertEqual(fingerprint(export_family_backup()), before_source)
        # Source family still deduplicates against its own account.
        self.assertIsNotNone(self.row(
            "SELECT id FROM transactions WHERE account_id = ? AND reference_id = ?",
            (source, statement_import_reference(imported, str(source))),
        ))

    def test_foreign_restore_does_not_claim_an_unused_global_member_key(self):
        self.account("离线来源", balance=100)
        saved = export_family_backup()
        for member in saved["members"]:
            member["member_key"] = uuid4().hex
        source_keys = {member["member_key"] for member in saved["members"]}
        for _ in range(2):
            other = self.other_family()
            with use_auth_context(other):
                warehouse.restore_backup(self.restore_request(saved))
                target_keys = {member["member_key"] for member in export_family_backup()["members"]}
                self.assertTrue(target_keys.isdisjoint(source_keys))
            # Neither family claims the same global key, so imports cannot
            # block each other on its unique index even before the first commit.
            for key in source_keys:
                self.assertIsNone(self.row(
                    "SELECT id FROM family_members WHERE member_key = ?", (key,),
                ))

    def test_postgres_restore_does_not_block_other_family_or_mvcc_reads(self):
        if not database.DATABASE_URL:
            self.skipTest("PostgreSQL MVCC/advisory-lock concurrency")
        self.account("家庭A", balance=100)
        saved_a = export_family_backup()
        request_a = self.restore_request(saved_a)
        other = self.other_family()
        with use_auth_context(other):
            self.account("家庭B", balance=200)
            request_b = self.restore_request(export_family_backup())
        entered, release, same_family_started = Event(), Event(), Event()

        def paused_insert(conn, payload):
            if payload["family_id"] == self.auth_context.family_id:
                entered.set()
                if not release.wait(10):
                    raise RuntimeError("test coordination timed out")
            return insert_restored_rows(conn, payload)

        def run(context, operation):
            with use_auth_context(context):
                return operation()

        def same_family_write():
            same_family_started.set()
            return categories.create_category(CategoryCreate(name="等待恢复", type="expense"))

        with patch("application.backup.insert_restored_rows", side_effect=paused_insert):
            with ThreadPoolExecutor(max_workers=3) as executor:
                a = executor.submit(run, self.auth_context, lambda: warehouse.restore_backup(request_a))
                try:
                    self.assertTrue(entered.wait(5))
                    queued = executor.submit(run, self.auth_context, same_family_write)
                    self.assertTrue(same_family_started.wait(5))
                    b = executor.submit(run, other, lambda: warehouse.restore_backup(request_b))
                    self.assertEqual(b.result(timeout=5)["counts"]["accounts"], 1)
                    # A's uncommitted deletes cannot leak into reader snapshots.
                    self.assertEqual(fingerprint(export_family_backup()), fingerprint(saved_a))
                    self.assertFalse(queued.done())
                finally:
                    release.set()
                self.assertEqual(a.result(timeout=5)["counts"]["accounts"], 1)
                self.assertGreater(queued.result(timeout=5)["id"], 0)
        self.assertGreater(self.account("序列继续增长", balance=1), 0)
