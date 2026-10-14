import asyncio
import json
import sqlite3
import sys
import unittest
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
import audit
import application.commands as command_application
from domain.calendar import business_today
import application.ledger as ledger_application
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from backup import fingerprint, prepare_family_restore, restore, snapshot, validate_backup
from jobs.financial_command_retention import expire_command_responses
from routers import transactions
from routers.accounts import (
    adjust_account_balance,
    create_account,
    delete_account,
    reconcile_accounts,
    reverse_transfer,
    transfer_between_accounts,
)
from routers.goals import create_goal, create_goal_record, delete_goal, update_goal, update_goal_status
from routers.investments import (
    add_holding,
    create_investment_trade,
    reverse_investment_trade,
    update_investment_cash,
)
from routers.warehouse import RestoreRequest, preview_restore, refresh_warehouse, restore_backup
from schemas import (
    AccountCreate, BalanceAdjustmentCreate, GoalCreate, GoalRecordCreate, GoalStatusUpdate, GoalUpdate,
    HoldingCreate, InvestmentCashUpdate, InvestmentTradeCreate, ReversalCreate,
    StatementImportPayload, StatementImportRow, TransactionCreate,
    TransactionApplicationCorrection,
    TransferCreate,
)
from services import get_accounts_overview, get_holdings, get_investment_summary, refresh_warehouse_snapshot
from snapshot_scheduler import seconds_until_next_snapshot
from tests import test_finance_regressions as finance_tests
from tenancy import use_auth_context


