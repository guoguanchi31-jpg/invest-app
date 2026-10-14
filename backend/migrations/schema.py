"""Versioned schema hardening applied by the explicit migration command."""

import re

from domain.dates import stored_business_date
from domain.snapshot_compatibility import normalize_legacy_snapshot_rows


CURRENT_SCHEMA_VERSION = 12


BUSINESS_DATE_COLUMNS = {
    "accounts": {"opened_at": True},
    "transactions": {"occurred_at": False},
    "investment_trades": {"occurred_at": False},
    "prices": {"price_date": False},
    "goals": {"due_date": True},
    "goal_records": {"recorded_at": False},
    "snapshots": {"snapshot_date": False},
}


REFERENCE_RULES = (
    ("family_members", ("family_id",), "families", ("id",), False),
    ("family_members", ("user_id",), "users", ("id",), True),
    ("accounts", ("member_id", "family_id"), "family_members", ("id", "family_id"), False),
    ("categories", ("family_id",), "families", ("id",), False),
    ("transactions", ("account_id", "family_id"), "accounts", ("id", "family_id"), False),
    ("transactions", ("category_id", "family_id"), "categories", ("id", "family_id"), True),
    ("holdings", ("account_id", "family_id"), "accounts", ("id", "family_id"), True),
    ("holdings", ("member_id", "family_id"), "family_members", ("id", "family_id"), True),
    ("investment_trades", ("account_id", "family_id"), "accounts", ("id", "family_id"), False),
    ("investment_trades", ("holding_id", "family_id"), "holdings", ("id", "family_id"), False),
    ("prices", ("family_id",), "families", ("id",), False),
    ("budget_plans", ("family_id",), "families", ("id",), False),
    ("budgets", ("category_id", "family_id"), "categories", ("id", "family_id"), False),
    ("budget_category_allocations", ("budget_plan_id", "family_id"), "budget_plans", ("id", "family_id"), False),
    ("budget_category_allocations", ("category_id", "family_id"), "categories", ("id", "family_id"), False),
    ("budget_category_allocations", ("member_id", "family_id"), "family_members", ("id", "family_id"), False),
    ("budget_member_allocations", ("budget_plan_id", "family_id"), "budget_plans", ("id", "family_id"), False),
    ("budget_member_allocations", ("member_id", "family_id"), "family_members", ("id", "family_id"), False),
    ("goals", ("family_id",), "families", ("id",), False),
    ("goal_allocations", ("goal_id", "family_id"), "goals", ("id", "family_id"), False),
    ("goal_allocations", ("member_id", "family_id"), "family_members", ("id", "family_id"), False),
    ("goal_records", ("goal_id", "family_id"), "goals", ("id", "family_id"), False),
    ("goal_records", ("member_id", "family_id"), "family_members", ("id", "family_id"), True),
    ("snapshots", ("member_id", "family_id"), "family_members", ("id", "family_id"), True),
    ("audit_events", ("member_id", "family_id"), "family_members", ("id", "family_id"), True),
    ("audit_events", ("actor_user_id",), "users", ("id",), True),
    ("audit_event_accounts", ("audit_event_id", "family_id"), "audit_events", ("id", "family_id"), False),
    ("audit_event_accounts", ("account_id", "family_id"), "accounts", ("id", "family_id"), False),
)


POSTGRES_NUMERIC_COLUMNS = {
    "accounts": {
        "balance": (24, 2),
        "cash_available": (24, 2),
        "exchange_rate_to_base": (24, 10),
        "credit_limit": (24, 2),
    },
    "transactions": {
        "amount": (24, 2),
        "exchange_rate_to_base": (24, 10),
        "base_amount": (24, 2),
    },
    "holdings": {
        "buy_price": (24, 8),
        "quantity": (28, 8),
        "current_price": (24, 8),
        "exchange_rate_to_base": (24, 10),
    },
    "investment_trades": {
        "quantity": (28, 8),
        "price": (24, 8),
        "fee": (24, 8),
        "cash_amount": (24, 2),
        "exchange_rate_to_base": (24, 10),
        "base_amount": (24, 2),
        "quantity_before": (28, 8),
        "cost_before": (24, 8),
        "quantity_after": (28, 8),
        "cost_after": (24, 8),
        "settlement_rate": (24, 10),
    },
    "prices": {"price": (24, 8)},
    "budget_plans": {"total_amount": (24, 2)},
    "budgets": {"amount": (24, 2), "alert_threshold": (8, 6)},
    "budget_category_allocations": {"amount": (24, 2)},
    "budget_member_allocations": {"amount": (24, 2)},
    "goals": {
        "target_amount": (24, 2),
        "current_amount": (24, 2),
        "monthly_saving": (24, 2),
    },
    "goal_allocations": {
        "target_amount": (24, 2),
        "current_amount": (24, 2),
        "monthly_saving": (24, 2),
    },
    "goal_records": {"amount": (24, 2)},
    "snapshots": {
        "asset_total": (24, 2),
        "liability_total": (24, 2),
        "net_worth": (24, 2),
        "investment_value": (24, 2),
        "cash_value": (24, 2),
    },
}


