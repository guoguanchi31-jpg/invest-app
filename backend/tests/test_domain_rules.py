"""Pure rules and architectural guards: no database fixture required."""

import os
import tempfile
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from architecture_check import validate_architecture
from domain.accounting import (
    AccountingConflict,
    account_balance_deltas,
    plan_balance_reconciliation,
    validate_balance_changes,
)
from domain.calendar import business_month, business_today
from domain.dates import canonical_business_date, date_on_or_after, stored_business_date
from snapshot_scheduler import seconds_until_next_snapshot
from domain.audit_payloads import remap_audit_payload
from domain.reconciliation import (
    account_history,
    transaction_application_diagnostics,
)
from domain.snapshot_compatibility import normalize_legacy_snapshot_rows
from domain.transfers import recipient_rounding_is_valid, transfer_valuation
from tests.clock import freeze_business_time


class AuditPayloadTests(unittest.TestCase):
    def test_transaction_correction_maps_both_rows_and_preserves_markers_and_money(self):
        source = {
            "transaction": {"id": 9, "account_id": 7, "member_id": 1, "balance_applied": 0, "amount": "10.00"},
            "account": {"id": 7, "member_id": 1, "family_id": 1, "balance": "100.00"},
        }
        maps = {"transactions": {9: 19}, "accounts": {7: 17}, "family_members": {1: 11}}
        mapped = remap_audit_payload(source, "transaction", 1, maps, {}, 2)
        self.assertEqual(mapped["transaction"], {
            "id": 19, "account_id": 17, "member_id": 11, "balance_applied": 0, "amount": "10.00",
        })
        self.assertEqual(mapped["account"], {"id": 17, "member_id": 11, "family_id": 2, "balance": "100.00"})
        next_maps = {"transactions": {19: 29}, "accounts": {17: 27}, "family_members": {11: 21}}
        again = remap_audit_payload(mapped, "transaction", 1, next_maps, {}, 3)
        self.assertEqual(again["transaction"]["account_id"], 27)
        self.assertEqual(again["account"]["id"], 27)
        self.assertEqual(again["transaction"]["balance_applied"], 0)

    def test_unknown_versions_and_shapes_keep_historical_namespace_on_repeated_restore(self):
        source = {"id": 1, "goal": {"id": 1}, "amount": "123.45"}
        maps = {"goals": {1: 999}}
        for version, entity in ((9, "goal"), (1, "future_entity")):
            with self.subTest(version=version, entity=entity):
                result = remap_audit_payload(source, entity, version, maps, {}, 2)
                self.assertEqual(result["_id_namespace"], "historical")
                self.assertEqual(result["value"], source)
                self.assertEqual(remap_audit_payload(result, entity, version, maps, {}, 3), result)
        nested = {"id": 1, "future_structure": {"id": 1}, "amount": "123.45"}
        result = remap_audit_payload(nested, "goal", 1, maps, {}, 2)
        self.assertEqual(result["id"], 999)
        self.assertEqual(result["future_structure"]["_id_namespace"], "historical")
        self.assertEqual(result["amount"], "123.45")

    def test_legacy_aggregate_mapping_and_deleted_ids_are_unambiguous(self):
        source = {
            "goal": {"id": 1, "family_id": 1},
            "allocation": {"id": 4, "goal_id": 1, "member_id": 2},
            "record": {"id": 8, "goal_id": 1, "member_id": 2, "amount": "10.20"},
        }
        maps = {"goals": {1: 9}, "goal_allocations": {4: 20}, "family_members": {2: 10}}
        mapped = remap_audit_payload(source, "goal_record", 0, maps, {}, 3)
        self.assertEqual(mapped["goal"], {"id": 9, "family_id": 3})
        self.assertEqual(mapped["allocation"], {"id": 20, "goal_id": 9, "member_id": 10})
        self.assertEqual(mapped["record"]["id"], "legacy:8")
        mapped = remap_audit_payload(mapped, "goal_record", 0, {}, {}, 4)
        self.assertEqual(mapped["record"]["id"], "legacy:8")
        empty_record = {**source, "record": None}
        self.assertIsNone(remap_audit_payload(empty_record, "goal_record", 0, maps, {}, 3)["record"])


