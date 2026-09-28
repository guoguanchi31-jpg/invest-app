import math
import os
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta


DB_DIR = os.environ.get("DB_DIR", ".")
DB = os.path.join(DB_DIR, "invest.db")
DATABASE_URL = os.environ.get("DATABASE_URL")
BASE_CURRENCY = os.environ.get("BASE_CURRENCY", "CNY").strip().upper() or "CNY"
FINANCIAL_TABLES = [
    "accounts", "categories", "transactions", "holdings", "investment_trades",
    "prices", "budgets", "goals", "goal_records", "snapshots",
]
_command_connection = ContextVar("command_connection", default=None)


class BorrowedConnection:
    """A command owns commit/rollback; nested service calls only borrow its connection."""
    def __init__(self, connection):
        self.connection = connection

    def __getattr__(self, name):
        return getattr(self.connection, name)

    def commit(self):
        pass

    def close(self):
        pass

    def rollback(self):
        # Callers that roll back also raise; the command boundary handles the rollback.
        pass


def is_postgres_connection(conn):
    return isinstance(conn.connection if isinstance(conn, BorrowedConnection) else conn, PostgresConnection)


@contextmanager
def share_command_connection(conn):
    token = _command_connection.set(conn)
    try:
        yield
    finally:
        _command_connection.reset(token)


class HybridRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor):
        self.cursor = cursor
        self.lastrowid = None

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

    @staticmethod
    def _should_return_id(query):
        normalized = query.strip().lower()
        return (
            normalized.startswith("insert into")
            and " returning " not in normalized
            and " on conflict " not in normalized
        )

    def execute(self, query, params=()):
        pg_query = self._translate_query(query)
        should_return_id = self._should_return_id(pg_query)
        if should_return_id:
            pg_query = f"{pg_query.rstrip()} RETURNING id"
        cursor = self.conn.execute(pg_query, params)
        wrapped = PostgresCursor(cursor)
        if should_return_id:
            row = wrapped.fetchone()
            wrapped.lastrowid = row["id"] if row else None
        return wrapped

    def executemany(self, query, params):
        return PostgresCursor(self.conn.executemany(self._translate_query(query), params))

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


def get_connection():
    shared = _command_connection.get()
    if shared is not None:
        return BorrowedConnection(shared)
    if DATABASE_URL:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("使用 PostgreSQL 需要安装 psycopg[binary] 依赖") from exc
        return PostgresConnection(psycopg.connect(DATABASE_URL, row_factory=dict_row))
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


@contextmanager
def write_connection():
    """Serialize read/modify/write on SQLite; callers lock relevant PG rows."""
    shared = _command_connection.get()
    if shared is not None:
        yield BorrowedConnection(shared)
        return
    conn = get_connection()
    try:
        if not isinstance(conn, PostgresConnection):
            conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lock_row(conn, table, row_id):
    if table not in FINANCIAL_TABLES:
        raise ValueError("Unknown financial table")
    suffix = " FOR UPDATE" if is_postgres_connection(conn) else ""
    return conn.execute(f"SELECT * FROM {table} WHERE id = ?{suffix}", (row_id,)).fetchone()


def is_unique_violation(exc):
    if isinstance(exc, sqlite3.IntegrityError):
        return "UNIQUE constraint failed" in str(exc)
    return getattr(exc, "sqlstate", None) == "23505"