CHECK_RULES = {
    "accounts": (
        ("account_fx_positive", "exchange_rate_to_base > 0"),
        ("account_credit_nonnegative", "credit_limit >= 0"),
    ),
    "transactions": (
        ("transaction_amount_positive", "amount > 0"),
        ("transaction_fx_positive", "exchange_rate_to_base > 0"),
        ("transaction_direction_valid", "direction IN ('income', 'expense')"),
    ),
    "holdings": (
        ("holding_quantity_nonnegative", "quantity >= 0"),
        ("holding_prices_nonnegative", "buy_price >= 0 AND current_price >= 0"),
        ("holding_fx_positive", "exchange_rate_to_base > 0"),
    ),
    "investment_trades": (
        ("trade_quantity_positive", "quantity > 0"),
        ("trade_price_positive", "price > 0"),
        ("trade_fee_nonnegative", "fee >= 0"),
        ("trade_cash_positive", "cash_amount > 0"),
        ("trade_fx_positive", "exchange_rate_to_base > 0"),
        ("trade_type_valid", "trade_type IN ('buy', 'sell')"),
    ),
    "prices": (("price_positive", "price > 0"),),
    "budget_plans": (("budget_total_positive", "total_amount > 0"),),
    "budgets": (
        ("budget_amount_positive", "amount > 0"),
        ("budget_threshold_valid", "alert_threshold > 0 AND alert_threshold <= 1"),
    ),
    "budget_category_allocations": (("budget_category_amount_nonnegative", "amount >= 0"),),
    "budget_member_allocations": (("budget_member_amount_nonnegative", "amount >= 0"),),
    "goals": (
        ("goal_target_positive", "target_amount > 0"),
        ("goal_current_nonnegative", "current_amount >= 0"),
        ("goal_monthly_nonnegative", "monthly_saving >= 0"),
        ("goal_status_valid", "status IN ('active', 'paused', 'completed', 'archived')"),
    ),
    "goal_allocations": (
        ("goal_allocation_target_positive", "target_amount > 0"),
        ("goal_allocation_current_nonnegative", "current_amount >= 0"),
        ("goal_allocation_monthly_nonnegative", "monthly_saving >= 0"),
    ),
}


def _quoted_columns(columns):
    return ", ".join(f'"{column}"' for column in columns)


def _match(prefix, columns):
    return " AND ".join(
        f'{prefix}."{column}" = parent."{parent_column}"'
        for column, parent_column in zip(columns[0], columns[1])
    )


