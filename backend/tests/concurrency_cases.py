"""Exercise permitted lock serializations against both database adapters."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier, Event, local
from unittest.mock import patch

from fastapi import HTTPException

import application.commands as commands
from routers import accounts
from routers.investments import add_holding, create_investment_trade
from schemas import BalanceAdjustmentCreate, HoldingCreate, InvestmentTradeCreate, TransferCreate
from tenancy import use_auth_context


class ConcurrentCashWorkflows:
    def run_concurrently(self, *operations, first=None):
        barrier = Barrier(len(operations))
        acquired = Event()
        waiting = [Event() for _ in operations]
        worker = local()
        original = commands.family_write_connection

        @contextmanager
        def ordered_lock(family_id):
            if first is not None and worker.index != first:
                if not acquired.wait(10):
                    raise RuntimeError("first writer never acquired lock")
                waiting[worker.index].set()
            with original(family_id) as conn:
                if first is not None and worker.index == first:
                    acquired.set()
                    for index, event in enumerate(waiting):
                        if index != first and not event.wait(10):
                            raise RuntimeError("competing writer never reached lock")
                yield conn

        def run(index, operation):
            worker.index = index
            barrier.wait(timeout=10)
            with use_auth_context(self.auth_context):
                try:
                    return operation()
                except HTTPException as exc:
                    return exc.status_code

        with patch.object(commands, "family_write_connection", ordered_lock):
            with ThreadPoolExecutor(max_workers=len(operations)) as executor:
                futures = [executor.submit(run, index, operation) for index, operation in enumerate(operations)]
                return [future.result(timeout=20) for future in futures]

    def test_transfer_trade_and_reconciliation_preserve_investment_cash(self):
        for first in (None, 0, 1, 2):
            with self.subTest(first=first):
                investment = self.account(f"并发投资-{first}", "investment", 1000)
                cash = self.account(f"并发现金-{first}")
                holding = add_holding(HoldingCreate(
                    account_id=investment, name="并发标的", code=f"CONCURRENT-{first}",
                    buy_price=100, current_price=100, quantity=1,
                ))["id"]
                keys = [f"cash-race-{first}-{index}" for index in range(3)]
                operations = (
                    lambda: accounts.transfer_between_accounts(TransferCreate(
                        from_account_id=investment, to_account_id=cash, amount=200,
                        occurred_at="2026-09-28",
                    ), idempotency_key=keys[0]),
                    lambda: create_investment_trade(InvestmentTradeCreate(
                        holding_id=holding, trade_type="buy", quantity=3, price=100,
                        occurred_at="2026-09-28",
                    ), idempotency_key=keys[1]),
                    lambda: accounts.adjust_account_balance(investment, BalanceAdjustmentCreate(
                        actual_balance=900, expected_balance=1000,
                        occurred_at="2026-09-28", reason="并发核对",
                    ), idempotency_key=keys[2]),
                )
                results = self.run_concurrently(*operations, first=first)
                self.assertIsInstance(results[0], dict)
                self.assertIsInstance(results[1], dict)
                adjusted = isinstance(results[2], dict)
                if not adjusted:
                    self.assertEqual(results[2], 409)
                if first is not None:
                    self.assertEqual(adjusted, first == 2)

                def assert_facts():
                    self.assertEqual(self.row(
                        "SELECT cash_available FROM accounts WHERE id = ?", (investment,),
                    )["cash_available"], 400 if adjusted else 500)
                    self.assertEqual(self.row(
                        "SELECT balance FROM accounts WHERE id = ?", (cash,),
                    )["balance"], 200)
                    self.assertEqual(self.row(
                        "SELECT quantity, buy_price FROM holdings WHERE id = ?", (holding,),
                    ), {"quantity": 4, "buy_price": 100})
                    self.assertEqual(self.row(
                        "SELECT COUNT(*) AS n, SUM(cash_amount) AS cash FROM investment_trades WHERE account_id = ?",
                        (investment,),
                    ), {"n": 1, "cash": 300})
                    self.assertEqual(self.row(
                        "SELECT COUNT(*) AS n FROM transactions WHERE account_id IN (?, ?)",
                        (investment, cash),
                    )["n"], 4 if adjusted else 3)
                    self.assertEqual(self.row(
                        "SELECT COUNT(*) AS n FROM transactions WHERE source = 'transfer' AND account_id IN (?, ?)",
                        (investment, cash),
                    )["n"], 2)
                    self.assertEqual(self.row(
                        "SELECT COUNT(*) AS n FROM audit_events WHERE action = '核对余额' AND entity_id = ?",
                        (str(investment),),
                    )["n"], int(adjusted))
                    for entity, identifier in (
                        ("transfer", results[0]["reference_id"]),
                        ("investment_trade", str(results[1]["id"])),
                    ):
                        self.assertEqual(self.row(
                            "SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = ? AND entity_id = ?",
                            (entity, identifier),
                        )["n"], 1)
                    for index, key in enumerate(keys):
                        command = self.row(
                            "SELECT status FROM financial_commands WHERE command_key = ?", (key,),
                        )
                        self.assertEqual(command, {"status": "committed"} if index < 2 or adjusted else None)
                    self.assertEqual(accounts.reconcile_accounts()["difference_count"], 0)

                assert_facts()
                for operation, result in zip(operations, results):
                    if isinstance(result, dict):
                        self.assertEqual(operation(), result)
                assert_facts()
