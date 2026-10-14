"""Inject one legacy missed expense ONLY into the browser runner's temporary DB."""
import os
from pathlib import Path
import sqlite3
import sys


def main():
    folder = Path(os.environ["INVEST_E2E_DB_DIR"]).resolve()
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    if folder.parent != frontend or not folder.name.startswith(".e2e-tmp-"):
        raise RuntimeError("This fixture requires the isolated real-api-e2e temporary database")
    account_id, transaction_id = (int(value) for value in sys.argv[1:])
    with sqlite3.connect(f"file:{folder / 'invest.db'}?mode=rw", uri=True) as conn:
        row = conn.execute(
            "SELECT t.amount, t.balance_applied, a.type FROM transactions t "
            "JOIN accounts a ON a.id = t.account_id "
            "WHERE t.id = ? AND t.account_id = ? AND t.direction = 'expense' "
            "AND t.source = 'manual' AND t.voided_at IS NULL AND a.is_liability = 0",
            (transaction_id, account_id),
        ).fetchone()
        if not row or row[1] != 1 or row[2] != "debit_card":
            raise RuntimeError("Expected one applied test expense in a cash account")
        conn.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (row[0], account_id))
        conn.execute("UPDATE transactions SET balance_applied = 0 WHERE id = ?", (transaction_id,))


if __name__ == "__main__":
    main()