def _assert_existing_integrity(conn):
    for child, child_columns, parent, parent_columns, nullable in REFERENCE_RULES:
        nullable_clause = (
            " AND ".join(f'child."{column}" IS NOT NULL' for column in child_columns)
            if nullable
            else "1 = 1"
        )
        match = _match("child", (child_columns, parent_columns))
        row = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM "{child}" child
            WHERE {nullable_clause}
              AND NOT EXISTS (
                  SELECT 1 FROM "{parent}" parent WHERE {match}
              )
            """
        ).fetchone()
        if row["count"]:
            raise RuntimeError(
                f"无法启用数据约束：{child} 有 {row['count']} 条记录未关联 {parent}"
            )


def _postgres_constraint_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = ?",
        (name,),
    ).fetchone() is not None


def _merge_duplicate_categories(conn):
    groups = conn.execute(
        """
        SELECT family_id, name, type, MIN(id) AS keep_id
        FROM categories
        GROUP BY family_id, name, type
        HAVING COUNT(*) > 1
        """
    ).fetchall()
    for group in groups:
        duplicates = conn.execute(
            """
            SELECT id FROM categories
            WHERE family_id = ? AND name = ? AND type = ? AND id != ?
            ORDER BY id
            """,
            (group["family_id"], group["name"], group["type"], group["keep_id"]),
        ).fetchall()
        for duplicate in duplicates:
            duplicate_id = duplicate["id"]
            conn.execute(
                "UPDATE transactions SET category_id = ? WHERE category_id = ?",
                (group["keep_id"], duplicate_id),
            )
            allocations = conn.execute(
                """
                SELECT id, budget_plan_id, member_id, amount
                FROM budget_category_allocations
                WHERE category_id = ?
                """,
                (duplicate_id,),
            ).fetchall()
            for allocation in allocations:
                existing = conn.execute(
                    """
                    SELECT id FROM budget_category_allocations
                    WHERE budget_plan_id = ? AND category_id = ? AND member_id = ?
                    """,
                    (
                        allocation["budget_plan_id"],
                        group["keep_id"],
                        allocation["member_id"],
                    ),
                ).fetchone()
                if existing:
                    conn.execute(
                        """
                        UPDATE budget_category_allocations
                        SET amount = ROUND(amount + ?, 2)
                        WHERE id = ?
                        """,
                        (allocation["amount"], existing["id"]),
                    )
                    conn.execute(
                        "DELETE FROM budget_category_allocations WHERE id = ?",
                        (allocation["id"],),
                    )
                else:
                    conn.execute(
                        "UPDATE budget_category_allocations SET category_id = ? WHERE id = ?",
                        (group["keep_id"], allocation["id"]),
                    )
            budgets = conn.execute(
                "SELECT * FROM budgets WHERE category_id = ? ORDER BY id",
                (duplicate_id,),
            ).fetchall()
            for budget in budgets:
                existing = conn.execute(
                    """
                    SELECT id FROM budgets
                    WHERE family_id = ? AND month = ? AND category_id = ?
                    """,
                    (budget["family_id"], budget["month"], group["keep_id"]),
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE budgets SET amount = ROUND(amount + ?, 2) WHERE id = ?",
                        (budget["amount"], existing["id"]),
                    )
                    conn.execute("DELETE FROM budgets WHERE id = ?", (budget["id"],))
                else:
                    conn.execute(
                        "UPDATE budgets SET category_id = ? WHERE id = ?",
                        (group["keep_id"], budget["id"]),
                    )
            conn.execute("DELETE FROM categories WHERE id = ?", (duplicate_id,))


def _apply_postgres_hardening(conn):
    for table, columns in POSTGRES_NUMERIC_COLUMNS.items():
        for column, (precision, scale) in columns.items():
            conn.execute(
                f"""
                ALTER TABLE "{table}"
                ALTER COLUMN "{column}" TYPE NUMERIC({precision}, {scale})
                USING ROUND("{column}"::numeric, {scale})
                """
            )

    for table in (
        "family_members",
        "accounts",
        "categories",
        "holdings",
        "budget_plans",
        "goals",
        "audit_events",
    ):
        conn.execute(
            f'CREATE UNIQUE INDEX IF NOT EXISTS "uq_{table}_id_family" '
            f'ON "{table}"(id, family_id)'
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_family_name_type "
        "ON categories(family_id, name, type)"
    )

    for index, (child, child_columns, parent, parent_columns, _) in enumerate(REFERENCE_RULES, 1):
        name = f"fk_integrity_{index}"
        if _postgres_constraint_exists(conn, name):
            continue
        conn.execute(
            f'ALTER TABLE "{child}" ADD CONSTRAINT "{name}" '
            f'FOREIGN KEY ({_quoted_columns(child_columns)}) '
            f'REFERENCES "{parent}" ({_quoted_columns(parent_columns)})'
        )
    for table, rules in CHECK_RULES.items():
        for name, expression in rules:
            if not _postgres_constraint_exists(conn, name):
                conn.execute(
                    f'ALTER TABLE "{table}" ADD CONSTRAINT "{name}" CHECK ({expression})'
                )


def _sqlite_guard(conn, name, table, timing, condition, message):
    conn.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS "{name}"
        BEFORE {timing} ON "{table}"
        WHEN {condition}
        BEGIN
            SELECT RAISE(ABORT, '{message}');
        END
        """
    )


