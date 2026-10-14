import os
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from uuid import uuid4

from migrations.schema import (
    CURRENT_SCHEMA_VERSION,
    run_schema_migrations,
    schema_version,
)
from domain.catalog import DEFAULT_CATEGORIES, get_category_visual, get_goal_visual
from domain.budgets import distribute_budget_category_allocations
from domain.money import money, rate
from fixtures.demo import seed_demo_data
from infrastructure.budget_allocations import sync_budget_member_allocations
from infrastructure.connection import PostgresConnection, open_connection
from security import bootstrap_password, hash_password


DB_DIR = os.environ.get("DB_DIR", ".")
DB = os.path.join(DB_DIR, "invest.db")
DATABASE_URL = os.environ.get("DATABASE_URL")
BASE_CURRENCY = os.environ.get("BASE_CURRENCY", "CNY").strip().upper() or "CNY"
IDENTITY_TABLES = ["families", "users", "family_members"]
FINANCIAL_TABLES = [
    "accounts", "categories", "transactions", "holdings", "investment_trades",
    "prices", "budget_plans", "budgets", "budget_category_allocations",
    "budget_member_allocations", "goals", "goal_allocations", "goal_records",
    "snapshots", "audit_events", "audit_event_accounts",
]
_command_connection = ContextVar("command_connection", default=None)
MIGRATION_LOCK_ID = 821_476_219
FAMILY_WRITE_LOCK_NAMESPACE = 821_476_221
# Frozen pre-migration bootstrap. New schema changes belong in migrations/schema.py.
BOOTSTRAP_BASELINE_VERSION = 0


def is_postgres_connection(conn):
    return isinstance(conn, PostgresConnection)


@contextmanager
def share_command_connection(conn):
    token = _command_connection.set(conn)
    try:
        yield
    finally:
        _command_connection.reset(token)


def get_connection():
    return open_connection(
        database_url=DATABASE_URL,
        db_dir=DB_DIR,
        db_path=DB,
    )


def current_command_connection():
    connection = _command_connection.get()
    if connection is None:
        raise RuntimeError("财务用例必须在 financial_command 事务中执行")
    return connection


def rows_to_dicts(rows):
    """Copy database rows without applying transport-layer coercion."""
    return [dict(row) for row in rows]


@contextmanager
def write_connection():
    """Serialize read/modify/write on SQLite; callers lock relevant PG rows."""
    if _command_connection.get() is not None:
        raise RuntimeError(
            "嵌套写事务不允许；应用用例必须显式使用 current_command_connection()"
        )
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


def lock_family_write(conn, family_id):
    """Acquire before command keys or business rows; hold until commit/rollback.

    PG advisory locks do not block MVCC readers or other families. SQLite's
    write owner already uses BEGIN IMMEDIATE. Reentrant within one transaction.
    Offline migrations remain exclusive operational tasks.
    """
    if is_postgres_connection(conn):
        conn.execute(
            "SELECT pg_advisory_xact_lock(?, ?)",
            (FAMILY_WRITE_LOCK_NAMESPACE, int(family_id)),
        )


@contextmanager
def family_write_connection(family_id):
    with write_connection() as conn:
        lock_family_write(conn, family_id)
        yield conn


@contextmanager
def consistent_read_connection():
    """Own a repeatable multi-table read transaction and always release it."""
    conn = get_connection()
    try:
        if is_postgres_connection(conn):
            conn.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        else:
            conn.execute("BEGIN")
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


