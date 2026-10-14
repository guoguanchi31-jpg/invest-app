"""Baseline evidence must survive ordinary writes, migrations and restores."""
from copy import deepcopy

from fastapi import HTTPException

import database
from application.backup import export_family_backup
from routers import accounts, warehouse
from schemas import BalanceAdjustmentCreate


class HistoryWorkflows:
    def test_history_proof_is_independent_of_balance_matches_and_adjustments(self):
        legacy = self.account("缺期初历史", balance=1000)
        with database.write_connection() as conn:
            conn.execute("DELETE FROM transactions WHERE account_id = ?", (legacy,))
            conn.execute("UPDATE accounts SET history_basis = 'unknown' WHERE id = ?", (legacy,))
        accounts.adjust_account_balance(legacy, BalanceAdjustmentCreate(
            actual_balance=1050, expected_balance=1000,
            occurred_at="2026-09-28", reason="仅核对当前余额",
        ))
        item = accounts.reconcile_accounts()["items"][0]
        self.assertEqual((item["expected"], item["difference"]), (50, 1000))
        self.assertFalse(item["reconstructable"])
        self.assertEqual(item["history"]["status"], "incomplete")
        self.assertIsNotNone(item["limitation"])
        # Even a coincidental match is not proof of a historical baseline.
        with database.write_connection() as conn:
            conn.execute("UPDATE accounts SET balance = 50 WHERE id = ?", (legacy,))
        item = accounts.reconcile_accounts()["items"][0]
        self.assertTrue(item["matches"])
        self.assertFalse(item["reconstructable"])

    def test_explicit_baselines_cover_zero_negative_liability_and_investment_cash(self):
        ids = []
        for account_type, amount in (
            ("debit_card", 0), ("debit_card", -100), ("credit_card", 100),
            ("credit_card", -100), ("investment", 100),
        ):
            ids.append((self.account(f"{account_type}-{amount}", account_type, amount), amount))
        by_id = {item["account_id"]: item for item in accounts.reconcile_accounts()["items"]}
        for account_id, amount in ids:
            item = by_id[account_id]
            self.assertTrue(item["matches"])
            self.assertTrue(item["reconstructable"])
            self.assertEqual(item["history"]["baseline_amount"], amount)
            self.assertEqual(item["history"]["source"], "opening_transaction" if amount else "zero_opening")
        with database.write_connection() as conn:
            conn.execute("UPDATE accounts SET balance = balance + 10 WHERE id = ?", (ids[1][0],))
        item = next(item for item in accounts.reconcile_accounts()["items"] if item["account_id"] == ids[1][0])
        self.assertFalse(item["matches"])
        self.assertTrue(item["reconstructable"])

    def test_backup_requires_evidence_and_legacy_missing_metadata_stays_unknown(self):
        account_id = self.account("期初备份", balance=1000)
        saved = export_family_backup()
        self.assertEqual(saved["version"], 8)
        saved["data"]["accounts"][0].pop("is_liability")
        self.assertEqual(warehouse.preview_restore(saved)["counts"]["accounts"], 1)
        for invalid_basis in ("invented", "zero_opening"):
            saved["data"]["accounts"][0]["history_basis"] = invalid_basis
            with self.assertRaises(HTTPException) as rejected:
                warehouse.preview_restore(saved)
            self.assertEqual(rejected.exception.status_code, 422)
        saved["data"]["accounts"][0]["history_basis"] = "opening_transaction"
        saved["data"]["transactions"][0]["voided_at"] = "2026-09-28"
        with self.assertRaises(HTTPException):
            warehouse.preview_restore(saved)
        saved = export_family_backup()
        saved["version"] = 7
        for row in saved["data"]["accounts"]:
            row.pop("history_basis")
        for row in saved["data"]["audit_events"]:
            row.pop("payload_version")
        restored = warehouse.restore_backup(self.restore_request(saved))
        new_id = restored["id_mapping"]["accounts"][account_id]
        item = next(item for item in accounts.reconcile_accounts()["items"] if item["account_id"] == new_id)
        self.assertTrue(item["matches"])
        self.assertFalse(item["reconstructable"])
        self.assertEqual(item["history"]["source"], "unknown")

    def test_backup_requires_explicit_history_to_match_persisted_account_state(self):
        ordinary = self.account("余额不一致", balance=100)
        investment = self.account(
            "现金不一致", account_type="investment", balance=200,
        )
        saved = export_family_backup()
        for account_id, field in (
            (ordinary, "balance"),
            (investment, "cash_available"),
        ):
            with self.subTest(field=field):
                invalid = deepcopy(saved)
                row = next(
                    item for item in invalid["data"]["accounts"]
                    if item["id"] == account_id
                )
                row[field] = "999.00"
                with self.assertRaises(HTTPException) as rejected:
                    warehouse.preview_restore(invalid)
                self.assertEqual(rejected.exception.status_code, 422)
                self.assertIn("账户余额与可重建历史不一致", rejected.exception.detail)

    def test_backup_defaults_missing_investment_liability_before_domain_validation(self):
        investment = self.account(
            "旧版投资账户", account_type="investment", balance=100,
        )
        saved = export_family_backup()
        row = next(item for item in saved["data"]["accounts"] if item["id"] == investment)
        row.pop("is_liability")
        preview = warehouse.preview_restore(saved)
        self.assertEqual(preview["counts"]["accounts"], 1)

    def test_backup_normalizes_only_unambiguous_legacy_business_dates(self):
        account_id = self.account("紧凑日期备份", balance=100)
        saved = export_family_backup()
        account = next(
            row for row in saved["data"]["accounts"] if row["id"] == account_id
        )
        opening = next(
            row for row in saved["data"]["transactions"]
            if row["account_id"] == account_id and row["source"] == "opening"
        )
        account["opened_at"] = "20260901"
        opening["occurred_at"] = "20260901"
        self.assertEqual(
            warehouse.preview_restore(saved)["counts"]["accounts"],
            1,
        )
        restored = warehouse.restore_backup(self.restore_request(saved))
        restored_id = restored["id_mapping"]["accounts"][account_id]
        self.assertEqual(
            accounts.get_account_detail(restored_id)["account"]["opened_at"],
            "2026-09-01",
        )

        invalid = deepcopy(saved)
        next(
            row for row in invalid["data"]["accounts"] if row["id"] == account_id
        )["opened_at"] = "09/01/2026"
        with self.assertRaises(HTTPException) as rejected:
            warehouse.preview_restore(invalid)
        self.assertEqual(rejected.exception.status_code, 422)

    def test_backup_collapses_only_legacy_snapshot_date_collisions(self):
        self.account("快照兼容账户", balance=100)
        saved = export_family_backup()
        source = deepcopy(saved["data"]["snapshots"][0])
        source.update({
            "id": 1001,
            "snapshot_date": "2026-08-01",
            "net_worth": 100,
            "asset_total": 100,
            "cash_value": 100,
            "created_at": "2026-10-01T10:00:00",
        })
        newer = deepcopy(source)
        newer.update({
            "id": 1002,
            "snapshot_date": "20260801",
            "net_worth": 200,
            "asset_total": 200,
            "cash_value": 200,
            "created_at": "2026-10-01T11:00:00",
        })
        saved["data"]["snapshots"] = [source, newer]

        preview = warehouse.preview_restore(saved)
        compatibility = preview["snapshot_compatibility"]
        self.assertEqual(preview["counts"]["snapshots"], 1)
        self.assertEqual(compatibility["discarded_count"], 1)
        self.assertEqual(compatibility["collisions"][0]["kept"]["id"], 1002)
        self.assertEqual(
            compatibility["collisions"][0]["discarded"][0]["id"],
            1001,
        )
        restored = warehouse.restore_backup(self.restore_request(saved))
        restored_snapshot = self.row(
            "SELECT snapshot_date, net_worth FROM snapshots "
            "WHERE id = ?",
            (restored["id_mapping"]["snapshots"][1002],),
        )
        self.assertEqual(restored_snapshot, {
            "snapshot_date": "2026-08-01",
            "net_worth": 200,
        })

        duplicate = deepcopy(saved)
        duplicate["data"]["snapshots"][1]["snapshot_date"] = "2026-08-01"
        with self.assertRaises(HTTPException) as rejected:
            warehouse.preview_restore(duplicate)
        self.assertEqual(rejected.exception.status_code, 422)
        self.assertIn("snapshots 存在重复记录", rejected.exception.detail)

        duplicate_id = deepcopy(saved)
        duplicate_id["data"]["snapshots"][1]["id"] = 1001
        with self.assertRaises(HTTPException) as rejected:
            warehouse.preview_restore(duplicate_id)
        self.assertEqual(rejected.exception.status_code, 422)
        self.assertIn("snapshots ID 无效或重复", rejected.exception.detail)