class HistoryEvidenceTests(unittest.TestCase):
    def test_opening_requires_explicit_basis_date_and_one_active_fact(self):
        account = {"type": "debit_card", "is_liability": 0, "history_basis": "opening_transaction", "opened_at": "2026-09-01"}
        opening = {"source": "opening", "direction": "income", "amount": 100, "occurred_at": "2026-09-01"}
        self.assertEqual(account_history(account, [opening])["status"], "complete")
        for facts in (
            [], [opening, opening], [{**opening, "voided_at": "now"}],
            [{**opening, "balance_applied": 0}], [{**opening, "occurred_at": "2026-09-02"}],
            [{**opening, "amount": 0}], [{**opening, "direction": "invalid"}],
        ):
            self.assertEqual(account_history(account, facts)["status"], "incomplete")
        self.assertEqual(account_history({**account, "history_basis": "unknown"}, [opening])["status"], "incomplete")
        self.assertEqual(account_history({**account, "opened_at": None}, [opening])["status"], "incomplete")
        account.pop("is_liability")  # Old backup may omit this SQL-defaulted column.
        self.assertEqual(account_history(account, [opening])["baseline_amount"], 100)

    def test_application_diagnostics_separate_dates_voids_and_account_semantics(self):
        transactions = [
            {
                "id": 1, "source": "manual", "direction": "expense", "amount": 5,
                "occurred_at": "2026-08-31", "balance_applied": 0,
            },
            {
                "id": 2, "source": "manual", "direction": "income", "amount": 7,
                "occurred_at": "2026-09-01", "balance_applied": 0,
            },
            {
                "id": 3, "source": "manual", "direction": "expense", "amount": 10,
                "occurred_at": "2026-09-28", "balance_applied": 0,
            },
            {
                "id": 4, "source": "manual", "direction": "expense", "amount": 20,
                "occurred_at": "2026-09-28", "balance_applied": 0,
                "voided_at": "2026-09-29T00:00:00",
            },
        ]
        ordinary = {
            "id": 1, "type": "debit_card", "is_liability": 0,
            "opened_at": "2026-09-01",
        }
        result = transaction_application_diagnostics(ordinary, transactions)
        self.assertEqual(result["status"], "inconsistent")
        self.assertEqual(result["issue_count"], 2)
        self.assertEqual(
            [item["transaction_id"] for item in result["issues"]],
            [2, 3, 4],
        )
        self.assertFalse(result["issues"][-1]["requires_correction"])
        self.assertEqual(result["issues"][0]["correction_delta"], 7)
        self.assertEqual(result["issues"][1]["correction_delta"], -10)

        liability = transaction_application_diagnostics(
            {**ordinary, "type": "credit_card", "is_liability": 1},
            [transactions[2]],
        )
        investment = transaction_application_diagnostics(
            {**ordinary, "type": "investment"},
            [transactions[2]],
        )
        self.assertEqual(liability["issues"][0]["correction_delta"], 10)
        self.assertEqual(investment["issues"][0]["correction_delta"], -10)