def _apply_sqlite_hardening(conn):
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_family_name_type "
        "ON categories(family_id, name, type)"
    )
    for index, (child, child_columns, parent, parent_columns, nullable) in enumerate(REFERENCE_RULES, 1):
        null_guard = (
            " AND ".join(f'NEW."{column}" IS NOT NULL' for column in child_columns)
            if nullable
            else "1 = 1"
        )
        match = _match("NEW", (child_columns, parent_columns))
        condition = (
            f"{null_guard} AND NOT EXISTS "
            f'(SELECT 1 FROM "{parent}" parent WHERE {match})'
        )
        _sqlite_guard(
            conn,
            f"fk_integrity_{index}_insert",
            child,
            "INSERT",
            condition,
            f"invalid reference: {child} -> {parent}",
        )
        _sqlite_guard(
            conn,
            f"fk_integrity_{index}_update",
            child,
            "UPDATE",
            condition,
            f"invalid reference: {child} -> {parent}",
        )
        reverse_match = " AND ".join(
            f'child."{column}" = OLD."{parent_column}"'
            for column, parent_column in zip(child_columns, parent_columns)
        )
        _sqlite_guard(
            conn,
            f"fk_integrity_{index}_delete",
            parent,
            "DELETE",
            f'EXISTS (SELECT 1 FROM "{child}" child WHERE {reverse_match})',
            f"referenced row: {parent} <- {child}",
        )
    for table, rules in CHECK_RULES.items():
        for name, expression in rules:
            condition = f"NOT ({expression})"
            for column in {
                token
                for token in expression.replace("(", " ").replace(")", " ").split()
                if token.replace("_", "").isalnum()
                and token.upper() not in {"AND", "OR", "IN", "NOT", "NULL"}
                and not token.replace(".", "", 1).isdigit()
                and not token.startswith("'")
            }:
                condition = re.sub(
                    rf"\b{re.escape(column)}\b",
                    f'NEW."{column}"',
                    condition,
                )
            _sqlite_guard(conn, f"{name}_insert", table, "INSERT", condition, name)
            _sqlite_guard(conn, f"{name}_update", table, "UPDATE", condition, name)


def migration_001_exact_values_and_constraints(conn, is_postgres):
    _merge_duplicate_categories(conn)
    _assert_existing_integrity(conn)
    if is_postgres:
        _apply_postgres_hardening(conn)
    else:
        _apply_sqlite_hardening(conn)


def migration_002_budget_category_responsibility(conn, is_postgres):
    rules = (
        ("plan", ("budget_plan_id", "family_id"), "budget_plans", ("id", "family_id")),
        ("category", ("category_id", "family_id"), "categories", ("id", "family_id")),
        ("member", ("member_id", "family_id"), "family_members", ("id", "family_id")),
    )
    _assert_existing_integrity(conn)
    if is_postgres:
        conn.execute(
            """
            ALTER TABLE budget_category_allocations
            ALTER COLUMN amount TYPE NUMERIC(24, 2)
            USING ROUND(amount::numeric, 2)
            """
        )
        for suffix, child_columns, parent, parent_columns in rules:
            name = f"fk_budget_category_{suffix}"
            if not _postgres_constraint_exists(conn, name):
                conn.execute(
                    f'ALTER TABLE budget_category_allocations ADD CONSTRAINT "{name}" '
                    f'FOREIGN KEY ({_quoted_columns(child_columns)}) '
                    f'REFERENCES "{parent}" ({_quoted_columns(parent_columns)})'
                )
        if not _postgres_constraint_exists(conn, "budget_category_amount_nonnegative"):
            conn.execute(
                """
                ALTER TABLE budget_category_allocations
                ADD CONSTRAINT budget_category_amount_nonnegative CHECK (amount >= 0)
                """
            )
        return

    for suffix, child_columns, parent, parent_columns in rules:
        match = _match("NEW", (child_columns, parent_columns))
        _sqlite_guard(
            conn,
            f"fk_budget_category_{suffix}_insert",
            "budget_category_allocations",
            "INSERT",
            f'NOT EXISTS (SELECT 1 FROM "{parent}" parent WHERE {match})',
            f"invalid reference: budget_category_allocations -> {parent}",
        )
        _sqlite_guard(
            conn,
            f"fk_budget_category_{suffix}_update",
            "budget_category_allocations",
            "UPDATE",
            f'NOT EXISTS (SELECT 1 FROM "{parent}" parent WHERE {match})',
            f"invalid reference: budget_category_allocations -> {parent}",
        )
        reverse_match = " AND ".join(
            f'child."{column}" = OLD."{parent_column}"'
            for column, parent_column in zip(child_columns, parent_columns)
        )
        _sqlite_guard(
            conn,
            f"fk_budget_category_{suffix}_delete",
            parent,
            "DELETE",
            (
                "EXISTS (SELECT 1 FROM budget_category_allocations child "
                f"WHERE {reverse_match})"
            ),
            f"referenced row: {parent} <- budget_category_allocations",
        )
    _sqlite_guard(
        conn,
        "budget_category_amount_nonnegative_v2_insert",
        "budget_category_allocations",
        "INSERT",
        "NOT (NEW.amount >= 0)",
        "budget_category_amount_nonnegative",
    )
    _sqlite_guard(
        conn,
        "budget_category_amount_nonnegative_v2_update",
        "budget_category_allocations",
        "UPDATE",
        "NOT (NEW.amount >= 0)",
        "budget_category_amount_nonnegative",
    )