def ensure_default_categories(conn, family_id=1):
    for name, category_type, icon, color, sort_order in DEFAULT_CATEGORIES:
        existing = conn.execute(
            """
            SELECT id, icon, color
            FROM categories
            WHERE family_id = ? AND name = ? AND type = ? AND is_active = 1
            """,
            (family_id, name, category_type),
        ).fetchone()
        if existing:
            if not existing["icon"] or existing["icon"] == "•":
                conn.execute(
                    "UPDATE categories SET icon = ?, color = ?, sort_order = ? WHERE id = ?",
                    (icon, color, sort_order, existing["id"]),
                )
            continue
        conn.execute(
            """
            INSERT INTO categories
            (family_id, name, type, icon, color, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (family_id, name, category_type, icon, color, sort_order),
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


def ensure_family_plan_tables(conn):
    serial = "SERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"
    money_type = "NUMERIC(24, 2)" if DATABASE_URL else "REAL"
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS budget_plans (
            id {serial},
            family_id INTEGER NOT NULL,
            month TEXT NOT NULL,
            total_amount {money_type} NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(family_id, month)
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS budget_member_allocations (
            id {serial},
            family_id INTEGER NOT NULL,
            budget_plan_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount {money_type} NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(budget_plan_id, member_id)
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS budget_category_allocations (
            id {serial},
            family_id INTEGER NOT NULL,
            budget_plan_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount {money_type} NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(budget_plan_id, category_id, member_id)
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS goal_allocations (
            id {serial},
            family_id INTEGER NOT NULL,
            goal_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            target_amount {money_type} NOT NULL,
            current_amount {money_type} NOT NULL DEFAULT 0,
            monthly_saving {money_type} NOT NULL DEFAULT 0,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(goal_id, member_id)
        )
    """)


