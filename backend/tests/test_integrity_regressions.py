import asyncio
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
from fastapi import FastAPI, HTTPException
from backup import snapshot, validate_backup
from routers import transactions
from routers.accounts import adjust_account_balance, delete_account, reverse_transfer, transfer_between_accounts
from routers.goals import create_goal, create_goal_record, delete_goal, update_goal, update_goal_status
from routers.investments import add_holding, create_investment_trade, reverse_investment_trade
from routers.warehouse import RestoreRequest, preview_restore, restore_backup
from schemas import (
    BalanceAdjustmentCreate, GoalCreate, GoalRecordCreate, GoalStatusUpdate, GoalUpdate,
    HoldingCreate, InvestmentTradeCreate, ReversalCreate, TransactionCreate, TransferCreate,
)
from services import get_accounts_overview, get_holdings, get_investment_summary, refresh_warehouse_snapshot
from tests import test_finance_regressions as finance_tests


class IntegrityRegressions(unittest.TestCase):
    setUp = finance_tests.FinanceRegressionTests.setUp
    tearDown = finance_tests.FinanceRegressionTests.tearDown
    add_account = finance_tests.FinanceRegressionTests.add_account
    get_account = finance_tests.FinanceRegressionTests.get_account

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
        self.assertEqual([row["base_amount"] for row in legs], [700, 700])
        self.assertEqual([row["exchange_rate_to_base"] for row in legs], [7, 7])
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

    def test_transfer_cannot_make_investment_cash_negative(self):
        investment = self.add_account("投资", account_type="investment", cash_available=100)
        bank = self.add_account("银行")
        with self.assertRaises(HTTPException):
            transfer_between_accounts(TransferCreate(
                from_account_id=investment, to_account_id=bank, amount=101, occurred_at="2026-09-28",
            ))
        self.assertEqual(self.get_account(investment)["cash_available"], 100)
        self.assertEqual(self.get_account(bank)["balance"], 0)

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

    def test_failed_command_rolls_back_balance_records_and_retry_key(self):
        account = self.add_account("银行", balance=1000)
        apply_delta = transactions.apply_account_balance_delta
        def injected(*args):
            apply_delta(*args)
            raise RuntimeError("response failure")
        with patch.object(transactions, "apply_account_balance_delta", side_effect=injected):
            with self.assertRaises(RuntimeError):
                transactions.create_transaction(self.expense(account), idempotency_key="retry-failure")
        self.assertEqual(self.get_account(account)["balance"], 1000)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM financial_commands")["count"], 0)
        transactions.create_transaction(self.expense(account), idempotency_key="retry-failure")
        self.assertEqual(self.get_account(account)["balance"], 900)

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
        goal = create_goal(GoalCreate(name="目标", target_amount=1000, current_amount=100))["id"]
        create_goal_record(goal, GoalRecordCreate(amount=200, recorded_at="2026-09-28"))
        update_goal_status(goal, GoalStatusUpdate(status="completed"))
        update_goal(goal, GoalUpdate.model_validate(dict(name="改名", target_amount=1500, current_amount=100, status="active")))
        row = self.row("SELECT * FROM goals")
        self.assertEqual((row["current_amount"], row["status"], row["name"]), (300, "completed", "改名"))

    def test_concurrent_goal_withdrawals_cannot_overdraw(self):
        goal = create_goal(GoalCreate(name="目标", target_amount=1000, current_amount=100))["id"]
        operation = lambda: create_goal_record(goal, GoalRecordCreate(amount=-80, recorded_at="2026-09-28"))
        results = self.parallel(operation, operation)
        self.assertEqual(results.count(409), 1)
        self.assertEqual(self.row("SELECT current_amount FROM goals")["current_amount"], 20)
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM goal_records")["count"], 1)

    def test_goal_with_history_must_be_archived_instead_of_deleted(self):
        goal = create_goal(GoalCreate(name="目标", target_amount=1000, current_amount=100))["id"]
        with self.assertRaises(HTTPException):
            delete_goal(goal)
        update_goal_status(goal, GoalStatusUpdate(status="archived"))
        self.assertEqual(self.row("SELECT COUNT(*) AS count FROM goals")["count"], 1)
        empty = create_goal(GoalCreate(name="空目标", target_amount=1000))["id"]
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
        self.assertEqual(refresh_warehouse_snapshot()["investment_value"], 0)

    def test_restoring_backup_invalidates_old_command_keys(self):
        account = self.add_account("银行", balance=1000)
        conn = database.get_connection()
        saved = snapshot(conn)
        conn.close()
        transactions.create_transaction(self.expense(account), idempotency_key="before-restore")
        preview = preview_restore(saved)
        restore_backup(RestoreRequest(backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True))
        with self.assertRaises(HTTPException):
            transactions.create_transaction(self.expense(account), idempotency_key="before-restore")
        self.assertEqual(self.get_account(account)["balance"], 1000)

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