def migration_003_background_job_status(conn, _is_postgres):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS background_job_status (
            job_key TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            last_started_at TEXT,
            last_succeeded_at TEXT,
            last_failed_at TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )


def _assert_existing_account_states(conn):
    invalid = conn.execute(
        """
        SELECT id, family_id, name, cash_available
        FROM accounts
        WHERE type = 'investment'
          AND is_liability = 0
          AND cash_available < 0
        ORDER BY family_id, id
        LIMIT 20
        """
    ).fetchall()
    if not invalid:
        return
    examples = ", ".join(
        f"family={row['family_id']} account={row['id']} "
        f"name={row['name']!r} cash_available={row['cash_available']}"
        for row in invalid
    )
    raise RuntimeError(
        "无法启用投资现金非负约束：发现存量异常；请先核对并以可追溯调整修复。"
        f"示例：{examples}"
    )


def migration_004_investment_cash_invariant(conn, is_postgres):
    _assert_existing_account_states(conn)
    name = "investment_cash_nonnegative"
    expression = "type != 'investment' OR is_liability != 0 OR cash_available >= 0"
    if is_postgres:
        if not _postgres_constraint_exists(conn, name):
            conn.execute(
                f'ALTER TABLE accounts ADD CONSTRAINT "{name}" CHECK ({expression})'
            )
        return
    condition = (
        "NOT (NEW.type != 'investment' OR NEW.is_liability != 0 "
        "OR NEW.cash_available >= 0)"
    )
    _sqlite_guard(
        conn,
        f"{name}_insert",
        "accounts",
        "INSERT",
        condition,
        name,
    )
    _sqlite_guard(
        conn,
        f"{name}_update",
        "accounts",
        "UPDATE",
        condition,
        name,
    )


def _column_names(conn, table, is_postgres):
    if is_postgres:
        rows = conn.execute(
            """
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table,),
        ).fetchall()
    else:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def migration_005_financial_command_lifecycle(conn, is_postgres):
    columns = _column_names(conn, "financial_commands", is_postgres)
    additions = {
        "status": "TEXT NOT NULL DEFAULT 'processing'",
        "completed_at": "TEXT",
        "response_expires_at": "TEXT",
        "invalidated_at": "TEXT",
        "updated_at": "TEXT",
    }
    for column, definition in additions.items():
        if column not in columns:
            conn.execute(
                f'ALTER TABLE financial_commands ADD COLUMN "{column}" {definition}'
            )
    conn.execute(
        """
        UPDATE financial_commands
        SET status = CASE
                WHEN invalidated = 1 THEN 'invalidated'
                WHEN response IS NOT NULL THEN 'committed'
                ELSE 'processing'
            END,
            completed_at = CASE
                WHEN response IS NOT NULL THEN COALESCE(completed_at, created_at)
                ELSE completed_at
            END,
            updated_at = COALESCE(updated_at, created_at),
            invalidated_at = CASE
                WHEN invalidated = 1 THEN COALESCE(invalidated_at, created_at)
                ELSE invalidated_at
            END
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_financial_commands_retention
        ON financial_commands(status, response_expires_at, command_key)
        """
    )
    status_rule = "status IN ('processing', 'committed', 'expired', 'invalidated')"
    if is_postgres:
        if not _postgres_constraint_exists(conn, "financial_command_status_valid"):
            conn.execute(
                "ALTER TABLE financial_commands "
                f"ADD CONSTRAINT financial_command_status_valid CHECK ({status_rule})"
            )
    else:
        _sqlite_guard(
            conn,
            "financial_command_status_valid_insert",
            "financial_commands",
            "INSERT",
            f"NOT (NEW.{status_rule})",
            "financial_command_status_valid",
        )
        _sqlite_guard(
            conn,
            "financial_command_status_valid_update",
            "financial_commands",
            "UPDATE",
            f"NOT (NEW.{status_rule})",
            "financial_command_status_valid",
        )


def migration_006_background_job_runs(conn, is_postgres):
    columns = _column_names(conn, "background_job_status", is_postgres)
    for column, definition in {
        "current_run_id": "TEXT",
        "last_requested_for": "TEXT",
    }.items():
        if column not in columns:
            conn.execute(
                f'ALTER TABLE background_job_status ADD COLUMN "{column}" {definition}'
            )
    serial = "SERIAL PRIMARY KEY" if is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS background_job_runs (
            id {serial},
            job_key TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            requested_for TEXT,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            error TEXT,
            result_summary TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_background_job_runs_lookup
        ON background_job_runs(job_key, started_at)
        """
    )