DEFAULT_CATEGORIES = [
    ("居住", "expense", "🏡", "#214f3b", 1),
    ("餐饮", "expense", "🍜", "#2f6049", 2),
    ("购物", "expense", "🛍️", "#c8914b", 3),
    ("交通", "expense", "🚇", "#78a88a", 4),
    ("娱乐", "expense", "🎬", "#b46b4d", 5),
    ("医疗健康", "expense", "💊", "#6e8f7a", 6),
    ("日用百货", "expense", "🧴", "#d39b64", 7),
    ("通讯网络", "expense", "📱", "#5d8270", 8),
    ("教育学习", "expense", "📚", "#9f7a45", 9),
    ("人情礼物", "expense", "🎁", "#bd7b62", 10),
    ("旅行出游", "expense", "✈️", "#4f7f8d", 11),
    ("运动健身", "expense", "🏃", "#7da36f", 12),
    ("宠物", "expense", "🐾", "#b99a72", 13),
    ("家庭育儿", "expense", "🧸", "#d08c78", 14),
    ("美容护理", "expense", "✨", "#b86f8a", 15),
    ("保险税费", "expense", "🛡️", "#667a62", 16),
    ("物业水电", "expense", "💡", "#c0a15f", 17),
    ("车险油费", "expense", "⛽", "#a96b4f", 18),
    ("数码家电", "expense", "💻", "#5f778c", 19),
    ("公益捐赠", "expense", "🤝", "#8a9b68", 20),
    ("其他支出", "expense", "🧾", "#827f77", 21),
    ("工资", "income", "💼", "#214f3b", 1),
    ("奖金", "income", "🏆", "#c8914b", 2),
    ("投资收益", "income", "📈", "#2f6049", 3),
    ("副业收入", "income", "🧩", "#6e8f7a", 4),
    ("报销退款", "income", "↩️", "#78a88a", 5),
    ("租金收入", "income", "🔑", "#9f7a45", 6),
    ("红包礼金", "income", "🧧", "#b46b4d", 7),
    ("其他收入", "income", "💰", "#827f77", 8),
]


def get_category_visual(name, category_type="expense"):
    category_name = name or ""
    for default_name, default_type, icon, color, _ in DEFAULT_CATEGORIES:
        if category_name == default_name and category_type == default_type:
            return icon, color
    keyword_visuals = [
        ("餐", "🍜", "#2f6049"),
        ("饭", "🍜", "#2f6049"),
        ("咖啡", "☕", "#8a6b4a"),
        ("房", "🏡", "#214f3b"),
        ("租", "🏡", "#214f3b"),
        ("购", "🛍️", "#c8914b"),
        ("买", "🛍️", "#c8914b"),
        ("车", "🚗", "#a96b4f"),
        ("油", "⛽", "#a96b4f"),
        ("交通", "🚇", "#78a88a"),
        ("医", "💊", "#6e8f7a"),
        ("药", "💊", "#6e8f7a"),
        ("学", "📚", "#9f7a45"),
        ("课", "📚", "#9f7a45"),
        ("礼", "🎁", "#bd7b62"),
        ("旅行", "✈️", "#4f7f8d"),
        ("健身", "🏃", "#7da36f"),
        ("宠物", "🐾", "#b99a72"),
        ("工资", "💼", "#214f3b"),
        ("奖金", "🏆", "#c8914b"),
        ("投资", "📈", "#2f6049"),
        ("退款", "↩️", "#78a88a"),
        ("红包", "🧧", "#b46b4d"),
    ]
    for keyword, icon, color in keyword_visuals:
        if keyword in category_name:
            return icon, color
    return ("💰", "#214f3b") if category_type == "income" else ("🧾", "#827f77")


def get_goal_visual(name):
    goal_name = name or ""
    keyword_visuals = [
        ("旅行", "✈️", "#4f7f8d"),
        ("旅游", "✈️", "#4f7f8d"),
        ("车", "🚗", "#a96b4f"),
        ("房", "🏡", "#214f3b"),
        ("家", "🏡", "#214f3b"),
        ("教育", "📚", "#9f7a45"),
        ("学习", "📚", "#9f7a45"),
        ("养老", "🌿", "#667a62"),
        ("退休", "🌿", "#667a62"),
        ("应急", "🛟", "#5f778c"),
        ("备用", "🛟", "#5f778c"),
        ("婚", "💍", "#b86f8a"),
        ("医疗", "💊", "#6e8f7a"),
        ("健康", "💊", "#6e8f7a"),
        ("投资", "📈", "#2f6049"),
        ("创业", "🧩", "#6e8f7a"),
        ("礼物", "🎁", "#bd7b62"),
    ]
    for keyword, icon, color in keyword_visuals:
        if keyword in goal_name:
            return icon, color
    return "🎯", "#214f3b"