def ensure_identity_tables(conn):
    serial = "SERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS families (
            id {serial},
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS users (
            id {serial},
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            token_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS family_members (
            id {serial},
            member_key TEXT,
            family_id INTEGER NOT NULL,
            user_id INTEGER,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    ensure_column(conn, "family_members", "member_key", "TEXT")
    for member in conn.execute(
        "SELECT id FROM family_members WHERE member_key IS NULL OR TRIM(member_key) = ''"
    ).fetchall():
        conn.execute(
            "UPDATE family_members SET member_key = ? WHERE id = ?",
            (uuid4().hex, member["id"]),
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_key ON family_members(member_key)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_user ON family_members(family_id, user_id)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_name ON family_members(family_id, display_name)"
    )

    now = datetime.now().isoformat(timespec="seconds")
    family = conn.execute("SELECT id FROM families ORDER BY id LIMIT 1").fetchone()
    if family:
        family_id = family["id"]
    else:
        family_id = conn.execute(
            "INSERT INTO families (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING id",
            (os.environ.get("APP_FAMILY_NAME", "我的家庭").strip() or "我的家庭", now, now),
        ).fetchone()["id"]

    default_username = os.environ.get("APP_USERNAME", "admin").strip().lower() or "admin"
    default_name = os.environ.get("APP_USER_NAME", "冠池").strip() or "冠池"
    owner = conn.execute(
        """
        SELECT fm.id AS member_id, fm.user_id
        FROM family_members fm
        JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = ? AND fm.role = 'owner'
          AND fm.is_active = 1 AND u.is_active = 1
        ORDER BY fm.id
        LIMIT 1
        """,
        (family_id,),
    ).fetchone()
    if owner:
        return family_id, owner["member_id"]

    user_count = conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
    if user_count:
        existing = conn.execute(
            """
            SELECT fm.id AS member_id, fm.user_id
            FROM family_members fm
            JOIN users u ON u.id = fm.user_id
            WHERE fm.family_id = ? AND fm.is_active = 1 AND u.is_active = 1
            ORDER BY fm.id
            LIMIT 1
            """,
            (family_id,),
        ).fetchone()
        if not existing:
            raise RuntimeError("家庭存在用户但缺少有效成员关系，请修复数据后重试")
        conn.execute(
            "UPDATE family_members SET role = 'owner', updated_at = ? WHERE id = ?",
            (now, existing["member_id"]),
        )
        return family_id, existing["member_id"]

    user_id = conn.execute(
            """
            INSERT INTO users
            (username, password_hash, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """,
            (
                default_username,
                hash_password(bootstrap_password()),
                default_name,
                now,
                now,
            ),
        ).fetchone()["id"]

    same_name = conn.execute(
        "SELECT id FROM family_members WHERE family_id = ? AND display_name = ?",
        (family_id, default_name),
    ).fetchone()
    if same_name:
        member_id = same_name["id"]
        conn.execute(
            """
            UPDATE family_members
            SET user_id = ?, role = 'owner', is_active = 1, updated_at = ?
            WHERE id = ?
            """,
            (user_id, now, member_id),
        )
    else:
        member_id = conn.execute(
            """
            INSERT INTO family_members
            (member_key, family_id, user_id, display_name, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'owner', ?, ?) RETURNING id
            """,
            (uuid4().hex, family_id, user_id, default_name, now, now),
        ).fetchone()["id"]
    return family_id, member_id


def migrate_family_scope(conn, family_id, default_member_id):
    ensure_column(conn, "accounts", "family_id", "INTEGER NOT NULL DEFAULT 1")
    ensure_column(conn, "accounts", "member_id", "INTEGER DEFAULT 1")
    now = datetime.now().isoformat(timespec="seconds")
    owner_rows = conn.execute(
        """
        SELECT DISTINCT TRIM(owner) AS owner
        FROM accounts
        WHERE owner IS NOT NULL AND TRIM(owner) != ''
        ORDER BY owner
        """
    ).fetchall()
    for row in owner_rows:
        owner = row["owner"]
        member = conn.execute(
            "SELECT id FROM family_members WHERE family_id = ? AND display_name = ?",
            (family_id, owner),
        ).fetchone()
        if not member:
            member_id = conn.execute(
                """
                INSERT INTO family_members
                (member_key, family_id, display_name, role, created_at, updated_at)
                VALUES (?, ?, ?, 'member', ?, ?) RETURNING id
                """,
                (uuid4().hex, family_id, owner, now, now),
            ).fetchone()["id"]
        else:
            member_id = member["id"]
        conn.execute(
            """
            UPDATE accounts
            SET family_id = ?, member_id = ?
            WHERE (family_id IS NULL OR family_id = ?)
              AND TRIM(COALESCE(owner, '')) = ?
            """,
            (family_id, member_id, family_id, owner),
        )
    conn.execute(
        "UPDATE accounts SET family_id = ? WHERE family_id IS NULL",
        (family_id,),
    )
    conn.execute(
        "UPDATE accounts SET member_id = ? WHERE member_id IS NULL",
        (default_member_id,),
    )

    scoped_tables = {
        "categories": False,
        "transactions": True,
        "holdings": True,
        "investment_trades": True,
        "prices": False,
        "budget_plans": False,
        "budgets": True,
        "budget_category_allocations": True,
        "budget_member_allocations": True,
        "goals": True,
        "goal_allocations": True,
        "goal_records": True,
        "snapshots": True,
    }
    for table, has_member in scoped_tables.items():
        ensure_column(conn, table, "family_id", "INTEGER NOT NULL DEFAULT 1")
        if has_member:
            ensure_column(conn, table, "member_id", "INTEGER")
        conn.execute(f"UPDATE {table} SET family_id = ? WHERE family_id IS NULL", (family_id,))

    # Legacy rows stored one category or goal per member. Preserve every amount
    # while promoting those rows into family plans with explicit member shares.
    budget_months = conn.execute(
        """
        SELECT month
        FROM budgets
        WHERE family_id = ?
        GROUP BY month
        ORDER BY month
        """,
        (family_id,),
    ).fetchall()
    for month_row in budget_months:
        month = month_row["month"]
        plan = conn.execute(
            """
            SELECT id FROM budget_plans
            WHERE family_id = ? AND month = ?
            """,
            (family_id, month),
        ).fetchone()
        source_rows = conn.execute(
            """
            SELECT id, member_id, category_id, amount, alert_threshold,
                   created_at, updated_at
            FROM budgets
            WHERE family_id = ? AND month = ?
            ORDER BY id
            """,
            (family_id, month),
        ).fetchall()
        if not plan:
            total_amount = sum(row["amount"] or 0 for row in source_rows)
            created_at = next(
                (row["created_at"] for row in source_rows if row["created_at"]),
                now,
            )
            plan_id = conn.execute(
                """
                INSERT INTO budget_plans
                (family_id, month, total_amount, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?) RETURNING id
                """,
                (family_id, month, total_amount, created_at, now),
            ).fetchone()["id"]
        else:
            plan_id = plan["id"]
        existing_allocation = conn.execute(
            """
            SELECT 1 FROM budget_member_allocations
            WHERE budget_plan_id = ? LIMIT 1
            """,
            (plan_id,),
        ).fetchone()
        if not existing_allocation:
            member_amounts = {}
            for row in source_rows:
                member_id = row["member_id"] or default_member_id
                member_amounts[member_id] = member_amounts.get(member_id, 0) + (row["amount"] or 0)
            for member_id, amount in member_amounts.items():
                conn.execute(
                    """
                    INSERT INTO budget_member_allocations
                    (family_id, budget_plan_id, member_id, amount, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (family_id, plan_id, member_id, amount, now, now),
                )
        category_rows = {}
        for row in source_rows:
            category_rows.setdefault(row["category_id"], []).append(row)
        for rows in category_rows.values():
            primary = rows[0]
            amount = sum(row["amount"] or 0 for row in rows)
            for duplicate in rows[1:]:
                conn.execute("DELETE FROM budgets WHERE id = ?", (duplicate["id"],))
            conn.execute(
                """
                UPDATE budgets
                SET member_id = NULL, amount = ?, updated_at = ?
                WHERE id = ?
                """,
                (amount, now, primary["id"]),
            )
        existing_category_allocations = conn.execute(
            """
            SELECT 1 FROM budget_category_allocations
            WHERE budget_plan_id = ? LIMIT 1
            """,
            (plan_id,),
        ).fetchone()
        if not existing_category_allocations:
            consolidated_categories = conn.execute(
                """
                SELECT category_id, amount
                FROM budgets
                WHERE family_id = ? AND month = ?
                ORDER BY id
                """,
                (family_id, month),
            ).fetchall()
            member_allocations = conn.execute(
                """
                SELECT member_id, amount
                FROM budget_member_allocations
                WHERE budget_plan_id = ?
                ORDER BY id
                """,
                (plan_id,),
            ).fetchall()
            matrix = distribute_budget_category_allocations(
                [(row["category_id"], row["amount"]) for row in consolidated_categories],
                [(row["member_id"], row["amount"]) for row in member_allocations],
                default_member_id,
            )
            for category_id, member_id, amount in matrix:
                conn.execute(
                    """
                    INSERT INTO budget_category_allocations
                    (family_id, budget_plan_id, category_id, member_id, amount,
                     created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (family_id, plan_id, category_id, member_id, amount, now, now),
                )
        sync_budget_member_allocations(conn, family_id, plan_id, now)

    goals = conn.execute(
        """
        SELECT id, member_id, target_amount, current_amount, monthly_saving,
               created_at
        FROM goals
        WHERE family_id = ?
        ORDER BY id
        """,
        (family_id,),
    ).fetchall()
    for goal in goals:
        member_id = goal["member_id"] or default_member_id
        allocation = conn.execute(
            "SELECT 1 FROM goal_allocations WHERE goal_id = ? LIMIT 1",
            (goal["id"],),
        ).fetchone()
        if not allocation:
            conn.execute(
                """
                INSERT INTO goal_allocations
                (family_id, goal_id, member_id, target_amount, current_amount,
                 monthly_saving, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    family_id, goal["id"], member_id, goal["target_amount"],
                    goal["current_amount"] or 0, goal["monthly_saving"] or 0,
                    goal["created_at"] or now, now,
                ),
            )
        if goal["member_id"] is not None:
            conn.execute(
                "UPDATE goals SET member_id = NULL, updated_at = ? WHERE id = ?",
                (now, goal["id"]),
            )

    for table in ("transactions", "holdings", "investment_trades"):
        conn.execute(
            f"""
            UPDATE {table}
            SET family_id = (
                    SELECT family_id FROM accounts WHERE accounts.id = {table}.account_id
                ),
                member_id = (
                    SELECT member_id FROM accounts WHERE accounts.id = {table}.account_id
                )
            WHERE account_id IN (SELECT id FROM accounts)
            """
        )
    conn.execute(
        """
        UPDATE goal_records
        SET family_id = (SELECT family_id FROM goals WHERE goals.id = goal_records.goal_id),
            member_id = COALESCE(
                member_id,
                (
                    SELECT goal_allocations.member_id
                    FROM goal_allocations
                    WHERE goal_allocations.goal_id = goal_records.goal_id
                    ORDER BY goal_allocations.id
                    LIMIT 1
                )
            )
        WHERE goal_id IN (SELECT id FROM goals)
        """
    )
    conn.execute("DROP INDEX IF EXISTS uq_budgets_month_category")
    conn.execute("DROP INDEX IF EXISTS uq_budgets_scope_month_category")
    conn.execute("DROP INDEX IF EXISTS idx_snapshots_date")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_family_month_category
        ON budgets(family_id, month, category_id)
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_scope_date
        ON snapshots(family_id, COALESCE(member_id, 0), snapshot_date)
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_accounts_family_member ON accounts(family_id, member_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_family_member ON transactions(family_id, member_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_holdings_family_member ON holdings(family_id, member_id)")
    conn.execute("DROP INDEX IF EXISTS idx_budgets_family_member")
    conn.execute("DROP INDEX IF EXISTS idx_goals_family_member")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budget_plans_family_month ON budget_plans(family_id, month)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budget_allocations_member ON budget_member_allocations(family_id, member_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budget_category_allocations_plan ON budget_category_allocations(budget_plan_id, category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budget_category_allocations_member ON budget_category_allocations(family_id, member_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_goal_allocations_member ON goal_allocations(family_id, member_id)")


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
    for transaction_id, raw_rate in rates.items():
        normalized_rate = rate(raw_rate)
        if normalized_rate <= 0:
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
                base_amount = ?,
                fx_status = 'resolved'
            WHERE id = ?
            """,
            (
                normalized_rate,
                money(money(row["amount"]) * normalized_rate),
                row["id"],
            ),
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
    ensure_column(conn, "financial_commands", "family_id", "INTEGER NOT NULL DEFAULT 1")
    ensure_column(conn, "financial_commands", "user_id", "INTEGER")
    serial = "SERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS audit_events (
            id {serial},
            family_id INTEGER NOT NULL,
            member_id INTEGER,
            actor_user_id INTEGER,
            actor_name TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            summary TEXT NOT NULL,
            reason TEXT,
            created_at TEXT NOT NULL
        )
    """)
    ensure_column(conn, "audit_events", "before_value", "TEXT")
    ensure_column(conn, "audit_events", "after_value", "TEXT")
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS audit_event_accounts (
            id {serial},
            family_id INTEGER NOT NULL,
            audit_event_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            UNIQUE(audit_event_id, account_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_family_created ON audit_events(family_id, created_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_account_event ON audit_event_accounts(account_id, audit_event_id)"
    )
    for entity_type, table in (
        ("transaction", "transactions"),
        ("holding", "holdings"),
        ("investment_trade", "investment_trades"),
    ):
        conn.execute(f"""
            INSERT INTO audit_event_accounts (family_id, audit_event_id, account_id)
            SELECT DISTINCT ae.family_id, ae.id, item.account_id
            FROM audit_events ae
            JOIN {table} item
              ON CAST(item.id AS TEXT) = ae.entity_id
             AND item.family_id = ae.family_id
            WHERE ae.entity_type = ? AND item.account_id IS NOT NULL
            ON CONFLICT(audit_event_id, account_id) DO NOTHING
        """, (entity_type,))
    conn.execute("""
        INSERT INTO audit_event_accounts (family_id, audit_event_id, account_id)
        SELECT DISTINCT ae.family_id, ae.id, account.id
        FROM audit_events ae
        JOIN accounts account
          ON CAST(account.id AS TEXT) = ae.entity_id
         AND account.family_id = ae.family_id
        WHERE ae.entity_type = 'account'
        ON CONFLICT(audit_event_id, account_id) DO NOTHING
    """)
    conn.execute("""
        INSERT INTO audit_event_accounts (family_id, audit_event_id, account_id)
        SELECT DISTINCT ae.family_id, ae.id, tx.account_id
        FROM audit_events ae
        JOIN transactions tx
          ON tx.reference_id = ae.entity_id
         AND tx.family_id = ae.family_id
        WHERE ae.entity_type = 'transfer'
        ON CONFLICT(audit_event_id, account_id) DO NOTHING
    """)
    # Existing records keep their actual past balance effect; no silent balance rewrite.
    ensure_column(conn, "transactions", "balance_applied", "INTEGER NOT NULL DEFAULT 1")
    ensure_column(conn, "transactions", "voided_at", "TEXT")
    ensure_column(conn, "transactions", "void_reason", "TEXT")
    for field in ("quantity_before", "quantity_after"):
        ensure_column(conn, "investment_trades", field, "NUMERIC(28, 8)")
    for field in ("cost_before", "cost_after"):
        ensure_column(conn, "investment_trades", field, "NUMERIC(24, 8)")
    ensure_column(conn, "investment_trades", "settlement_rate", "NUMERIC(24, 10)")
    for field in ("voided_at", "void_reason", "account_currency"):
        ensure_column(conn, "investment_trades", field, "TEXT")
    unresolved_count = normalize_legacy_transaction_fx(conn)
    run_schema_migrations(conn, is_postgres_connection(conn))
    if unresolved_count and not allow_unresolved:
        raise UnresolvedTransactionFxError(
            f"{unresolved_count} 笔历史外币流水缺少发生时汇率。"
            "请先运行 migrate_transaction_fx.py 导出并补录历史汇率。"
        )


def init_postgres_db(conn, allow_unresolved=False):
    family_id, default_member_id = ensure_identity_tables(conn)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            owner TEXT DEFAULT '冠池',
            institution TEXT,
            balance NUMERIC(24, 2) NOT NULL DEFAULT 0,
            cash_available NUMERIC(24, 2) NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base NUMERIC(24, 10) NOT NULL DEFAULT 1,
            last4 TEXT,
            credit_limit NUMERIC(24, 2) DEFAULT 0,
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
    ensure_column(conn, "accounts", "cash_available", "NUMERIC(24, 2) NOT NULL DEFAULT 0")
    ensure_column(conn, "accounts", "exchange_rate_to_base", "NUMERIC(24, 10) NOT NULL DEFAULT 1")
    ensure_column(conn, "accounts", "last4", "TEXT")
    ensure_column(conn, "accounts", "credit_limit", "NUMERIC(24, 2) DEFAULT 0")
    ensure_column(conn, "accounts", "statement_day", "INTEGER")
    ensure_column(conn, "accounts", "repayment_day", "INTEGER")
    ensure_column(conn, "accounts", "opened_at", "TEXT")
    conn.execute("""
        UPDATE accounts
        SET owner = TRIM(institution)
        WHERE (owner IS NULL OR TRIM(owner) = '')
          AND institution IS NOT NULL AND TRIM(institution) != ''
    """)
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
            amount NUMERIC(24, 2) NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base NUMERIC(24, 10) NOT NULL DEFAULT 1,
            base_amount NUMERIC(24, 2),
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
    ensure_column(conn, "transactions", "exchange_rate_to_base", "NUMERIC(24, 10)")
    ensure_column(conn, "transactions", "base_amount", "NUMERIC(24, 2)")
    ensure_column(conn, "transactions", "fx_status", "TEXT NOT NULL DEFAULT 'unresolved'")
    ensure_column(conn, "transactions", "reference_id", "TEXT")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id SERIAL PRIMARY KEY,
            name TEXT,
            code TEXT,
            buy_price NUMERIC(24, 8),
            quantity NUMERIC(28, 8),
            current_price NUMERIC(24, 8),
            account_id INTEGER,
            asset_type TEXT DEFAULT 'stock',
            market TEXT,
            currency TEXT DEFAULT 'CNY',
            exchange_rate_to_base NUMERIC(24, 10) NOT NULL DEFAULT 1,
            updated_at TEXT
        )
    """)
    ensure_column(conn, "holdings", "currency", "TEXT DEFAULT 'CNY'")
    ensure_column(conn, "holdings", "exchange_rate_to_base", "NUMERIC(24, 10) NOT NULL DEFAULT 1")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS investment_trades (
            id SERIAL PRIMARY KEY,
            holding_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            trade_type TEXT NOT NULL,
            quantity NUMERIC(28, 8) NOT NULL,
            price NUMERIC(24, 8) NOT NULL,
            fee NUMERIC(24, 8) NOT NULL DEFAULT 0,
            cash_amount NUMERIC(24, 2) NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            exchange_rate_to_base NUMERIC(24, 10) NOT NULL DEFAULT 1,
            base_amount NUMERIC(24, 2) NOT NULL,
            occurred_at TEXT NOT NULL,
            note TEXT,
            created_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS prices (
            id SERIAL PRIMARY KEY,
            code TEXT NOT NULL,
            price NUMERIC(24, 8) NOT NULL,
            price_date TEXT NOT NULL,
            source TEXT DEFAULT 'manual'
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS budgets (
            id SERIAL PRIMARY KEY,
            month TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            amount NUMERIC(24, 2) NOT NULL,
            alert_threshold NUMERIC(8, 6) DEFAULT 0.9,
            created_at TEXT,
            updated_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            target_amount NUMERIC(24, 2) NOT NULL,
            current_amount NUMERIC(24, 2) NOT NULL DEFAULT 0,
            monthly_saving NUMERIC(24, 2) DEFAULT 0,
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
            amount NUMERIC(24, 2) NOT NULL,
            recorded_at TEXT NOT NULL,
            note TEXT
        )
    """)
    ensure_family_plan_tables(conn)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_date TEXT NOT NULL,
            asset_total NUMERIC(24, 2) NOT NULL,
            liability_total NUMERIC(24, 2) NOT NULL,
            net_worth NUMERIC(24, 2) NOT NULL,
            investment_value NUMERIC(24, 2) NOT NULL,
            cash_value NUMERIC(24, 2) NOT NULL,
            created_at TEXT
        )
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_investment_trades_account_date ON investment_trades(account_id, occurred_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_budgets_month_category ON budgets(month, category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_code_date ON prices(code, price_date)")

    migrate_family_scope(conn, family_id, default_member_id)
    ensure_default_categories(conn, family_id)

    if os.environ.get("SEED_DEMO_DATA") == "1":
        seed_demo_data(conn)
        migrate_family_scope(conn, family_id, default_member_id)
    finish_database_init(conn, allow_unresolved)


def init_db(allow_unresolved=False):
    conn = get_connection()
    postgres = is_postgres_connection(conn)
    migration_lock = False
    try:
        if postgres:
            conn.execute("SELECT pg_advisory_lock(?)", (MIGRATION_LOCK_ID,))
            migration_lock = True
            init_postgres_db(conn, allow_unresolved)
            conn.commit()
            return

        conn.execute("BEGIN IMMEDIATE")
        family_id, default_member_id = ensure_identity_tables(conn)
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
        ensure_column(conn, "accounts", "last4", "TEXT")
        ensure_column(conn, "accounts", "credit_limit", "REAL DEFAULT 0")
        ensure_column(conn, "accounts", "statement_day", "INTEGER")
        ensure_column(conn, "accounts", "repayment_day", "INTEGER")
        ensure_column(conn, "accounts", "opened_at", "TEXT")
        conn.execute("""
        UPDATE accounts
        SET owner = TRIM(institution)
        WHERE (owner IS NULL OR TRIM(owner) = '')
          AND institution IS NOT NULL AND TRIM(institution) != ''
        """)
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
        ensure_family_plan_tables(conn)

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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(occurred_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_investment_trades_account_date ON investment_trades(account_id, occurred_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_budgets_month_category ON budgets(month, category_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_code_date ON prices(code, price_date)")

        migrate_family_scope(conn, family_id, default_member_id)
        ensure_default_categories(conn, family_id)

        if os.environ.get("SEED_DEMO_DATA") == "1":
            seed_demo_data(conn)
            migrate_family_scope(conn, family_id, default_member_id)
        finish_database_init(conn, allow_unresolved)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if postgres and migration_lock:
            try:
                conn.execute("SELECT pg_advisory_unlock(?)", (MIGRATION_LOCK_ID,))
            except Exception:
                pass
        conn.close()


def get_schema_version():
    conn = get_connection()
    try:
        return schema_version(conn)
    finally:
        conn.close()


def assert_schema_current():
    version = get_schema_version()
    if version != CURRENT_SCHEMA_VERSION:
        raise RuntimeError(
            f"数据库结构版本为 {version}，应用要求 {CURRENT_SCHEMA_VERSION}；请先运行 python migrate.py"
        )