def migration_007_command_response_expiry_backfill(conn, is_postgres):
    if is_postgres:
        conn.execute(
            """
            UPDATE financial_commands
            SET response_expires_at = (
                created_at::timestamp + INTERVAL '90 days'
            )::text
            WHERE status = 'committed'
              AND response IS NOT NULL
              AND response_expires_at IS NULL
            """
        )
    else:
        conn.execute(
            """
            UPDATE financial_commands
            SET response_expires_at = datetime(created_at, '+90 days')
            WHERE status = 'committed'
              AND response IS NOT NULL
              AND response_expires_at IS NULL
            """
        )


def migration_008_stable_import_namespace(conn, is_postgres):
    if "import_reference_namespace" not in _column_names(conn, "accounts", is_postgres):
        conn.execute("ALTER TABLE accounts ADD COLUMN import_reference_namespace TEXT")
    conn.execute(
        "UPDATE accounts SET import_reference_namespace = CAST(id AS TEXT) "
        "WHERE import_reference_namespace IS NULL"
    )


def migration_009_history_and_audit_contracts(conn, is_postgres):
    if "history_basis" not in _column_names(conn, "accounts", is_postgres):
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN history_basis TEXT NOT NULL DEFAULT 'unknown' "
            "CHECK(history_basis IN ('unknown', 'opening_transaction', 'zero_opening'))"
        )
    if "payload_version" not in _column_names(conn, "audit_events", is_postgres):
        conn.execute(
            "ALTER TABLE audit_events ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 0 "
            "CHECK(payload_version >= 0)"
        )


def _date_migration_error(table, row_id, field, value):
    raise RuntimeError(
        "无法统一历史日期："
        f"{table}.id={row_id} 的 {field}={value!r} "
        "既不是 YYYY-MM-DD，也不是可无歧义转换的 YYYYMMDD"
    )


def _normalize_stored_dates(conn):
    changes = []
    snapshots = []
    for table, fields in BUSINESS_DATE_COLUMNS.items():
        selected = ", ".join(["id", *fields])
        if table == "snapshots":
            selected += ", family_id, member_id, created_at"
        for row in conn.execute(f"SELECT {selected} FROM {table} ORDER BY id").fetchall():
            for field, nullable in fields.items():
                try:
                    normalized = stored_business_date(row[field], nullable=nullable)
                except (TypeError, ValueError):
                    _date_migration_error(table, row["id"], field, row[field])
                if table == "snapshots":
                    snapshots.append((dict(row), normalized))
                elif normalized != row[field]:
                    changes.append((table, field, normalized, row["id"]))

    for table, field, value, row_id in changes:
        conn.execute(
            f'UPDATE "{table}" SET "{field}" = ? WHERE id = ?',
            (value, row_id),
        )

    grouped_snapshots = {}
    for row, normalized in snapshots:
        key = (row["family_id"], row["member_id"], normalized)
        grouped_snapshots.setdefault(key, []).append((row, normalized))
    for rows in grouped_snapshots.values():
        winner, normalized = max(
            rows,
            key=lambda item: (item[0].get("created_at") or "", item[0]["id"]),
        )
        loser_ids = [row["id"] for row, _ in rows if row["id"] != winner["id"]]
        for loser_id in loser_ids:
            conn.execute("DELETE FROM snapshots WHERE id = ?", (loser_id,))
        if winner["snapshot_date"] != normalized:
            conn.execute(
                "UPDATE snapshots SET snapshot_date = ? WHERE id = ?",
                (normalized, winner["id"]),
            )