def ensure_default_categories(conn):
    for name, category_type, icon, color, sort_order in DEFAULT_CATEGORIES:
        existing = conn.execute(
            "SELECT id, icon, color FROM categories WHERE name = ? AND type = ? AND is_active = 1",
            (name, category_type),
        ).fetchone()
        if existing:
            if not existing["icon"] or existing["icon"] == "•":
                conn.execute(
                    "UPDATE categories SET icon = ?, color = ?, sort_order = ? WHERE id = ?",
                    (icon, color, sort_order, existing["id"]),
                )
            continue
        conn.execute(
            "INSERT INTO categories (name, type, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)",
            (name, category_type, icon, color, sort_order),
        )


def ensure_column(conn, table, column, definition):
    if DATABASE_URL:
        existing = conn.execute(
            """
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            """,
            (table, column),
        ).fetchone()
        if not existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        return
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


class UnresolvedTransactionFxError(RuntimeError):
    pass


def normalize_legacy_transaction_fx(conn):
    conn.execute(
        """
        UPDATE transactions
        SET currency = (
            SELECT UPPER(TRIM(accounts.currency))
            FROM accounts
            WHERE accounts.id = transactions.account_id
        )
        WHERE base_amount IS NULL
          AND EXISTS (
              SELECT 1
              FROM accounts
              WHERE accounts.id = transactions.account_id
                AND currency IS NOT NULL
                AND TRIM(currency) != ''
          )
        """
    )
    conn.execute(
        """
        UPDATE transactions
        SET currency = ?,
            exchange_rate_to_base = 1,
            base_amount = amount,
            fx_status = 'base_currency'
        WHERE base_amount IS NULL
          AND account_id IN (
              SELECT id
              FROM accounts
              WHERE UPPER(COALESCE(NULLIF(TRIM(currency), ''), ?)) = ?
          )
        """,
        (BASE_CURRENCY, BASE_CURRENCY, BASE_CURRENCY),
    )
    conn.execute(
        """
        UPDATE transactions
        SET fx_status = 'captured'
        WHERE base_amount IS NOT NULL
          AND (fx_status IS NULL OR fx_status = 'unresolved')
        """
    )
    conn.execute(
        """
        UPDATE transactions
        SET fx_status = 'unresolved'
        WHERE base_amount IS NULL
        """
    )
    return conn.execute(
        "SELECT COUNT(*) AS count FROM transactions WHERE fx_status = 'unresolved'"
    ).fetchone()["count"]


def get_unresolved_transaction_fx(conn):
    return rows_to_dicts(conn.execute(
        """
        SELECT
            t.id, t.occurred_at, t.amount, t.currency,
            t.exchange_rate_to_base, a.name AS account_name
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.fx_status = 'unresolved'
        ORDER BY t.occurred_at, t.id
        """
    ).fetchall())


def resolve_transaction_fx(conn, rates):
    for transaction_id, rate in rates.items():
        normalized_rate = float(rate)
        if not math.isfinite(normalized_rate) or normalized_rate <= 0:
            raise ValueError(f"流水 {transaction_id} 的汇率必须大于 0")
        row = conn.execute(
            """
            SELECT id, amount
            FROM transactions
            WHERE id = ? AND fx_status = 'unresolved'
            """,
            (int(transaction_id),),
        ).fetchone()
        if not row:
            raise ValueError(f"流水 {transaction_id} 不存在或无需迁移")
        conn.execute(
            """
            UPDATE transactions
            SET exchange_rate_to_base = ?,
                base_amount = amount * ?,
                fx_status = 'resolved'
            WHERE id = ?
            """,
            (normalized_rate, normalized_rate, row["id"]),
        )