class SnapshotCompatibilityTests(unittest.TestCase):
    def test_only_legacy_date_collisions_are_deduplicated_deterministically(self):
        rows = [
            {
                "id": 1, "family_id": 1, "member_id": None,
                "snapshot_date": "2026-10-01",
                "created_at": "2026-10-01T10:00:00",
            },
            {
                "id": 2, "family_id": 1, "member_id": None,
                "snapshot_date": "20261001",
                "created_at": "2026-10-01T11:00:00",
            },
            {
                "id": 3, "family_id": 1, "member_id": 7,
                "snapshot_date": "20261001",
                "created_at": "2026-10-01T12:00:00",
            },
            {
                "id": 4, "family_id": 1, "member_id": None,
                "snapshot_date": "20261002",
                "created_at": "2026-10-02T10:00:00",
            },
        ]
        normalized, report = normalize_legacy_snapshot_rows(rows)
        self.assertEqual([row["id"] for row in normalized], [2, 3, 4])
        self.assertEqual(
            [row["snapshot_date"] for row in normalized],
            ["2026-10-01", "2026-10-01", "2026-10-02"],
        )
        self.assertEqual(report["discarded_count"], 1)
        self.assertEqual(report["collisions"][0]["kept"]["id"], 2)
        self.assertEqual(report["collisions"][0]["discarded"][0]["id"], 1)

        repeated, repeated_report = normalize_legacy_snapshot_rows(normalized)
        self.assertEqual(repeated, normalized)
        self.assertEqual(repeated_report["discarded_count"], 0)

    def test_same_timestamp_uses_id_and_same_format_duplicates_are_not_relaxed(self):
        tie = [
            {
                "id": 10, "family_id": 1, "member_id": None,
                "snapshot_date": "2026-10-01", "created_at": "same",
            },
            {
                "id": 11, "family_id": 1, "member_id": None,
                "snapshot_date": "20261001", "created_at": "same",
            },
        ]
        normalized, report = normalize_legacy_snapshot_rows(tie)
        self.assertEqual([row["id"] for row in normalized], [11])
        self.assertEqual(report["collisions"][0]["kept"]["id"], 11)

        duplicates = [
            {**tie[0], "id": 20},
            {**tie[0], "id": 21},
        ]
        untouched, duplicate_report = normalize_legacy_snapshot_rows(duplicates)
        self.assertEqual([row["id"] for row in untouched], [20, 21])
        self.assertEqual(duplicate_report["discarded_count"], 0)


class BusinessCalendarTests(unittest.TestCase):
    def test_fixture_clock_changes_month_only_at_the_business_boundary(self):
        with patch.dict(os.environ, {"BUSINESS_TIMEZONE": "Asia/Shanghai"}):
            for instant, month in (("2026-09-30T15:59:59+00:00", "2026-09"), ("2026-09-30T16:00:00+00:00", "2026-10")):
                with freeze_business_time(instant):
                    self.assertEqual(business_month(), month)
    def test_shanghai_boundaries_are_independent_of_server_timezone(self):
        cases = [
            ("2026-09-30T15:59:59+00:00", "2026-09-30"),
            ("2026-09-30T16:00:00+00:00", "2026-10-01"),
            ("2026-09-30T23:59:59+00:00", "2026-10-01"),
            ("2026-10-01T00:00:00+00:00", "2026-10-01"),
            ("2026-12-31T16:00:00+00:00", "2027-01-01"),
            ("2028-02-28T16:00:00+00:00", "2028-02-29"),
            ("2028-02-29T16:00:00+00:00", "2028-03-01"),
        ]
        with patch.dict(os.environ, {"BUSINESS_TIMEZONE": "Asia/Shanghai"}):
            for instant, expected in cases:
                with self.subTest(instant=instant):
                    now = datetime.fromisoformat(instant)
                    self.assertEqual(business_today(now).isoformat(), expected)
                    self.assertEqual(business_month(now), expected[:7])

    def test_explicit_timezone_controls_date_and_scheduler(self):
        instant = datetime.fromisoformat("2026-09-30T16:00:00+00:00")
        with patch.dict(os.environ, {"BUSINESS_TIMEZONE": "Asia/Shanghai"}):
            self.assertEqual(seconds_until_next_snapshot(instant), 300)
        with patch.dict(os.environ, {"BUSINESS_TIMEZONE": "America/Los_Angeles"}):
            self.assertEqual(business_today(instant).isoformat(), "2026-09-30")
            self.assertEqual(seconds_until_next_snapshot(instant), 15 * 3600 + 300)


