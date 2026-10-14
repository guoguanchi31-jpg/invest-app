"""Database driver adapters without schema or business initialization."""

import os
import sqlite3
from decimal import Decimal


sqlite3.register_adapter(Decimal, str)


class HybridRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def fetchone(self):
        row = self.cursor.fetchone()
        return HybridRow(row) if row is not None else None

    def fetchall(self):
        return [HybridRow(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        for row in self.cursor:
            yield HybridRow(row)

    @property
    def rowcount(self):
        return self.cursor.rowcount


class PostgresConnection:
    def __init__(self, conn):
        self.conn = conn

    @staticmethod
    def _translate_query(query):
        return query.replace("?", "%s")

    def execute(self, query, params=()):
        return PostgresCursor(
            self.conn.execute(self._translate_query(query), params)
        )

    def executemany(self, query, params):
        cursor = self.conn.cursor()
        cursor.executemany(self._translate_query(query), params)
        return PostgresCursor(cursor)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


def open_connection(*, database_url, db_dir, db_path):
    if database_url:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError(
                "使用 PostgreSQL 需要安装 psycopg[binary] 依赖"
            ) from exc
        connect_timeout = max(
            int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "5")),
            1,
        )
        statement_timeout = max(
            int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "15000")),
            1,
        )
        return PostgresConnection(
            psycopg.connect(
                database_url,
                row_factory=dict_row,
                connect_timeout=connect_timeout,
                options=f"-c statement_timeout={statement_timeout}",
            )
        )
    os.makedirs(db_dir, exist_ok=True)
    timeout = max(float(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "5")), 0.1)
    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)}")
    return conn
