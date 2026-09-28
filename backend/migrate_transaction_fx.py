import argparse
import csv
from pathlib import Path

import database


CSV_FIELDS = [
    "transaction_id",
    "occurred_at",
    "account_name",
    "amount",
    "currency",
    "exchange_rate_to_base",
]


def configure_database(sqlite_path):
    if not sqlite_path:
        return
    database.DATABASE_URL = None
    database.DB = str(sqlite_path.resolve())
    database.DB_DIR = str(sqlite_path.resolve().parent)


def export_pending(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({
                "transaction_id": row["id"],
                "occurred_at": row["occurred_at"],
                "account_name": row["account_name"] or "",
                "amount": row["amount"],
                "currency": row["currency"] or "",
                "exchange_rate_to_base": "",
            })


def read_rates(path):
    rates = {}
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        missing_columns = {"transaction_id", "exchange_rate_to_base"} - set(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(f"CSV 缺少列: {', '.join(sorted(missing_columns))}")
        for line_number, row in enumerate(reader, start=2):
            transaction_id = (row.get("transaction_id") or "").strip()
            rate = (row.get("exchange_rate_to_base") or "").strip()
            if not transaction_id or not rate:
                raise ValueError(f"CSV 第 {line_number} 行缺少流水 ID 或历史汇率")
            normalized_id = int(transaction_id)
            if normalized_id in rates:
                raise ValueError(f"CSV 中流水 {normalized_id} 重复")
            rates[normalized_id] = float(rate)
    return rates


def apply_rates(conn, pending, rates):
    pending_ids = {row["id"] for row in pending}
    supplied_ids = set(rates)
    missing_ids = sorted(pending_ids - supplied_ids)
    unknown_ids = sorted(supplied_ids - pending_ids)
    if missing_ids:
        raise ValueError(f"以下待迁移流水缺少汇率: {', '.join(map(str, missing_ids))}")
    if unknown_ids:
        raise ValueError(f"以下流水不存在或无需迁移: {', '.join(map(str, unknown_ids))}")
    database.resolve_transaction_fx(conn, rates)


def main():
    parser = argparse.ArgumentParser(
        description="补录旧流水发生时的本位币汇率，避免按当前汇率或汇率 1 猜测历史金额。"
    )
    parser.add_argument(
        "--sqlite",
        type=Path,
        help="指定 SQLite invest.db；省略时使用 DATABASE_URL 或 DB_DIR。",
    )
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--list", action="store_true", help="列出待迁移流水。")
    actions.add_argument("--export", type=Path, help="导出待填写汇率的 CSV 模板。")
    actions.add_argument("--apply", type=Path, help="应用已填写历史汇率的 CSV。")
    args = parser.parse_args()

    if args.sqlite and not args.sqlite.is_file():
        parser.error(f"SQLite database not found: {args.sqlite}")
    configure_database(args.sqlite)
    database.init_db(allow_unresolved=True)

    conn = database.get_connection()
    pending = database.get_unresolved_transaction_fx(conn)
    if args.export:
        export_pending(args.export, pending)
        conn.close()
        print(f"已导出 {len(pending)} 笔待迁移流水到 {args.export}")
        return
    if args.apply:
        try:
            rates = read_rates(args.apply)
            apply_rates(conn, pending, rates)
            conn.commit()
        except Exception:
            conn.rollback()
            conn.close()
            raise
        conn.close()
        print(f"已补录 {len(rates)} 笔流水的历史汇率")
        return

    for row in pending:
        print(
            f"{row['id']}\t{row['occurred_at']}\t{row['account_name'] or '-'}\t"
            f"{row['amount']} {row['currency'] or '?'}"
        )
    conn.close()
    print(f"待迁移流水: {len(pending)}")


if __name__ == "__main__":
    main()
