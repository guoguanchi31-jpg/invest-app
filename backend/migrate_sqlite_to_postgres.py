import argparse
import os
import sqlite3
from pathlib import Path

import psycopg
from psycopg import sql
from database import FINANCIAL_TABLES


TABLES = FINANCIAL_TABLES


def sqlite_columns(conn, table):
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def postgres_columns(cursor, table):
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    )
    return [row[0] for row in cursor.fetchall()]


def validate_transaction_fx(source):
    columns = set(sqlite_columns(source, "transactions"))
    required = {"currency", "exchange_rate_to_base", "base_amount", "fx_status"}
    if not required.issubset(columns):
        raise RuntimeError(
            "SQLite 流水缺少历史汇率快照字段。请先运行 "
            "migrate_transaction_fx.py --sqlite <invest.db>。"
        )
    unresolved = source.execute(
        """
        SELECT COUNT(*)
        FROM transactions
        WHERE fx_status = 'unresolved' OR base_amount IS NULL
        """
    ).fetchone()[0]
    if unresolved:
        raise RuntimeError(
            f"SQLite 中仍有 {unresolved} 笔流水缺少历史汇率。请先运行 "
            "migrate_transaction_fx.py --sqlite <invest.db> 导出并补录汇率。"
        )


def migrate(sqlite_path, replace):
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    with sqlite3.connect(sqlite_path) as source, psycopg.connect(database_url) as target:
        source.row_factory = sqlite3.Row
        source.execute("BEGIN")
        validate_transaction_fx(source)
        with target.cursor() as cursor:
            if replace:
                identifiers = sql.SQL(", ").join(map(sql.Identifier, reversed(TABLES)))
                cursor.execute(
                    sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(identifiers)
                )
            else:
                populated = []
                for table in TABLES:
                    cursor.execute(
                        sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
                    )
                    if cursor.fetchone()[0]:
                        populated.append(table)
                if populated:
                    raise RuntimeError(
                        "Target tables are not empty: "
                        + ", ".join(populated)
                        + ". Re-run with --replace after creating a backup."
                    )

            # A migrated book is a new command history. Retain keys only as
            # tombstones so delayed clients cannot replay pre-migration writes.
            cursor.execute("UPDATE financial_commands SET invalidated = 1")

            migrated = {}
            for table in TABLES:
                source_columns = sqlite_columns(source, table)
                target_columns = set(postgres_columns(cursor, table))
                if not target_columns:
                    raise RuntimeError(f"Target table missing: {table}; initialize the latest schema first")
                missing = set(source_columns) - target_columns
                if missing:
                    raise RuntimeError(f"Target {table} missing columns: {sorted(missing)}")
                columns = [name for name in source_columns if name in target_columns]
                if not columns:
                    migrated[table] = 0
                    continue

                select_columns = ", ".join(f'"{name}"' for name in columns)
                rows = source.execute(
                    f'SELECT {select_columns} FROM "{table}"'
                ).fetchall()
                if rows:
                    insert_query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                        sql.Identifier(table),
                        sql.SQL(", ").join(map(sql.Identifier, columns)),
                        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                    )
                    cursor.executemany(
                        insert_query,
                        [tuple(row[name] for name in columns) for row in rows],
                    )
                migrated[table] = len(rows)

            # Verify inside the transaction: any mismatch rolls back the entire migration.
            for table in TABLES:
                cursor.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
                actual = cursor.fetchone()[0]
                if actual != migrated[table]:
                    raise RuntimeError(f"{table}: source={migrated[table]}, target={actual}")

            for table in TABLES:
                if "id" not in postgres_columns(cursor, table):
                    continue
                cursor.execute(
                    sql.SQL(
                        "SELECT setval("
                        "pg_get_serial_sequence(%s, 'id'), "
                        "COALESCE(MAX(id), 1), "
                        "MAX(id) IS NOT NULL"
                        ") FROM {}"
                    ).format(sql.Identifier(table)),
                    (table,),
                )

    for table, count in migrated.items():
        print(f"{table}: source={count}, target={count}, verified")
    return migrated


def main():
    parser = argparse.ArgumentParser(
        description="Migrate the Invest SQLite database to PostgreSQL."
    )
    parser.add_argument("sqlite_path", type=Path)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace all data currently stored in PostgreSQL.",
    )
    args = parser.parse_args()

    if not args.sqlite_path.is_file():
        parser.error(f"SQLite database not found: {args.sqlite_path}")

    migrate(args.sqlite_path, args.replace)


if __name__ == "__main__":
    main()
