import csv
import asyncio
import json
import re
from pathlib import Path
from io import StringIO
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import unittest
import sqlite3
from unittest.mock import patch

from fastapi import Depends, FastAPI, HTTPException
import database
from routers.accounts import create_account, reverse_transfer, transfer_between_accounts
from routers.investments import create_investment_trade, reverse_investment_trade, update_holding
from routers.transactions import (
    create_transaction, delete_transaction, export_ledger, import_statement_transactions,
    preview_statement_import, update_transaction,
    query_ledger,
)
from routers.warehouse import download_data_backup, preview_restore, restore_backup, RestoreRequest
from schemas import (
    AccountCreate, HoldingCreate, InvestmentTradeCreate, ReversalCreate, StatementImportPayload,
    StatementImportRow, TransactionCreate, TransferCreate,
)
from tests import test_finance_regressions as finance_tests
from services import get_accounts_overview, get_expense_analysis


class WorkflowRegressions(unittest.TestCase):
    setUp = finance_tests.FinanceRegressionTests.setUp
    tearDown = finance_tests.FinanceRegressionTests.tearDown
    add_account = finance_tests.FinanceRegressionTests.add_account
    get_account = finance_tests.FinanceRegressionTests.get_account

    def opening_account(self):
        return create_account(AccountCreate(
            name="期初账户", owner="大宝", type="debit_card", balance=1000, opening_date="2026-09-28",
        ))["id"]

    def test_historical_import_edit_move_date_and_delete(self):
        account_id = self.opening_account()
        row = StatementImportRow(account_id=account_id, amount=100, direction="expense", occurred_at="2026-09-20")
        preview = preview_statement_import(StatementImportPayload(rows=[row]))
        self.assertFalse(preview["rows"][0]["balance_applied"])
        result = import_statement_transactions(StatementImportPayload(rows=[row]))
        self.assertEqual(result["historical"], 1)
        self.assertEqual(self.get_account(account_id)["balance"], 1000)
        self.assertEqual(get_expense_analysis("2026-09")["total_expense"], 100)
        conn = database.get_connection()
        row_id = conn.execute("SELECT id FROM transactions WHERE source = 'manual'").fetchone()["id"]
        conn.close()
        update_transaction(row_id, TransactionCreate(**row.model_dump(exclude={"external_id", "currency", "exchange_rate_to_base", "decision", "note"}), note="备注"))
        self.assertEqual(self.get_account(account_id)["balance"], 1000)
        updated = TransactionCreate(account_id=account_id, amount=100, direction="expense", occurred_at="2026-09-28")
        update_transaction(row_id, updated)
        self.assertEqual(self.get_account(account_id)["balance"], 900)
        update_transaction(row_id, updated.model_copy(update={"occurred_at": "2026-09-19"}))
        delete_transaction(row_id)
        self.assertEqual(self.get_account(account_id)["balance"], 1000)

    def test_manual_history_and_move_between_accounts(self):
        opened = self.opening_account()
        legacy = self.add_account("旧账户", balance=500)
        payload = TransactionCreate(account_id=opened, amount=100, direction="income", occurred_at="2026-09-20")
        created = create_transaction(payload)
        self.assertFalse(created["balance_applied"])
        update_transaction(created["id"], payload.model_copy(update={"account_id": legacy}))
        self.assertEqual(self.get_account(opened)["balance"], 1000)
        self.assertEqual(self.get_account(legacy)["balance"], 600)
        delete_transaction(created["id"])
        self.assertEqual(self.get_account(legacy)["balance"], 500)

    def test_suspected_duplicate_can_be_confirmed_individually(self):
        account_id = self.add_account("咖啡", balance=100)
        rows = [StatementImportRow(account_id=account_id, amount=10, direction="expense",
                                   occurred_at="2026-09-20", merchant="咖啡店", note=note)
                for note in ("早上", "下午")]
        preview = preview_statement_import(StatementImportPayload(rows=rows))
        self.assertEqual(preview["rows"][1]["duplicate_kind"], "suspected")
        result = import_statement_transactions(StatementImportPayload(
            rows=[row.model_copy(update={"decision": "import"}) for row in rows],
        ))
        self.assertEqual(result["imported"], 2)
        self.assertEqual(self.get_account(account_id)["balance"], 80)

    def test_external_id_cannot_be_imported_twice_even_when_forced(self):
        account_id = self.add_account("咖啡", balance=100)
        row = StatementImportRow(account_id=account_id, amount=10, direction="expense",
                                 occurred_at="2026-09-20", external_id="bank-1", decision="import")
        result = import_statement_transactions(StatementImportPayload(rows=[row, row]))
        self.assertEqual((result["imported"], result["skipped"]), (1, 1))

    def test_export_preserves_direction_and_fx_for_import(self):
        account_id = self.add_account("美元", currency="USD", exchange_rate=7)
        for direction in ("income", "expense"):
            create_transaction(TransactionCreate(account_id=account_id, amount=10,
                                               direction=direction, occurred_at="2026-09-20"))
        exported = list(csv.DictReader(StringIO(export_ledger().body.decode("utf-8-sig"))))
        self.assertEqual({row["类型"] for row in exported}, {"收入", "支出"})
        self.assertEqual({row["方向"] for row in exported}, {"收入", "支出"})
        self.assertEqual({row["汇率"] for row in exported}, {"7.0"})
        self.assertEqual({row["金额"] for row in exported}, {"10.0"})

    def test_import_keeps_supplied_historical_exchange_rate(self):
        account_id = self.add_account("美元", currency="USD", exchange_rate=8)
        row = StatementImportRow(account_id=account_id, amount=10, direction="expense",
                                 occurred_at="2026-09-20", currency="USD", exchange_rate_to_base=7)
        import_statement_transactions(StatementImportPayload(rows=[row]))
        self.assertEqual(get_expense_analysis("2026-09")["total_expense"], 70)
        with self.assertRaises(HTTPException):
            preview_statement_import(StatementImportPayload(rows=[
                row.model_copy(update={"exchange_rate_to_base": None}),
            ]))

    def test_transfer_reversal_refunds_each_leg_once_under_concurrency(self):
        source = self.add_account("转出", balance=1000)
        target = self.add_account("美元转入", currency="USD", exchange_rate=7)
        ref = transfer_between_accounts(TransferCreate(
            from_account_id=source, to_account_id=target, amount=700, to_amount=100, occurred_at="2026-09-28",
        ))["reference_id"]
        start = Barrier(2)
        def reverse():
            start.wait()
            try:
                reverse_transfer(ref, ReversalCreate(reason="录错"))
                return 200
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(reverse) for _ in range(2)]
            self.assertEqual(sorted(f.result() for f in futures), [200, 409])
        self.assertEqual(self.get_account(source)["balance"], 1000)
        self.assertEqual(self.get_account(target)["balance"], 0)

    def new_trade(self, account_id, quantity=10, price=10):
        return InvestmentTradeCreate(
            new_holding=HoldingCreate(name="新股", code="NEW", account_id=account_id, buy_price=0,
                                      quantity=quantity, current_price=price),
            trade_type="buy", quantity=quantity, price=price, fee=1, occurred_at="2026-09-28",
        )

    def test_first_buy_failure_leaves_no_holding_or_trade(self):
        account = self.add_account("投资", account_type="investment", cash_available=50)
        with self.assertRaises(HTTPException):
            create_investment_trade(self.new_trade(account))
        conn = database.get_connection()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM investment_trades").fetchone()[0], 0)
        conn.close()
        self.assertEqual(self.get_account(account)["cash_available"], 50)

    def test_buy_sell_undo_restores_original_cost_and_cash(self):
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        first = create_investment_trade(self.new_trade(account))
        second = create_investment_trade(InvestmentTradeCreate(
            holding_id=first["holding_id"], trade_type="sell", quantity=2, price=12, fee=1, occurred_at="2026-09-28",
        ))
        with self.assertRaises(HTTPException):
            reverse_investment_trade(first["id"], ReversalCreate(reason="更正"))
        reverse_investment_trade(second["id"], ReversalCreate(reason="更正卖出"))
        reverse_investment_trade(first["id"], ReversalCreate(reason="更正买入"))
        self.assertEqual(self.get_account(account)["cash_available"], 1000)
        conn = database.get_connection()
        holding = conn.execute("SELECT * FROM holdings WHERE id = ?", (first["holding_id"],)).fetchone()
        conn.close()
        self.assertEqual((holding["quantity"], holding["buy_price"]), (0, 0))
        with self.assertRaises(HTTPException):
            reverse_investment_trade(first["id"], ReversalCreate(reason="再次撤销"))

    def test_backup_restore_preview_validation_and_roundtrip(self):
        account = self.opening_account()
        saved = json.loads(download_data_backup().body)
        create_transaction(TransactionCreate(account_id=account, amount=100, direction="expense", occurred_at="2026-09-28"))
        preview = preview_restore(saved)
        result = restore_backup(RestoreRequest(
            backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True,
        ))
        self.assertEqual(self.get_account(account)["balance"], 1000)
        self.assertEqual(result["counts"]["transactions"], 1)
        from pathlib import Path
        self.assertTrue((Path(database.DB_DIR) / "backups" / result["recovery_backup"]).is_file())
        invalid = json.loads(json.dumps(saved))
        invalid["data"]["transactions"][0]["account_id"] = 999
        with self.assertRaises(HTTPException):
            preview_restore(invalid)
        self.assertEqual(get_accounts_overview()["asset_total"], 1000)

    def test_restore_rejects_changed_book(self):
        account = self.opening_account()
        saved = json.loads(download_data_backup().body)
        preview = preview_restore(saved)
        create_transaction(TransactionCreate(account_id=account, amount=10, direction="expense", occurred_at="2026-09-28"))
        with self.assertRaises(HTTPException):
            restore_backup(RestoreRequest(backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True))
        self.assertEqual(self.get_account(account)["balance"], 990)

    def test_restore_insert_failure_rolls_back_deleted_tables(self):
        account = self.opening_account()
        saved = json.loads(download_data_backup().body)
        create_transaction(TransactionCreate(account_id=account, amount=10, direction="expense", occurred_at="2026-09-28"))
        preview = preview_restore(saved)
        conn = database.get_connection()
        conn.execute("""CREATE TRIGGER inject_restore_failure BEFORE INSERT ON transactions
                        BEGIN SELECT RAISE(ABORT, 'injected failure'); END""")
        conn.commit()
        conn.close()
        with self.assertRaises(sqlite3.IntegrityError):
            restore_backup(RestoreRequest(backup=saved, expected_fingerprint=preview["expected_fingerprint"], confirm_replace=True))
        self.assertEqual(self.get_account(account)["balance"], 990)
        self.assertEqual(len(json.loads(download_data_backup().body)["data"]["transactions"]), 2)

    def test_filtered_ledger_retains_both_transfer_accounts_and_historical_effect(self):
        source = self.opening_account()
        target = self.add_account("收款", balance=0)
        reference = transfer_between_accounts(TransferCreate(
            from_account_id=source, to_account_id=target, amount=100, occurred_at="2026-09-20",
        ))["reference_id"]
        item = next(row for row in query_ledger(account_id=target) if row["source"] == "transfer")
        self.assertEqual((item["from_account_id"], item["to_account_id"]), (source, target))
        self.assertEqual(self.get_account(source)["balance"], 1000)
        self.assertEqual(self.get_account(target)["balance"], 100)
        reverse_transfer(reference, ReversalCreate(reason="重复导入"))
        self.assertEqual(self.get_account(source)["balance"], 1000)
        self.assertEqual(self.get_account(target)["balance"], 0)

    def test_concurrent_trade_reversal_uses_original_cash_after_fx_change(self):
        account = self.add_account("投资", account_type="investment", cash_available=1000, currency="USD", exchange_rate=7)
        trade = create_investment_trade(self.new_trade(account).model_copy(update={"settlement_rate": 1 / 7}))
        conn = database.get_connection()
        conn.execute("UPDATE accounts SET exchange_rate_to_base = 8 WHERE id = ?", (account,))
        conn.commit()
        conn.close()
        start = Barrier(2)
        def reverse():
            start.wait()
            try:
                reverse_investment_trade(trade["id"], ReversalCreate(reason="录错"))
                return 200
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(reverse) for _ in range(2)]
            self.assertEqual(sorted(f.result() for f in futures), [200, 409])
        self.assertAlmostEqual(self.get_account(account)["cash_available"], 1000)

    def test_trade_cost_cannot_be_overwritten_by_manual_holding_edit(self):
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        trade = create_investment_trade(self.new_trade(account))
        with self.assertRaises(HTTPException):
            update_holding(trade["holding_id"], HoldingCreate(
                name="新股", code="NEW", account_id=account, quantity=20, buy_price=10.1, current_price=10,
            ))
        reverse_investment_trade(trade["id"], ReversalCreate(reason="正常撤销"))
        self.assertEqual(self.get_account(account)["cash_available"], 1000)

    def test_migration_copies_trades_and_rejects_count_mismatch(self):
        import migrate_sqlite_to_postgres as migration
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        create_investment_trade(self.new_trade(account))
        source = database.get_connection()
        columns = {table: migration.sqlite_columns(source, table) for table in migration.TABLES}
        source.close()

        class Target:
            def __init__(self, mismatch=False):
                self.data = {table: [] for table in migration.TABLES}
                self.result = []
                self.mismatch = mismatch
                self.rolled_back = False
            def __enter__(self):
                return self
            def __exit__(self, exc_type, *_):
                if exc_type:
                    self.rolled_back = True
            def cursor(self):
                return self
            def execute(self, query, params=()):
                text = query if isinstance(query, str) else query.as_string()
                if "information_schema.columns" in text:
                    self.result = [(name,) for name in columns[params[0]]]
                elif "COUNT(*)" in text:
                    table = text.split('"')[1]
                    count = len(self.data[table])
                    self.result = [(count + int(self.mismatch and count > 0 and table == "investment_trades"),)]
            def executemany(self, query, values):
                self.data[query.as_string().split('"')[1]].extend(values)
            def fetchone(self):
                return self.result[0]
            def fetchall(self):
                return self.result

        with patch.dict("os.environ", {"DATABASE_URL": "postgresql://test-only"}):
            target = Target()
            with patch.object(migration.psycopg, "connect", return_value=target), patch("builtins.print"):
                counts = migration.migrate(database.DB, replace=False)
            self.assertEqual(counts["investment_trades"], 1)
            self.assertEqual(len(target.data["investment_trades"]), 1)
            self.assertFalse(target.rolled_back)
            mismatch = Target(mismatch=True)
            with patch.object(migration.psycopg, "connect", return_value=mismatch):
                with self.assertRaisesRegex(RuntimeError, "investment_trades: source=1, target=2"):
                    migration.migrate(database.DB, replace=False)
            self.assertTrue(mismatch.rolled_back)

    def test_nginx_whitelist_routes_ledger_and_export_to_backend(self):
        config = (Path(__file__).resolve().parents[2] / "deploy/nginx/snippets/app-locations.conf").read_text()
        pattern = re.search(r"location ~ (\S+) \{", config).group(1)
        for path in ("/ledger", "/ledger/export", "/warehouse/restore", "/investments/trades/1/reverse"):
            self.assertIsNotNone(re.search(pattern, path), path)
        self.assertIsNone(re.search(pattern, "/ledger-page"))

    def test_authenticated_api_schemas_new_buy_reversal_and_restore(self):
        from routers import auth, investments, transactions, warehouse
        app = FastAPI()
        for router in (investments.router, transactions.router, warehouse.router):
            app.include_router(router, dependencies=[Depends(auth.require_auth)])
        account = self.add_account("投资", account_type="investment", cash_available=1000)
        token = auth.create_access_token()

        async def request(method, path, payload=None, authenticated=True):
            body = json.dumps(payload).encode() if payload is not None else b""
            headers = [(b"content-type", b"application/json")]
            if authenticated:
                headers.append((b"authorization", f"Bearer {token}".encode()))
            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                     "method": method, "path": path, "raw_path": path.encode(), "query_string": b"",
                     "headers": headers, "scheme": "http", "server": ("test", 80), "client": ("test", 1)}
            messages = []
            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}
            async def send(message):
                messages.append(message)
            await app(scope, receive, send)
            status = next(message["status"] for message in messages if message["type"] == "http.response.start")
            data = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
            return status, json.loads(data)

        async def scenario():
            self.assertEqual((await request("GET", "/ledger", authenticated=False))[0], 401)
            status, trade = await request("POST", "/investments/trades", self.new_trade(account).model_dump())
            self.assertEqual(status, 200)
            status, saved = await request("GET", "/warehouse/backup")
            self.assertEqual(status, 200)
            self.assertEqual(len(saved["data"]["investment_trades"]), 1)
            self.assertEqual((await request("POST", f"/investments/trades/{trade['id']}/reverse", {"reason": "录错"}))[0], 200)
            status, preview = await request("POST", "/warehouse/restore/preview", saved)
            self.assertEqual(status, 200)
            payload = {"backup": saved, "expected_fingerprint": preview["expected_fingerprint"]}
            self.assertEqual((await request("POST", "/warehouse/restore", payload))[0], 409)
            self.assertEqual((await request("POST", "/warehouse/restore", {**payload, "confirm_replace": True}))[0], 200)
            self.assertAlmostEqual(self.get_account(account)["cash_available"], 899)
        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