class BusinessDateTests(unittest.TestCase):
    def test_new_inputs_are_strict_but_legacy_compact_dates_are_unambiguous(self):
        self.assertEqual(
            canonical_business_date(" 2026-09-01 "),
            "2026-09-01",
        )
        for invalid in ("20260901", "2026-9-1", "2026-02-30", "09/01/2026"):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                canonical_business_date(invalid)
        self.assertEqual(
            stored_business_date("20260901", nullable=False),
            "2026-09-01",
        )
        self.assertIsNone(stored_business_date("", nullable=True))

    def test_date_comparison_is_semantic_for_legacy_storage(self):
        self.assertTrue(date_on_or_after("2026-09-02", "20260901"))
        self.assertFalse(date_on_or_after("2026-08-31", "20260901"))


class AccountingRuleTests(unittest.TestCase):
    account = {
        "id": 1, "name": "投资", "type": "investment", "is_liability": 0,
        "balance": Decimal("0"), "cash_available": Decimal("10"),
        "exchange_rate_to_base": Decimal("7.25"),
    }

    def test_final_net_change_is_checked_instead_of_transient_negative_state(self):
        deltas = account_balance_deltas([
            (self.account, "expense", Decimal("11.10")),
            (self.account, "income", Decimal("1.10")),
        ])
        self.assertEqual(deltas, {1: Decimal("-10.00")})
        validate_balance_changes({1: self.account}, deltas)
        with self.assertRaises(AccountingConflict):
            validate_balance_changes({1: self.account}, {1: Decimal("-10.01")})

    def test_cash_correction_preserves_decimal_and_conflict_check_without_sql(self):
        result = plan_balance_reconciliation(
            self.account, actual_balance="9.99", expected_balance="10.00",
        )
        self.assertEqual(result["difference"], Decimal("-0.01"))
        self.assertEqual(result["base_amount"], Decimal("0.07"))
        self.assertEqual(result["direction"], "expense")
        self.assertEqual(self.account["cash_available"], Decimal("10"))
        with self.assertRaisesRegex(AccountingConflict, "已变化"):
            plan_balance_reconciliation(
                self.account, actual_balance="9.99", expected_balance="9",
            )

    def test_architecture_guard_rejects_sql_even_without_database_import(self):
        with tempfile.TemporaryDirectory() as folder:
            module = Path(folder) / "rule.py"
            for code in (
                "def rule(conn):\n    return conn.execute('SELECT 1')\n",
                "def rule(execute):\n    return execute('SELECT 1')\n",
                "from sqlite3 import connect\n",
            ):
                with self.subTest(code=code):
                    module.write_text(code)
                    with patch("architecture_check._modules", return_value={"domain.rule": module}):
                        self.assertTrue(validate_architecture())


class TransferValuationTests(unittest.TestCase):
    def test_same_currency_keeps_source_rate_even_when_base_rounds_to_zero(self):
        base, recipient_rate = transfer_valuation(
            "1", "0.0048", "1", same_currency=True,
        )
        self.assertEqual(base, Decimal("0.00"))
        self.assertEqual(recipient_rate, Decimal("0.0048000000"))

    def test_cross_currency_rate_uses_unrounded_source_value(self):
        base, recipient_rate = transfer_valuation(
            "10000", "7.1234567891", "250000000", same_currency=False,
        )
        self.assertEqual(base, Decimal("71234.57"))
        self.assertEqual(recipient_rate, Decimal("0.0002849383"))
        legs = [
            {
                "family_id": 1, "account_id": 1, "source": "transfer",
                "direction": "expense", "amount": Decimal("10000"),
                "exchange_rate_to_base": Decimal("7.1234567891"),
                "base_amount": base, "occurred_at": "2026-09-28", "voided_at": None,
            },
            {
                "family_id": 1, "account_id": 2, "source": "transfer",
                "direction": "income", "amount": Decimal("250000000"),
                "exchange_rate_to_base": recipient_rate,
                "base_amount": base, "occurred_at": "2026-09-28", "voided_at": None,
            },
        ]
        self.assertTrue(recipient_rounding_is_valid(legs[1], legs))
        self.assertFalse(recipient_rounding_is_valid(
            {**legs[1], "base_amount": Decimal("71234.60")},
            [legs[0], {**legs[1], "base_amount": Decimal("71234.60")}],
        ))