def _postgres_date_expression(field):
    quoted = f'"{field}"'
    return (
        f"{quoted} IS NULL OR CASE "
        f"WHEN {quoted} ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}$' "
        f"THEN to_char(to_date({quoted}, 'YYYY-MM-DD'), 'YYYY-MM-DD') = {quoted} "
        "ELSE FALSE END"
    )


def _sqlite_date_condition(field):
    quoted = f'NEW."{field}"'
    pattern = (
        "[0-9][0-9][0-9][0-9]-"
        "[0-9][0-9]-[0-9][0-9]"
    )
    return (
        f"{quoted} IS NOT NULL AND ("
        f"length({quoted}) != 10 OR {quoted} NOT GLOB '{pattern}' "
        f"OR date({quoted}) IS NULL OR date({quoted}) != {quoted})"
    )


def migration_010_canonical_business_dates(conn, is_postgres):
    _normalize_stored_dates(conn)
    for table, fields in BUSINESS_DATE_COLUMNS.items():
        for field in fields:
            name = f"business_date_{table}_{field}"
            if is_postgres:
                if not _postgres_constraint_exists(conn, name):
                    conn.execute(
                        f'ALTER TABLE "{table}" ADD CONSTRAINT "{name}" '
                        f"CHECK ({_postgres_date_expression(field)})"
                    )
                continue
            condition = _sqlite_date_condition(field)
            _sqlite_guard(
                conn, f"{name}_insert", table, "INSERT", condition, name,
            )
            _sqlite_guard(
                conn, f"{name}_update", table, "UPDATE", condition, name,
            )