def finish_database_init(conn, allow_unresolved):
    # Operational keys stay outside version-1 financial backups.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS financial_commands (
            command_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
            response TEXT, invalidated INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)
    # Existing records keep their actual past balance effect; no silent balance rewrite.
    ensure_column(conn, "transactions", "balance_applied", "INTEGER NOT NULL DEFAULT 1")
    ensure_column(conn, "transactions", "voided_at", "TEXT")
    ensure_column(conn, "transactions", "void_reason", "TEXT")
    for field in ("quantity_before", "cost_before", "quantity_after", "cost_after", "settlement_rate"):
        ensure_column(conn, "investment_trades", field, "DOUBLE PRECISION")
    for field in ("voided_at", "void_reason", "account_currency"):
        ensure_column(conn, "investment_trades", field, "TEXT")
    unresolved_count = normalize_legacy_transaction_fx(conn)
    conn.commit()
    conn.close()
    if unresolved_count and not allow_unresolved:
        raise UnresolvedTransactionFxError(
            f"{unresolved_count} 笔历史外币流水缺少发生时汇率。"
            "请先运行 migrate_transaction_fx.py 导出并补录历史汇率。"
        )


def init_postgres_db(conn, allow_unresolved=False):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            owner TEXT DEFAULT '冠池',
            institution TEXT,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0,
            cash_available DOUBLE PRECISION NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base DOUBLE PRECISION NOT NULL DEFAULT 1,
            last4 TEXT,
            credit_limit DOUBLE PRECISION DEFAULT 0,
            statement_day INTEGER,
            repayment_day INTEGER,
            is_liability INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            opened_at TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "accounts", "owner", "TEXT DEFAULT '冠池'")
    ensure_column(conn, "accounts", "cash_available", "DOUBLE PRECISION NOT NULL DEFAULT 0")
    ensure_column(conn, "accounts", "exchange_rate_to_base", "DOUBLE PRECISION NOT NULL DEFAULT 1")
    ensure_column(conn, "accounts", "opened_at", "TEXT")
    conn.execute("UPDATE accounts SET owner = TRIM(institution) WHERE institution IS NOT NULL AND TRIM(institution) != ''")
    conn.execute("UPDATE accounts SET owner = '冠池' WHERE owner IS NULL OR TRIM(owner) = ''")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            icon TEXT,
            color TEXT,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            account_id INTEGER NOT NULL,
            category_id INTEGER,
            amount DOUBLE PRECISION NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base DOUBLE PRECISION NOT NULL DEFAULT 1,
            base_amount DOUBLE PRECISION,
            fx_status TEXT NOT NULL DEFAULT 'captured',
            direction TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            merchant TEXT,
            note TEXT,
            source TEXT DEFAULT 'manual',
            reference_id TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "transactions", "currency", "TEXT")
    ensure_column(conn, "transactions", "exchange_rate_to_base", "DOUBLE PRECISION")
    ensure_column(conn, "transactions", "base_amount", "DOUBLE PRECISION")
    ensure_column(conn, "transactions", "fx_status", "TEXT NOT NULL DEFAULT 'unresolved'")
    ensure_column(conn, "transactions", "reference_id", "TEXT")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id SERIAL PRIMARY KEY,
            name TEXT,
            code TEXT,
            buy_price DOUBLE PRECISION,
            quantity DOUBLE PRECISION,
            current_price DOUBLE PRECISION,
            account_id INTEGER,
            asset_type TEXT DEFAULT 'stock',
            market TEXT,
            currency TEXT DEFAULT 'CNY',
            exchange_rate_to_base DOUBLE PRECISION NOT NULL DEFAULT 1,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "holdings", "currency", "TEXT DEFAULT 'CNY'")
    ensure_column(conn, "holdings", "exchange_rate_to_base", "DOUBLE PRECISION NOT NULL DEFAULT 1")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS investment_trades (
            id SERIAL PRIMARY KEY,
            holding_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            trade_type TEXT NOT NULL,
            quantity DOUBLE PRECISION NOT NULL,
            price DOUBLE PRECISION NOT NULL,
            fee DOUBLE PRECISION NOT NULL DEFAULT 0,
            cash_amount DOUBLE PRECISION NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base DOUBLE PRECISION NOT NULL DEFAULT 1,
            base_amount DOUBLE PRECISION NOT NULL,
            occurred_at TEXT NOT NULL,
            note TEXT,
            created_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS prices (
            id SERIAL PRIMARY KEY,
            code TEXT NOT NULL,
            price DOUBLE PRECISION NOT NULL,
            price_date TEXT NOT NULL,
            source TEXT DEFAULT 'manual'
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS budgets (
            id SERIAL PRIMARY KEY,
            month TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            alert_threshold DOUBLE PRECISION DEFAULT 0.9,
            created_at TEXT,
            updated_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            target_amount DOUBLE PRECISION NOT NULL,
            current_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
            monthly_saving DOUBLE PRECISION DEFAULT 0,
            due_date TEXT,
            color TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS goal_records (
            id SERIAL PRIMARY KEY,
            goal_id INTEGER NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            recorded_at TEXT NOT NULL,
            note TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_date TEXT NOT NULL,
            asset_total DOUBLE PRECISION NOT NULL,
            liability_total DOUBLE PRECISION NOT NULL,
            net_worth DOUBLE PRECISION NOT NULL,
            investment_value DOUBLE PRECISION NOT NULL,
            cash_value DOUBLE PRECISION NOT NULL,
            created_at TEXT
        )
    """)

    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_investment_trades_account_date ON investment_trades(account_id, occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budgets_month_category ON budgets(month, category_id)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_month_category ON budgets(month, category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_code_date ON prices(code, price_date)")

    ensure_default_categories(conn)

    if os.environ.get("SEED_DEMO_DATA") == "1":
        seed_data(conn)
    finish_database_init(conn, allow_unresolved)


def init_db(allow_unresolved=False):
    conn = get_connection()
    if DATABASE_URL:
        init_postgres_db(conn, allow_unresolved)
        return

    conn.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            owner TEXT DEFAULT '冠池',
            institution TEXT,
            balance REAL NOT NULL DEFAULT 0,
            cash_available REAL NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base REAL NOT NULL DEFAULT 1,
            last4 TEXT,
            credit_limit REAL DEFAULT 0,
            statement_day INTEGER,
            repayment_day INTEGER,
            is_liability INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            opened_at TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "accounts", "owner", "TEXT DEFAULT '冠池'")
    ensure_column(conn, "accounts", "cash_available", "REAL NOT NULL DEFAULT 0")
    ensure_column(conn, "accounts", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1")
    ensure_column(conn, "accounts", "opened_at", "TEXT")
    conn.execute("UPDATE accounts SET owner = TRIM(institution) WHERE institution IS NOT NULL AND TRIM(institution) != ''")
    conn.execute("UPDATE accounts SET owner = '冠池' WHERE owner IS NULL OR TRIM(owner) = ''")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            icon TEXT,
            color TEXT,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            category_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base REAL NOT NULL DEFAULT 1,
            base_amount REAL,
            fx_status TEXT NOT NULL DEFAULT 'captured',
            direction TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            merchant TEXT,
            note TEXT,
            source TEXT DEFAULT 'manual',
            reference_id TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "transactions", "currency", "TEXT")
    ensure_column(conn, "transactions", "exchange_rate_to_base", "REAL")
    ensure_column(conn, "transactions", "base_amount", "REAL")
    ensure_column(conn, "transactions", "fx_status", "TEXT NOT NULL DEFAULT 'unresolved'")
    ensure_column(conn, "transactions", "reference_id", "TEXT")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            code TEXT,
            buy_price REAL,
            quantity REAL,
            current_price REAL
        )
    """)
    ensure_column(conn, "holdings", "account_id", "INTEGER")
    ensure_column(conn, "holdings", "asset_type", "TEXT DEFAULT 'stock'")
    ensure_column(conn, "holdings", "market", "TEXT")
    ensure_column(conn, "holdings", "currency", "TEXT DEFAULT 'CNY'")
    ensure_column(conn, "holdings", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1")
    ensure_column(conn, "holdings", "updated_at", "TEXT")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS investment_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            holding_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            trade_type TEXT NOT NULL,
            quantity REAL NOT NULL,
            price REAL NOT NULL,
            fee REAL NOT NULL DEFAULT 0,
            cash_amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base REAL NOT NULL DEFAULT 1,
            base_amount REAL NOT NULL,
            occurred_at TEXT NOT NULL,
            note TEXT,
            created_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            price REAL NOT NULL,
            price_date TEXT NOT NULL,
            source TEXT DEFAULT 'manual'
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            alert_threshold REAL DEFAULT 0.9,
            created_at TEXT,
            updated_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT,
            target_amount REAL NOT NULL,
            current_amount REAL NOT NULL DEFAULT 0,
            monthly_saving REAL DEFAULT 0,
            due_date TEXT,
            color TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS goal_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            recorded_at TEXT NOT NULL,
            note TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            asset_total REAL NOT NULL,
            liability_total REAL NOT NULL,
            net_worth REAL NOT NULL,
            investment_value REAL NOT NULL,
            cash_value REAL NOT NULL,
            created_at TEXT
        )
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_investment_trades_account_date ON investment_trades(account_id, occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budgets_month_category ON budgets(month, category_id)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_month_category ON budgets(month, category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_code_date ON prices(code, price_date)")

    ensure_default_categories(conn)

    if os.environ.get("SEED_DEMO_DATA") == "1":
        seed_data(conn)
    finish_database_init(conn, allow_unresolved)


def seed_data(conn):
    now = datetime.now().isoformat(timespec="seconds")
    today = date.today()
    current_month = today.strftime("%Y-%m")

    if conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO accounts
            (name, type, owner, institution, balance, last4, credit_limit, statement_day, repayment_day, is_liability, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("储蓄卡", "debit_card", "大宝", "招商银行", 128400, "6621", 0, None, None, 0, now, now),
                ("电子钱包", "wallet", "小宝", "微信 · 支付宝", 8650, None, 0, None, None, 0, now, now),
                ("投资账户", "investment", "大宝", "天天基金 · 富途", 474300, None, 0, None, None, 0, now, now),
                ("定期存款", "deposit", "小宝", "工商银行", 291350, "0912", 0, None, None, 0, now, now),
                ("招行信用卡", "credit_card", "大宝", "招商银行", 28600, "3382", 50000, 8, 18, 1, now, now),
                ("中信白金卡", "credit_card", "小宝", "中信银行", 11650, "7745", 80000, 15, 25, 1, now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO categories (name, type, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)",
            [
                ("居住", "expense", "🏠", "#214f3b", 1),
                ("餐饮", "expense", "🍜", "#2f6049", 2),
                ("购物", "expense", "🛒", "#c8914b", 3),
                ("交通", "expense", "🚕", "#df7f56", 4),
                ("娱乐", "expense", "🎬", "#b7ae9d", 5),
                ("医疗健康", "expense", "🏥", "#78a88a", 6),
                ("工资", "income", "💰", "#214f3b", 7),
                ("投资收益", "income", "📈", "#c8914b", 8),
            ],
        )

    account_ids = {
        row["name"]: row["id"]
        for row in conn.execute("SELECT id, name FROM accounts")
    }
    category_ids = {
        row["name"]: row["id"]
        for row in conn.execute("SELECT id, name FROM categories")
    }

    if conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0:
        base = today.replace(day=min(today.day, 7))
        transactions = [
            ("储蓄卡", "工资", 32000, "income", base.replace(day=5), "工资入账", "7月工资"),
            ("投资账户", "投资收益", 620, "income", base.replace(day=4), "基金定投分红", "分红"),
            ("储蓄卡", "居住", 6200, "expense", base.replace(day=1), "房租", "月租"),
            ("储蓄卡", "餐饮", 88, "expense", today, "午餐 · 云海肴", "午餐"),
            ("电子钱包", "交通", 46, "expense", today - timedelta(days=1), "滴滴出行", "打车"),
            ("招行信用卡", "购物", 432, "expense", today - timedelta(days=2), "山姆超市", "购物"),
            ("储蓄卡", "餐饮", 4032, "expense", base.replace(day=6), "日常餐饮", "月度汇总"),
            ("招行信用卡", "购物", 2778, "expense", base.replace(day=7), "电商购物", "月度汇总"),
            ("电子钱包", "交通", 2774, "expense", base.replace(day=7), "通勤交通", "月度汇总"),
            ("中信白金卡", "娱乐", 1540, "expense", base.replace(day=6), "影音娱乐", "月度汇总"),
            ("储蓄卡", "医疗健康", 630, "expense", base.replace(day=3), "药房", "健康"),
            ("投资账户", "投资收益", 9980, "income", base.replace(day=6), "投资收益", "月度收益"),
        ]
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base, base_amount,
             fx_status, direction, occurred_at, merchant, note, created_at, updated_at)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    account_ids[account_name],
                    category_ids[category_name],
                    amount,
                    amount,
                    direction,
                    occurred_at.isoformat(),
                    merchant,
                    note,
                    now,
                    now,
                )
                for account_name, category_name, amount, direction, occurred_at, merchant, note in transactions
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0:
        investment_account_id = account_ids.get("投资账户")
        conn.executemany(
            """
            INSERT INTO holdings
            (name, code, buy_price, quantity, current_price, account_id, asset_type, market, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("易方达蓝筹精选", "005827", 2.150, 39582, 2.486, investment_account_id, "fund", "CN", now),
                ("贵州茅台", "600519", 1620, 50, 1712, investment_account_id, "stock", "SH", now),
                ("天弘中证低ETF联接", "011613", 1.082, 68157, 1.118, investment_account_id, "bond", "CN", now),
                ("纳斯达克100 QDII", "160213", 3.240, 20013, 3.098, investment_account_id, "fund", "CN", now),
                ("博时黄金ETF", "159937", 5.680, 7737, 6.204, investment_account_id, "gold", "CN", now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM budgets WHERE month = ?", (current_month,)).fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO budgets (month, category_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [
                (current_month, category_ids["居住"], 7000, now, now),
                (current_month, category_ids["餐饮"], 4000, now, now),
                (current_month, category_ids["购物"], 5000, now, now),
                (current_month, category_ids["交通"], 4000, now, now),
                (current_month, category_ids["娱乐"], 3000, now, now),
                (current_month, category_ids["医疗健康"], 2000, now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO goals
            (name, icon, target_amount, current_amount, monthly_saving, due_date, color, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("环球旅行基金", "🏝️", 150000, 102000, 4000, "2027-06-30", "#c8914b", "active", now, now),
                ("购房首付", "🏠", 1200000, 504000, 6000, "2030-12-31", "#214f3b", "active", now, now),
                ("家庭应急金", "🛟", 200000, 156000, 2000, "2026-12-31", "#78a88a", "active", now, now),
                ("学习成长基金", "📚", 300000, 50000, 0, "2029-12-31", "#b46b4d", "paused", now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 0:
        snapshots = []
        for months_ago, net_worth in enumerate([480000, 510000, 540000, 530000, 630000, 670000, 720000, 780000, 862450][::-1]):
            snapshot_date = today - timedelta(days=months_ago * 30)
            asset_total = net_worth + 40250
            snapshots.append((
                snapshot_date.isoformat(),
                asset_total,
                40250,
                net_worth,
                min(474300, net_worth * 0.55),
                min(388102, net_worth * 0.45),
                now,
            ))
        conn.executemany(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth, investment_value, cash_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            snapshots,
        )