class IntegrityRegressions(unittest.TestCase):
    setUp = finance_tests.FinanceRegressionTests.setUp
    tearDown = finance_tests.FinanceRegressionTests.tearDown
    add_account = finance_tests.FinanceRegressionTests.add_account
    get_account = finance_tests.FinanceRegressionTests.get_account
    owner_member_id = finance_tests.FinanceRegressionTests.owner_member_id
    goal_payload = finance_tests.FinanceRegressionTests.goal_payload

    def row(self, query, params=()):
        conn = database.get_connection()
        try:
            return dict(conn.execute(query, params).fetchone())
        finally:
            conn.close()

    def expense(self, account):
        return TransactionCreate(account_id=account, amount=100, direction="expense", occurred_at="2026-09-28")

    def holding(self, account, currency="USD"):
        return add_holding(HoldingCreate(
            account_id=account, name="测试", code="TEST", buy_price=10, current_price=20,
            quantity=10, currency=currency, exchange_rate_to_base=7,
        ))["id"]

    def trade(self, holding, **kwargs):
        return InvestmentTradeCreate(holding_id=holding, trade_type="buy", quantity=5, price=5,
                                     fee=1, occurred_at="2026-09-01", **kwargs)

    def parallel(self, *operations):
        start = Barrier(len(operations))
        def run(operation):
            start.wait()
            with use_auth_context(self.auth_context):
                try:
                    return operation()
                except HTTPException as exc:
                    return exc.status_code
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return [future.result() for future in [pool.submit(run, op) for op in operations]]

    def test_same_currency_transfer_uses_original_amount_and_backup_consistent_fx(self):
        source = self.add_account("美元A", balance=1000, currency="USD", exchange_rate=7)
        target = self.add_account("美元B", currency="USD", exchange_rate=8)
        result = transfer_between_accounts(TransferCreate(
            from_account_id=source, to_account_id=target, amount=100, occurred_at="2026-09-28",
        ))
        self.assertEqual(result["to_amount"], 100)
        self.assertEqual(self.get_account(source)["balance"], 900)
        self.assertEqual(self.get_account(target)["balance"], 100)
        conn = database.get_connection()
        saved = snapshot(conn)
        validate_backup(conn, saved)
        conn.close()
        legs = saved["data"]["transactions"]
        self.assertEqual([row["base_amount"] for row in legs], ["700.0", "700.0"])
        self.assertEqual(
            [row["exchange_rate_to_base"] for row in legs],
            ["7.0", "7.0"],
        )
        reverse_transfer(result["reference_id"], ReversalCreate(reason="更正"))
        self.assertEqual(self.get_account(source)["balance"], 1000)
        self.assertEqual(self.get_account(target)["balance"], 0)

    def test_cross_currency_requires_actual_receipt_and_captures_it(self):
        source = self.add_account("人民币", balance=1000)
        target = self.add_account("美元", currency="USD", exchange_rate=8)
        payload = TransferCreate(from_account_id=source, to_account_id=target, amount=700, occurred_at="2026-09-28")
        with self.assertRaises(HTTPException):
            transfer_between_accounts(payload)
        self.assertEqual(self.get_account(source)["balance"], 1000)
        transfer_between_accounts(payload.model_copy(update={"to_amount": 90}))
        self.assertEqual(self.get_account(target)["balance"], 90)
        row = self.row("SELECT * FROM transactions WHERE direction = 'income'")
        self.assertAlmostEqual(row["exchange_rate_to_base"], 700 / 90)
        self.assertEqual(row["base_amount"], 700)

    def test_transfer_fx_extremes_export_validate_and_restore(self):
        tiny_source = self.add_account(
            "韩元A", balance=1, currency="KRW", exchange_rate=0.0048,
        )
        tiny_target = self.add_account(
            "韩元B", currency="KRW", exchange_rate=0.0048,
        )
        transfer_between_accounts(TransferCreate(
            from_account_id=tiny_source,
            to_account_id=tiny_target,
            amount=1,
            occurred_at="2026-09-28",
        ))
        usd = self.add_account(
            "高精度美元", balance=20000, currency="USD",
            exchange_rate=Decimal("7.1234567891"),
        )
        vnd = self.add_account("越南盾", currency="VND", exchange_rate=0.0003)
        transfer_between_accounts(TransferCreate(
            from_account_id=usd,
            to_account_id=vnd,
            amount=10000,
            to_amount=250000000,
            occurred_at="2026-09-28",
        ))
        conn = database.get_connection()
        saved = snapshot(conn)
        validate_backup(conn, saved)
        income = next(
            row for row in saved["data"]["transactions"]
            if row["account_id"] == vnd and row["source"] == "transfer"
        )
        tampered = deepcopy(saved)
        tampered_income = next(
            row for row in tampered["data"]["transactions"]
            if row["id"] == income["id"]
        )
        tampered_income["base_amount"] = "71234.60"
        with self.assertRaises(HTTPException):
            validate_backup(conn, tampered)
        conn.close()
        prepared = prepare_family_restore(saved, fingerprint(saved))
        with database.write_connection() as write:
            restored = restore(
                write, saved, fingerprint(saved), prepared=prepared,
            )
        restored_vnd = restored["id_mapping"]["accounts"][vnd]
        self.assertEqual(
            self.get_account(restored_vnd)["balance"],
            250000000,
        )

    def test_transfer_cannot_make_investment_cash_negative(self):
        investment = self.add_account("投资", account_type="investment", cash_available=100)
        bank = self.add_account("银行")
        with self.assertRaises(HTTPException):
            transfer_between_accounts(TransferCreate(
                from_account_id=investment, to_account_id=bank, amount=101, occurred_at="2026-09-28",
            ))
        self.assertEqual(self.get_account(investment)["cash_available"], 100)
        self.assertEqual(self.get_account(bank)["balance"], 0)

    def test_transfer_reversal_cannot_consume_invested_cash(self):
        bank = self.add_account("银行", balance=1000)
        investment = self.add_account("投资", account_type="investment")
        reference = transfer_between_accounts(TransferCreate(
            from_account_id=bank,
            to_account_id=investment,
            amount=1000,
            occurred_at="2026-09-28",
        ))["reference_id"]
        create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=investment,
                name="测试标的",
                code="CASH-GUARD",
                buy_price=100,
                current_price=100,
                quantity=8,
            ),
            trade_type="buy",
            quantity=8,
            price=100,
            occurred_at="2026-09-28",
        ))

        with self.assertRaises(HTTPException) as rejected:
            reverse_transfer(reference, ReversalCreate(reason="撤销原转账"))

        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.get_account(bank)["balance"], 0)
        self.assertEqual(self.get_account(investment)["cash_available"], 200)
        self.assertEqual(
            self.row(
                """
                SELECT COUNT(*) AS count
                FROM transactions
                WHERE reference_id = ? AND voided_at IS NOT NULL
                """,
                (reference,),
            )["count"],
            0,
        )

    def test_sell_reversal_cannot_make_investment_cash_negative(self):
        investment = self.add_account(
            "卖出撤销投资账户",
            account_type="investment",
        )
        bank = self.add_account("卖出结算账户")
        holding = self.holding(investment, currency="CNY")
        sold = create_investment_trade(InvestmentTradeCreate(
            holding_id=holding,
            trade_type="sell",
            quantity=5,
            price=100,
            occurred_at="2026-09-28",
        ))
        transfer_between_accounts(TransferCreate(
            from_account_id=investment,
            to_account_id=bank,
            amount=400,
            occurred_at="2026-09-28",
        ))

        with self.assertRaises(HTTPException) as rejected:
            reverse_investment_trade(
                sold["id"],
                ReversalCreate(reason="撤销卖出"),
                idempotency_key="negative-sell-reversal",
            )

        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.get_account(investment)["cash_available"], 100)
        self.assertIsNone(
            self.row(
                "SELECT voided_at FROM investment_trades WHERE id = ?",
                (sold["id"],),
            )["voided_at"]
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM financial_commands "
                "WHERE command_key = 'negative-sell-reversal'"
            )["count"],
            0,
        )

    def test_transaction_changes_cannot_make_investment_cash_negative(self):
        investment = self.add_account(
            "投资",
            account_type="investment",
        )
        income = transactions.create_transaction(TransactionCreate(
            account_id=investment,
            amount=1000,
            direction="income",
            occurred_at="2026-09-28",
        ))["id"]
        create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=investment,
                name="现金约束标的",
                code="CASH-LEDGER-GUARD",
                buy_price=100,
                current_price=100,
                quantity=8,
            ),
            trade_type="buy",
            quantity=8,
            price=100,
            occurred_at="2026-09-28",
        ))
        before_snapshot = self.row(
            """
            SELECT asset_total, investment_value, cash_value
            FROM snapshots
            WHERE member_id IS NULL
            ORDER BY id DESC LIMIT 1
            """
        )

        with self.assertRaises(HTTPException) as invalid_update:
            transactions.update_transaction(
                income,
                TransactionCreate(
                    account_id=investment,
                    amount=500,
                    direction="income",
                    occurred_at="2026-09-28",
                ),
                idempotency_key="negative-investment-update",
            )
        self.assertEqual(invalid_update.exception.status_code, 409)

        with self.assertRaises(HTTPException) as invalid_delete:
            transactions.delete_transaction(
                income,
                idempotency_key="negative-investment-delete",
            )
        self.assertEqual(invalid_delete.exception.status_code, 409)

        with self.assertRaises(HTTPException) as invalid_expense:
            transactions.create_transaction(
                TransactionCreate(
                    account_id=investment,
                    amount=201,
                    direction="expense",
                    occurred_at="2026-09-28",
                ),
                idempotency_key="negative-investment-expense",
            )
        self.assertEqual(invalid_expense.exception.status_code, 409)

        self.assertEqual(self.get_account(investment)["cash_available"], 200)
        self.assertEqual(
            self.row(
                "SELECT amount FROM transactions WHERE id = ?",
                (income,),
            )["amount"],
            1000,
        )
        self.assertEqual(
            self.row(
                """
                SELECT COUNT(*) AS count
                FROM financial_commands
                WHERE command_key IN (?, ?, ?)
                """,
                (
                    "negative-investment-update",
                    "negative-investment-delete",
                    "negative-investment-expense",
                ),
            )["count"],
            0,
        )
        self.assertEqual(
            self.row(
                """
                SELECT COUNT(*) AS count
                FROM audit_events
                WHERE action IN ('修改流水', '删除流水')
                  AND entity_id = ?
                """,
                (str(income),),
            )["count"],
            0,
        )
        self.assertEqual(
            self.row(
                """
                SELECT asset_total, investment_value, cash_value
                FROM snapshots
                WHERE member_id IS NULL
                ORDER BY id DESC LIMIT 1
                """
            ),
            before_snapshot,
        )

        transactions.update_transaction(
            income,
            TransactionCreate(
                account_id=investment,
                amount=800,
                direction="income",
                occurred_at="2026-09-28",
            ),
        )
        self.assertEqual(self.get_account(investment)["cash_available"], 0)

    def test_statement_import_cannot_make_investment_cash_negative(self):
        investment = self.add_account(
            "导入约束投资账户",
            account_type="investment",
            cash_available=10,
        )
        payload = StatementImportPayload(rows=[
            StatementImportRow(
                account_id=investment,
                amount=11,
                direction="expense",
                occurred_at="2026-09-28",
                external_id="negative-import",
                decision="import",
            ),
        ])

        with self.assertRaises(HTTPException) as rejected:
            transactions.import_statement_transactions(
                payload,
                idempotency_key="negative-investment-import",
            )

        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.get_account(investment)["cash_available"], 10)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM transactions "
                "WHERE reference_id = 'negative-import'"
            )["count"],
            0,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM financial_commands "
                "WHERE command_key = 'negative-investment-import'"
            )["count"],
            0,
        )

    def test_stale_investment_cash_update_is_rejected_and_adjustment_is_recorded(self):
        investment = self.add_account(
            "投资",
            account_type="investment",
            cash_available=1000,
        )
        trade = create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=investment,
                name="测试标的",
                code="STALE-CASH",
                buy_price=100,
                current_price=100,
                quantity=8,
            ),
            trade_type="buy",
            quantity=8,
            price=100,
            occurred_at="2026-09-28",
        ))
        self.assertGreater(trade["id"], 0)
        with self.assertRaises(HTTPException) as rejected:
            update_investment_cash(InvestmentCashUpdate(
                account_id=investment,
                cash_available=1100,
                expected_cash_available=1000,
                reason="旧页面草稿",
            ))
        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.get_account(investment)["cash_available"], 200)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM transactions WHERE source = 'adjustment'"
            )["count"],
            0,
        )

        result = update_investment_cash(InvestmentCashUpdate(
            account_id=investment,
            cash_available=300,
            expected_cash_available=200,
            reason="券商余额核对",
        ))
        self.assertEqual(result["previous_balance"], 200)
        self.assertEqual(result["actual_balance"], 300)
        self.assertEqual(self.get_account(investment)["cash_available"], 300)
        adjustment = self.row(
            "SELECT * FROM transactions WHERE source = 'adjustment'"
        )
        self.assertEqual((adjustment["amount"], adjustment["direction"]), (100, "income"))

    def test_public_snapshot_refresh_only_accepts_today(self):
        self.add_account("银行", balance=1000)
        historical_date = "2026-09-01"
        conn = database.get_connection()
        conn.execute(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth,
             investment_value, cash_value, created_at)
            VALUES (?, 500, 0, 500, 0, 500, ?)
            """,
            (historical_date, historical_date),
        )
        conn.commit()
        conn.close()

        with self.assertRaises(HTTPException) as rejected:
            refresh_warehouse(historical_date)

        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(
            self.row(
                "SELECT net_worth FROM snapshots WHERE snapshot_date = ?",
                (historical_date,),
            )["net_worth"],
            500,
        )
        self.assertEqual(refresh_warehouse(business_today().isoformat())["net_worth"], 1000)

    def test_history_trade_uses_same_currency_cash_without_overwriting_quote(self):
        account = self.add_account("投资", account_type="investment", currency="USD", exchange_rate=8, cash_available=1000)
        holding = self.holding(account)
        trade = create_investment_trade(self.trade(holding))
        self.assertEqual(self.get_account(account)["cash_available"], 974)
        self.assertEqual(self.row("SELECT current_price FROM holdings")["current_price"], 20)
        conn = database.get_connection()
        conn.execute("UPDATE holdings SET current_price = 30")
        conn.commit()
        conn.close()
        reverse_investment_trade(trade["id"], ReversalCreate(reason="更正"))
        self.assertEqual(self.get_account(account)["cash_available"], 1000)
        self.assertEqual(self.row("SELECT current_price FROM holdings")["current_price"], 30)

    def test_cross_currency_trade_uses_explicit_settlement_and_reverse_snapshot(self):
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        holding = self.holding(account)
        with self.assertRaises(HTTPException):
            create_investment_trade(self.trade(holding))
        trade = create_investment_trade(self.trade(holding, settlement_rate=7.5))
        self.assertEqual(self.get_account(account)["cash_available"], 805)
        self.assertEqual(self.row("SELECT settlement_rate FROM investment_trades")["settlement_rate"], 7.5)
        reverse_investment_trade(trade["id"], ReversalCreate(reason="更正"))
        self.assertEqual(self.get_account(account)["cash_available"], 1000)

    def test_exact_decimal_cash_can_be_fully_invested(self):
        account = self.add_account(
            "精确现金",
            account_type="investment",
            cash_available=0.7,
        )
        result = create_investment_trade(InvestmentTradeCreate(
            new_holding=HoldingCreate(
                account_id=account,
                name="小数标的",
                code="DECIMAL",
                buy_price="0.07",
                current_price="0.07",
                quantity="10",
            ),
            trade_type="buy",
            quantity="10",
            price="0.07",
            occurred_at="2026-09-29",
        ))
        self.assertGreater(result["id"], 0)
        self.assertEqual(self.get_account(account)["cash_available"], 0)

    def test_database_rejects_orphan_financial_rows(self):
        conn = database.get_connection()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO transactions
                (family_id, member_id, account_id, amount, currency,
                 exchange_rate_to_base, base_amount, fx_status, direction, occurred_at)
                VALUES (1, 1, 999999, 1, 'CNY', 1, 1, 'captured', 'expense', '2026-09-29')
                """
            )
        conn.close()
        self.assertGreater(database.get_schema_version(), 0)

    def test_concurrent_retry_creates_exactly_one_transaction(self):
        account = self.add_account("银行", balance=1000)
        operation = lambda: transactions.create_transaction(self.expense(account), idempotency_key="same-operation")
        first, retry = self.parallel(operation, operation)
        self.assertEqual(first, retry)
        self.assertEqual(self.get_account(account)["balance"], 900)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM transactions")["count"], 1)
        with self.assertRaises(HTTPException):
            transactions.create_transaction(self.expense(account).model_copy(update={"amount": 200}), idempotency_key="same-operation")
        transactions.create_transaction(self.expense(account), idempotency_key="another-real-expense")
        self.assertEqual(self.get_account(account)["balance"], 800)

    def test_idempotency_key_cannot_replay_across_data_scopes(self):
        account = self.add_account("范围隔离账户", balance=1000)
        payload = self.expense(account)
        transactions.create_transaction(
            payload,
            idempotency_key="scope-bound-operation",
        )

        with use_auth_context(self.auth_context.with_scope("personal")):
            with self.assertRaises(HTTPException) as rejected:
                transactions.create_transaction(
                    payload,
                    idempotency_key="scope-bound-operation",
                )
        self.assertEqual(rejected.exception.code, "COMMAND_CONTENT_CONFLICT")
        self.assertEqual(self.get_account(account)["balance"], 900)

    def test_legacy_fingerprint_confirms_without_replaying_sensitive_response(self):
        account = self.add_account("旧协议账户", balance=100)
        payload = TransactionCreate(
            account_id=account,
            amount=10,
            direction="expense",
            occurred_at="2026-09-28",
        )
        result = transactions.create_transaction(
            payload,
            idempotency_key="legacy-command",
        )
        endpoint = transactions.create_transaction.__wrapped__
        legacy_fingerprint = command_application.command_fingerprint(
            self.auth_context,
            endpoint,
            {"transaction": payload},
            1,
        )
        scoped_fingerprint = command_application.command_fingerprint(
            self.auth_context,
            endpoint,
            {"transaction": payload},
            2,
        )
        conn = database.get_connection()
        conn.execute(
            """
            UPDATE financial_commands
            SET fingerprint = ?, fingerprint_version = 1, data_scope = NULL
            WHERE command_key = 'legacy-command'
            """,
            (legacy_fingerprint,),
        )
        conn.commit()
        conn.close()

        with self.assertRaises(HTTPException) as replay:
            transactions.create_transaction(
                payload,
                idempotency_key="legacy-command",
            )
        self.assertEqual(replay.exception.code, "COMMAND_RESULT_EXPIRED")
        self.assertEqual(self.get_account(account)["balance"], 90)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM transactions "
                "WHERE account_id = ? AND source = 'manual'",
                (account,),
            )["count"],
            1,
        )
        with database.write_connection() as conn:
            conn.execute(
                """
                UPDATE financial_commands
                SET fingerprint = ?, fingerprint_version = 0, data_scope = NULL
                WHERE command_key = 'legacy-command'
                """,
                (scoped_fingerprint,),
            )
        with self.assertRaises(HTTPException) as unknown_version_replay:
            transactions.create_transaction(
                payload,
                idempotency_key="legacy-command",
            )
        self.assertEqual(
            unknown_version_replay.exception.code,
            "COMMAND_RESULT_EXPIRED",
        )
        self.assertEqual(self.get_account(account)["balance"], 90)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM audit_events "
                "WHERE entity_type = 'transaction' AND entity_id = ?",
                (str(result["id"]),),
            )["count"],
            1,
        )

    def test_failed_command_rolls_back_balance_records_and_retry_key(self):
        account = self.add_account("银行", balance=1000)
        apply_delta = ledger_application.apply_account_balance_delta
        def injected(*args):
            apply_delta(*args)
            raise RuntimeError("response failure")
        with patch.object(
            ledger_application,
            "apply_account_balance_delta",
            side_effect=injected,
        ):
            with self.assertRaises(RuntimeError):
                transactions.create_transaction(self.expense(account), idempotency_key="retry-failure")
        self.assertEqual(self.get_account(account)["balance"], 1000)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM financial_commands")["count"], 0)
        transactions.create_transaction(self.expense(account), idempotency_key="retry-failure")
        self.assertEqual(self.get_account(account)["balance"], 900)

    def test_financial_changes_upsert_one_current_daily_snapshot(self):
        account = self.add_account("银行", balance=1000)
        transactions.create_transaction(self.expense(account))
        first = self.row("SELECT * FROM snapshots WHERE snapshot_date = ?", (business_today().isoformat(),))
        self.assertEqual(first["net_worth"], 900)

        transactions.create_transaction(self.expense(account).model_copy(update={
            "amount": 50, "direction": "income",
        }))
        latest = self.row("SELECT * FROM snapshots WHERE snapshot_date = ?", (business_today().isoformat(),))
        self.assertEqual(latest["net_worth"], 950)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM snapshots")["count"], 2)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM snapshots WHERE member_id IS NULL"
            )["count"],
            1,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM snapshots WHERE member_id IS NOT NULL"
            )["count"],
            1,
        )

    def test_financial_snapshot_scope_does_not_depend_on_legacy_audit_inference(self):
        account = self.add_account("银行", balance=1000)
        self.assertFalse(hasattr(audit, "prepare_financial_audit"))
        self.assertFalse(hasattr(audit, "record_financial_command"))
        transactions.create_transaction(self.expense(account))
        self.assertEqual(self.get_account(account)["balance"], 900)
        self.assertEqual(
            self.row(
                "SELECT net_worth FROM snapshots WHERE member_id IS NULL"
            )["net_worth"],
            900,
        )

    def test_concurrent_account_changes_end_with_complete_snapshot(self):
        first_account = self.add_account("银行A", balance=1000)
        second_account = self.add_account("银行B", balance=1000)
        results = self.parallel(
            lambda: transactions.create_transaction(self.expense(first_account)),
            lambda: transactions.create_transaction(self.expense(second_account)),
        )
        self.assertTrue(all(isinstance(result, dict) for result in results))
        snapshot_row = self.row(
            "SELECT * FROM snapshots WHERE snapshot_date = ?",
            (business_today().isoformat(),),
        )
        self.assertEqual(snapshot_row["net_worth"], 1800)

    def test_snapshot_failure_rolls_back_the_financial_change(self):
        account = self.add_account("银行", balance=1000)
        with patch(
            "application.snapshots.refresh_family_warehouse_snapshots",
            side_effect=RuntimeError("snapshot failed"),
        ):
            with self.assertRaises(RuntimeError):
                transactions.create_transaction(self.expense(account))
        self.assertEqual(self.get_account(account)["balance"], 1000)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM transactions")["count"], 0)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM snapshots")["count"], 0)

    def test_daily_snapshot_schedule_targets_next_0005(self):
        self.assertEqual(
            seconds_until_next_snapshot(datetime(2026, 9, 28, 23, 59)),
            6 * 60,
        )
        self.assertEqual(
            seconds_until_next_snapshot(datetime(2026, 9, 28, 0, 4, 30)),
            30,
        )

    def test_goal_allocation_does_not_create_an_asset_snapshot(self):
        self.add_account("银行", balance=1000)
        create_goal(self.goal_payload("旅行", 1000, current_amount=100))
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM snapshots")["count"], 0)

    def test_concurrent_adjustment_and_expense_preserve_balance_ledger_identity(self):
        account = self.add_account("银行", balance=1000)
        results = self.parallel(
            lambda: adjust_account_balance(account, BalanceAdjustmentCreate(
                actual_balance=900, occurred_at="2026-09-28", reason="核对",
            )),
            lambda: transactions.create_transaction(self.expense(account)),
        )
        self.assertTrue(all(isinstance(result, dict) or result == 409 for result in results))
        delta = self.row("""SELECT SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END) AS value
                            FROM transactions""")["value"]
        self.assertEqual(self.get_account(account)["balance"], 1000 + delta)

    def test_stale_adjustment_is_rejected_without_extra_record(self):
        account = self.add_account("银行", balance=1000)
        transactions.create_transaction(self.expense(account))
        with self.assertRaises(HTTPException):
            adjust_account_balance(account, BalanceAdjustmentCreate(
                actual_balance=800, expected_balance=1000, occurred_at="2026-09-28", reason="旧页面",
            ))
        self.assertEqual(self.get_account(account)["balance"], 900)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM transactions")["count"], 1)

    def test_goal_metadata_edit_preserves_new_progress_and_status(self):
        goal = create_goal(self.goal_payload("目标", 1000, current_amount=100))["id"]
        create_goal_record(goal, GoalRecordCreate(amount=200, recorded_at="2026-09-28"))
        update_goal_status(goal, GoalStatusUpdate(status="completed"))
        update_goal(goal, GoalUpdate(
            name="改名",
            target_amount=1500,
            allocations=[{
                "member_id": self.owner_member_id(),
                "target_amount": 1500,
            }],
        ))
        row = self.row("SELECT * FROM goals")
        self.assertEqual((row["current_amount"], row["status"], row["name"]), (300, "completed", "改名"))

    def test_concurrent_goal_withdrawals_cannot_overdraw(self):
        goal = create_goal(self.goal_payload("目标", 1000, current_amount=100))["id"]
        operation = lambda: create_goal_record(goal, GoalRecordCreate(amount=-80, recorded_at="2026-09-28"))
        results = self.parallel(operation, operation)
        self.assertEqual(results.count(409), 1)
        self.assertEqual(self.row("SELECT current_amount FROM goals")["current_amount"], 20)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM goal_records")["count"], 1)

    def test_goal_with_history_must_be_archived_instead_of_deleted(self):
        goal = create_goal(self.goal_payload("目标", 1000, current_amount=100))["id"]
        with self.assertRaises(HTTPException):
            delete_goal(goal)
        update_goal_status(goal, GoalStatusUpdate(status="archived"))
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM goals")["count"], 1)
        empty = create_goal(self.goal_payload("空目标", 1000))["id"]
        delete_goal(empty)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM goals")["count"], 1)

    def test_archive_requires_empty_balance_and_holdings_but_keeps_history(self):
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        with self.assertRaises(HTTPException):
            delete_account(account)
        holding = self.holding(account, currency="CNY")
        conn = database.get_connection()
        conn.execute("UPDATE accounts SET cash_available = 0")
        conn.commit()
        conn.close()
        with self.assertRaises(HTTPException):
            delete_account(account)
        conn = database.get_connection()
        conn.execute("UPDATE holdings SET quantity = 0 WHERE id = ?", (holding,))
        conn.commit()
        conn.close()
        delete_account(account)
        self.assertEqual(self.get_account(account)["is_active"], 0)
        self.assertEqual(get_holdings(), [])
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM holdings")["count"], 1)

    def test_inactive_and_unassigned_holdings_have_consistent_summary_scope(self):
        account = self.add_account("投资", account_type="investment")
        self.holding(account, currency="CNY")
        self.holding(None, currency="CNY")
        conn = database.get_connection()
        conn.execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (account,))
        conn.commit()
        conn.close()
        rows = get_holdings()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["included_in_totals"], 0)
        self.assertEqual(get_accounts_overview()["asset_total"], 0)
        self.assertEqual(get_investment_summary()["total_value"], 0)
        self.assertEqual(
            refresh_warehouse_snapshot(context=self.auth_context)["investment_value"],
            0,
        )

    def test_half_cent_holdings_share_one_valuation_fact_everywhere(self):
        account = self.add_account("半分投资", account_type="investment")
        for code in ("HALF-A", "HALF-B"):
            add_holding(HoldingCreate(
                account_id=account,
                name=code,
                code=code,
                buy_price="0",
                current_price="0.006",
                quantity="1",
                currency="CNY",
                exchange_rate_to_base="1",
            ))
        account_view = next(
            item for item in get_accounts_overview()["accounts"]
            if item["id"] == account
        )
        investment = get_investment_summary()
        saved = refresh_warehouse_snapshot(context=self.auth_context)
        expected = Decimal("0.02")
        self.assertEqual(account_view["holdings_value"], expected)
        self.assertEqual(account_view["balance"], expected)
        self.assertEqual(investment["total_value"], expected)
        self.assertEqual(saved["investment_value"], expected)
        self.assertEqual(saved["asset_total"], expected)

    def test_negative_investment_opening_is_rejected_without_side_effects(self):
        with self.assertRaises(ValidationError):
            create_account(
                AccountCreate(
                    name="非法投资现金",
                    type="investment",
                    balance="-100",
                ),
                idempotency_key="negative-opening",
            )
        self.assertEqual(
            self.row("SELECT COUNT(*) AS count FROM accounts WHERE name = '非法投资现金'")["count"],
            0,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM financial_commands "
                "WHERE command_key = 'negative-opening'"
            )["count"],
            0,
        )
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM audit_events")["count"], 0)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM snapshots")["count"], 0)

        ordinary = create_account(AccountCreate(
            name="可透支普通账户",
            type="debit_card",
            balance="-100",
        ))["id"]
        liability = create_account(AccountCreate(
            name="负债贷方余额",
            type="credit_card",
            balance="-50",
        ))["id"]
        self.assertEqual(self.get_account(ordinary)["balance"], -100)
        self.assertEqual(self.get_account(liability)["balance"], -50)

    def test_restore_rejects_negative_investment_cash_before_replacing_book(self):
        investment = self.add_account(
            "恢复约束投资账户",
            account_type="investment",
            cash_available=100,
        )
        conn = database.get_connection()
        saved = snapshot(conn)
        conn.close()
        invalid = deepcopy(saved)
        account = next(
            row for row in invalid["data"]["accounts"]
            if row["id"] == investment
        )
        account["cash_available"] = "-1.00"

        with self.assertRaises(HTTPException) as rejected:
            prepared = prepare_family_restore(invalid, fingerprint(saved))
            with database.write_connection() as conn:
                restore(conn, invalid, fingerprint(saved), prepared=prepared)

        self.assertEqual(rejected.exception.status_code, 422)
        self.assertEqual(self.get_account(investment)["cash_available"], 100)
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM accounts WHERE id = ?",
                (investment,),
            )["count"],
            1,
        )

    def test_expired_command_response_remains_a_replay_tombstone(self):
        account = self.add_account("留存账户", balance=1000)
        transactions.create_transaction(
            self.expense(account),
            idempotency_key="retained-command",
        )
        conn = database.get_connection()
        conn.execute(
            """
            UPDATE financial_commands
            SET response_expires_at = '2000-01-01T00:00:00'
            WHERE command_key = 'retained-command'
            """
        )
        conn.commit()
        conn.close()

        result = expire_command_responses(before="2026-09-29T00:00:00")
        self.assertEqual(result["expired"], 1)
        command = self.row(
            "SELECT status, response FROM financial_commands "
            "WHERE command_key = 'retained-command'"
        )
        self.assertEqual(command, {"status": "expired", "response": None})
        with self.assertRaises(HTTPException) as replay:
            transactions.create_transaction(
                self.expense(account),
                idempotency_key="retained-command",
            )
        self.assertEqual(replay.exception.status_code, 409)
        self.assertEqual(replay.exception.code, "COMMAND_RESULT_EXPIRED")
        self.assertEqual(self.get_account(account)["balance"], 900)
        repeated = expire_command_responses(before="2026-09-29T00:00:00")
        self.assertEqual(repeated["expired"], 0)
        self.assertEqual(
            self.row(
                "SELECT status FROM financial_commands "
                "WHERE command_key = 'retained-command'"
            )["status"],
            "expired",
        )

    def test_reconciliation_reports_difference_without_repairing_the_ledger(self):
        account = create_account(AccountCreate(
            name="核对报告账户",
            type="debit_card",
            balance=1000,
            opening_date="2026-09-01",
        ))["id"]
        conn = database.get_connection()
        conn.execute("UPDATE accounts SET balance = 975 WHERE id = ?", (account,))
        conn.commit()
        conn.close()

        report = reconcile_accounts()
        item = next(row for row in report["items"] if row["account_id"] == account)
        self.assertEqual(item["actual"], Decimal("975.00"))
        self.assertEqual(item["expected"], Decimal("1000.00"))
        self.assertEqual(item["difference"], Decimal("-25.00"))
        self.assertFalse(item["matches"])
        self.assertFalse(report["repair_performed"])
        self.assertEqual(self.get_account(account)["balance"], 975)

    def test_application_marker_diagnosis_and_controlled_correction_are_idempotent(self):
        account = create_account(AccountCreate(
            name="历史漏扣账户",
            type="debit_card",
            balance=100,
            opening_date="2026-09-01",
        ))["id"]
        transaction_id = transactions.create_transaction(TransactionCreate(
            account_id=account,
            amount=10,
            direction="expense",
            occurred_at="2026-09-28",
        ))["id"]
        with database.write_connection() as conn:
            conn.execute(
                "UPDATE transactions SET balance_applied = 0 WHERE id = ?",
                (transaction_id,),
            )
            conn.execute(
                "UPDATE accounts SET balance = 100 WHERE id = ?",
                (account,),
            )

        report = reconcile_accounts()
        item = next(row for row in report["items"] if row["account_id"] == account)
        self.assertTrue(item["matches"])
        self.assertEqual(item["history"]["status"], "complete")
        self.assertEqual(item["application"]["status"], "inconsistent")
        self.assertFalse(item["reconstructable"])
        self.assertFalse(item["healthy"])
        self.assertEqual(item["application"]["issues"][0], {
            "transaction_id": transaction_id,
            "occurred_at": "2026-09-28",
            "actual_balance_applied": False,
            "expected_balance_applied": True,
            "amount": Decimal("10.00"),
            "direction": "expense",
            "source": "manual",
            "voided_at": None,
            "requires_correction": True,
            "correction_delta": Decimal("-10.00"),
        })

        conn = database.get_connection()
        invalid_backup = snapshot(conn)
        conn.close()
        with self.assertRaises(HTTPException) as rejected:
            preview_restore(invalid_backup)
        self.assertIn(f"transaction_id={transaction_id}", rejected.exception.detail)

        correction = TransactionApplicationCorrection(
            expected_account_balance=100,
            expected_balance_applied=False,
            reason="核对旧日期比较漏扣",
        )
        first = transactions.correct_transaction_application(
            transaction_id,
            correction,
            idempotency_key="correct-application",
        )
        replay = transactions.correct_transaction_application(
            transaction_id,
            correction,
            idempotency_key="correct-application",
        )
        self.assertEqual(first, replay)
        self.assertEqual(self.get_account(account)["balance"], 90)
        self.assertEqual(
            self.row(
                "SELECT balance_applied FROM transactions WHERE id = ?",
                (transaction_id,),
            )["balance_applied"],
            1,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM audit_events "
                "WHERE action = '更正流水余额应用' AND entity_id = ?",
                (str(transaction_id),),
            )["count"],
            1,
        )

        conn = database.get_connection()
        saved = snapshot(conn)
        conn.close()
        restored = restore_backup(RestoreRequest(
            backup=saved,
            expected_fingerprint=preview_restore(saved)["expected_fingerprint"],
            confirm_replace=True,
        ))
        restored_account = restored["id_mapping"]["accounts"][account]
        restored_item = next(
            row for row in reconcile_accounts()["items"]
            if row["account_id"] == restored_account
        )
        self.assertTrue(restored_item["healthy"])
        self.assertEqual(restored_item["application"]["issue_count"], 0)

    def test_application_marker_correction_conflicts_and_failures_roll_back(self):
        account = create_account(AccountCreate(
            name="更正回滚账户",
            type="debit_card",
            balance=100,
            opening_date="2026-09-01",
        ))["id"]
        transaction_id = transactions.create_transaction(TransactionCreate(
            account_id=account,
            amount=10,
            direction="expense",
            occurred_at="2026-09-28",
        ))["id"]
        with database.write_connection() as conn:
            conn.execute(
                "UPDATE transactions SET balance_applied = 0 WHERE id = ?",
                (transaction_id,),
            )
            conn.execute("UPDATE accounts SET balance = 100 WHERE id = ?", (account,))
        correction = TransactionApplicationCorrection(
            expected_account_balance=99,
            expected_balance_applied=False,
            reason="错误的预期余额",
        )
        with self.assertRaises(HTTPException):
            transactions.correct_transaction_application(
                transaction_id,
                correction,
                idempotency_key="stale-application-correction",
            )
        self.assertEqual(self.get_account(account)["balance"], 100)
        self.assertEqual(
            self.row(
                "SELECT balance_applied FROM transactions WHERE id = ?",
                (transaction_id,),
            )["balance_applied"],
            0,
        )

        valid = correction.model_copy(update={"expected_account_balance": 100})
        with patch(
            "audit.record_audit_event",
            side_effect=RuntimeError("audit unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                transactions.correct_transaction_application(
                    transaction_id,
                    valid,
                    idempotency_key="rollback-application-correction",
                )
        self.assertEqual(self.get_account(account)["balance"], 100)
        self.assertEqual(
            self.row(
                "SELECT balance_applied FROM transactions WHERE id = ?",
                (transaction_id,),
            )["balance_applied"],
            0,
        )
        self.assertEqual(
            self.row(
                "SELECT COUNT(*) AS count FROM financial_commands "
                "WHERE command_key = 'rollback-application-correction'",
            )["count"],
            0,
        )

    def test_restoring_backup_invalidates_old_command_keys(self):
        account = self.add_account("银行", balance=1000)
        conn = database.get_connection()
        saved = snapshot(conn)
        conn.close()
        transactions.create_transaction(self.expense(account), idempotency_key="before-restore")
        preview = preview_restore(saved)
        restored = restore_backup(RestoreRequest(backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True))
        with self.assertRaises(HTTPException) as replay:
            transactions.create_transaction(self.expense(account), idempotency_key="before-restore")
        self.assertEqual(replay.exception.code, "COMMAND_INVALIDATED")
        self.assertEqual(self.get_account(restored["id_mapping"]["accounts"][account])["balance"], 1000)
        command = self.row(
            "SELECT status, invalidated, response FROM financial_commands "
            "WHERE command_key = 'before-restore'"
        )
        self.assertEqual(command["status"], "invalidated")
        self.assertEqual(command["invalidated"], 1)
        self.assertIsNone(command["response"])

    def test_http_idempotency_header_replays_response(self):
        app = FastAPI()
        app.include_router(transactions.router)
        account = self.add_account("银行", balance=1000)
        async def request():
            messages = []
            async def receive():
                return {"type": "http.request", "body": self.expense(account).model_dump_json().encode(), "more_body": False}
            async def send(message):
                messages.append(message)
            await app({
                "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
                "path": "/transactions", "raw_path": b"/transactions", "query_string": b"",
                "headers": [(b"content-type", b"application/json"), (b"idempotency-key", b"http-retry")],
                "scheme": "http", "server": ("test", 80), "client": ("test", 1),
            }, receive, send)
            self.assertEqual(messages[0]["status"], 200)
            return json.loads(b"".join(message.get("body", b"") for message in messages))
        first = asyncio.run(request())
        self.assertEqual(asyncio.run(request()), first)
        self.assertEqual(self.get_account(account)["balance"], 900)


if __name__ == "__main__":
    unittest.main()