def migration_011_upgrade_compatibility(conn, is_postgres):
    snapshot_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT id, family_id, member_id, snapshot_date, created_at
            FROM snapshots
            ORDER BY id
            """
        ).fetchall()
    ]
    normalized_snapshots, compatibility = normalize_legacy_snapshot_rows(
        snapshot_rows,
    )
    discarded_ids = {
        item["id"]
        for collision in compatibility["collisions"]
        for item in collision["discarded"]
    }
    for row_id in sorted(discarded_ids):
        conn.execute("DELETE FROM snapshots WHERE id = ?", (row_id,))
    for row in normalized_snapshots:
        if row["id"] not in discarded_ids:
            conn.execute(
                "UPDATE snapshots SET snapshot_date = ? WHERE id = ?",
                (row["snapshot_date"], row["id"]),
            )

    columns = _column_names(conn, "financial_commands", is_postgres)
    for column, definition in {
        "fingerprint_version": "INTEGER NOT NULL DEFAULT 0",
        "data_scope": "TEXT",
    }.items():
        if column not in columns:
            conn.execute(
                f'ALTER TABLE financial_commands ADD COLUMN "{column}" {definition}'
            )
    if is_postgres:
        if not _postgres_constraint_exists(conn, "financial_command_fingerprint_version_valid"):
            conn.execute(
                "ALTER TABLE financial_commands "
                "ADD CONSTRAINT financial_command_fingerprint_version_valid "
                "CHECK (fingerprint_version IN (0, 1, 2))"
            )
        if not _postgres_constraint_exists(conn, "financial_command_scope_valid"):
            conn.execute(
                "ALTER TABLE financial_commands "
                "ADD CONSTRAINT financial_command_scope_valid "
                "CHECK (data_scope IS NULL OR data_scope IN ('personal', 'family'))"
            )
        return
    _sqlite_guard(
        conn,
        "financial_command_fingerprint_version_valid_insert",
        "financial_commands",
        "INSERT",
        "NEW.fingerprint_version NOT IN (0, 1, 2)",
        "financial_command_fingerprint_version_valid",
    )
    _sqlite_guard(
        conn,
        "financial_command_fingerprint_version_valid_update",
        "financial_commands",
        "UPDATE",
        "NEW.fingerprint_version NOT IN (0, 1, 2)",
        "financial_command_fingerprint_version_valid",
    )
    for timing in ("INSERT", "UPDATE"):
        _sqlite_guard(
            conn,
            f"financial_command_scope_valid_{timing.lower()}",
            "financial_commands",
            timing,
            (
                "NEW.data_scope IS NOT NULL "
                "AND NEW.data_scope NOT IN ('personal', 'family')"
            ),
            "financial_command_scope_valid",
        )


def migration_012_rename_shopping_category(conn, _is_postgres):
    shopping_rows = conn.execute(
        """
        SELECT id, family_id
        FROM categories
        WHERE name = '购物' AND type = 'expense'
        ORDER BY id
        """
    ).fetchall()
    for shopping in shopping_rows:
        clothing = conn.execute(
            """
            SELECT id
            FROM categories
            WHERE family_id = ? AND name = '服饰' AND type = 'expense'
            """,
            (shopping["family_id"],),
        ).fetchone()
        if not clothing:
            conn.execute(
                """
                UPDATE categories
                SET name = '服饰', icon = '👕'
                WHERE id = ?
                """,
                (shopping["id"],),
            )
            continue

        clothing_id = clothing["id"]
        old_budget_rows = conn.execute(
            """
            SELECT id, month, amount
            FROM budgets
            WHERE family_id = ? AND category_id = ?
            ORDER BY id
            """,
            (shopping["family_id"], shopping["id"]),
        ).fetchall()
        for old_budget in old_budget_rows:
            existing = conn.execute(
                """
                SELECT id
                FROM budgets
                WHERE family_id = ? AND month = ? AND category_id = ?
                """,
                (shopping["family_id"], old_budget["month"], clothing_id),
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE budgets SET amount = amount + ? WHERE id = ?",
                    (old_budget["amount"], existing["id"]),
                )
                conn.execute("DELETE FROM budgets WHERE id = ?", (old_budget["id"],))
            else:
                conn.execute(
                    "UPDATE budgets SET category_id = ? WHERE id = ?",
                    (clothing_id, old_budget["id"]),
                )

        old_allocations = conn.execute(
            """
            SELECT id, budget_plan_id, member_id, amount
            FROM budget_category_allocations
            WHERE family_id = ? AND category_id = ?
            ORDER BY id
            """,
            (shopping["family_id"], shopping["id"]),
        ).fetchall()
        for old_allocation in old_allocations:
            existing = conn.execute(
                """
                SELECT id
                FROM budget_category_allocations
                WHERE budget_plan_id = ? AND category_id = ? AND member_id = ?
                """,
                (
                    old_allocation["budget_plan_id"],
                    clothing_id,
                    old_allocation["member_id"],
                ),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE budget_category_allocations
                    SET amount = amount + ?
                    WHERE id = ?
                    """,
                    (old_allocation["amount"], existing["id"]),
                )
                conn.execute(
                    "DELETE FROM budget_category_allocations WHERE id = ?",
                    (old_allocation["id"],),
                )
            else:
                conn.execute(
                    """
                    UPDATE budget_category_allocations
                    SET category_id = ?
                    WHERE id = ?
                    """,
                    (clothing_id, old_allocation["id"]),
                )

        conn.execute(
            "UPDATE transactions SET category_id = ? WHERE category_id = ?",
            (clothing_id, shopping["id"]),
        )
        conn.execute("DELETE FROM categories WHERE id = ?", (shopping["id"],))


MIGRATIONS = (
    (1, migration_001_exact_values_and_constraints),
    (2, migration_002_budget_category_responsibility),
    (3, migration_003_background_job_status),
    (4, migration_004_investment_cash_invariant),
    (5, migration_005_financial_command_lifecycle),
    (6, migration_006_background_job_runs),
    (7, migration_007_command_response_expiry_backfill),
    (8, migration_008_stable_import_namespace),
    (9, migration_009_history_and_audit_contracts),
    (10, migration_010_canonical_business_dates),
    (11, migration_011_upgrade_compatibility),
    (12, migration_012_rename_shopping_category),
)


def run_schema_migrations(conn, is_postgres):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )
    applied = {
        row["version"]
        for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
    }
    for version, migration in MIGRATIONS:
        if version in applied:
            continue
        migration(conn, is_postgres)
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
            (version,),
        )


def schema_version(conn):
    try:
        row = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
        ).fetchone()
    except Exception:
        return 0
    return int(row["version"] or 0)
