"""Scoped ledger reads. Business writes and HTTP responses live elsewhere."""
from fastapi import HTTPException

from domain.reconciliation import transaction_application_state
from infrastructure.database import rows_to_dicts
from infrastructure.read_models import consistent_query
from queries.finance import month_range
from tenancy import get_auth_context, scoped_account_clause


@consistent_query
def query_ledger(
    month=None,
    account_id=None,
    owner=None,
    direction=None,
    source=None,
    category_id=None,
    date_from=None,
    date_to=None,
    search=None,
    context=None,
    page=None,
    page_size=30,
    record_scope="all_records",
    *,
    conn=None,
):
    context = context or get_auth_context(conn)
    account_scope, account_scope_params = scoped_account_clause("a", context)
    clauses = [account_scope]
    params = list(account_scope_params)
    if month:
        clauses.append("substr(t.occurred_at, 1, 7) = ?")
        params.append(month)
    if account_id:
        clauses.append("t.account_id = ?")
        params.append(account_id)
    if owner:
        clauses.append("a.owner = ?")
        params.append(owner)
    if direction in {"income", "expense"}:
        clauses.append("t.direction = ?")
        params.append(direction)
    if source and source != "all":
        clauses.append("COALESCE(t.source, 'manual') = ?")
        params.append(source)
    if record_scope == "effective":
        clauses.append("t.voided_at IS NULL")
        if source not in {"opening", "adjustment"}:
            clauses.append("COALESCE(t.source, 'manual') NOT IN ('opening', 'adjustment')")
    elif record_scope == "voided":
        clauses.append("t.voided_at IS NOT NULL")
    elif record_scope != "all_records":
        raise HTTPException(status_code=422, detail="流水记录范围无效")
    if category_id:
        clauses.append("t.category_id = ?")
        params.append(category_id)
    if date_from:
        clauses.append("t.occurred_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("t.occurred_at <= ?")
        params.append(date_to)
    if search:
        clauses.append(
            """
            (
                LOWER(COALESCE(t.merchant, '')) LIKE ?
                OR LOWER(COALESCE(t.note, '')) LIKE ?
                OR LOWER(COALESCE(c.name, '')) LIKE ?
                OR LOWER(COALESCE(a.name, '')) LIKE ?
                OR LOWER(COALESCE(a.owner, '')) LIKE ?
            )
            """
        )
        keyword = f"%{search.strip().lower()}%"
        params.extend([keyword] * 5)

    total_count = None
    summary = None
    if page is None:
        query = f"""
        WITH matched AS (
            SELECT t.id, t.reference_id FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE {" AND ".join(clauses)}
        )
        SELECT
            t.*, a.name AS account_name, a.owner AS account_owner,
            a.opened_at AS account_opened_at,
            c.name AS category_name, c.icon, c.color
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id IN (SELECT id FROM matched)
           OR (t.source = 'transfer' AND t.reference_id IN (SELECT reference_id FROM matched))
        ORDER BY t.occurred_at DESC, t.id DESC
        """
        query_params = tuple(params)
    else:
        page_size = min(max(int(page_size), 1), 100)
        page = max(int(page), 1)
        entity_expression = """
            CASE
                WHEN t.source = 'transfer' AND t.reference_id IS NOT NULL
                THEN 'transfer:' || t.reference_id
                ELSE 'row:' || CAST(t.id AS TEXT)
            END
        """
        query = f"""
        WITH matched AS (
            SELECT t.id, t.reference_id FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE {" AND ".join(clauses)}
        ),
        expanded AS (
            SELECT t.id, t.occurred_at, {entity_expression} AS entity_key
            FROM transactions t
            WHERE t.id IN (SELECT id FROM matched)
               OR (t.source = 'transfer' AND t.reference_id IN (SELECT reference_id FROM matched))
        ),
        ranked AS (
            SELECT entity_key, MAX(occurred_at) AS occurred_at, MAX(id) AS sort_id
            FROM expanded
            GROUP BY entity_key
        ),
        selected AS (
            SELECT entity_key, COUNT(*) OVER() AS total_count
            FROM ranked
            ORDER BY occurred_at DESC, sort_id DESC
            LIMIT ? OFFSET ?
        )
        SELECT
            t.*, a.name AS account_name, a.owner AS account_owner,
            a.opened_at AS account_opened_at,
            c.name AS category_name, c.icon, c.color,
            selected.total_count
        FROM expanded
        JOIN selected ON selected.entity_key = expanded.entity_key
        JOIN transactions t ON t.id = expanded.id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        ORDER BY t.occurred_at DESC, t.id DESC
        """
        query_params = (*params, page_size, (page - 1) * page_size)
        summary_row = conn.execute(
            f"""
            WITH matched AS (
                SELECT t.id
                FROM transactions t
                LEFT JOIN accounts a ON a.id = t.account_id
                LEFT JOIN categories c ON c.id = t.category_id
                WHERE {" AND ".join(clauses)}
            )
            SELECT
                COUNT(DISTINCT CASE
                    WHEN t.source = 'transfer' AND t.reference_id IS NOT NULL
                    THEN 'transfer:' || t.reference_id
                    ELSE 'row:' || CAST(t.id AS TEXT)
                END) AS total,
                COALESCE(SUM(CASE
                    WHEN COALESCE(t.source, 'manual') = 'manual' AND t.voided_at IS NULL AND t.direction = 'income'
                    THEN t.base_amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE
                    WHEN COALESCE(t.source, 'manual') = 'manual' AND t.voided_at IS NULL AND t.direction = 'expense'
                    THEN t.base_amount ELSE 0 END), 0) AS expense,
                COUNT(DISTINCT CASE
                    WHEN COALESCE(t.source, 'manual') != 'manual' AND t.voided_at IS NULL
                    THEN CASE
                        WHEN t.source = 'transfer' AND t.reference_id IS NOT NULL
                        THEN 'transfer:' || t.reference_id
                        ELSE 'row:' || CAST(t.id AS TEXT)
                    END
                END) AS other,
                COUNT(DISTINCT CASE
                    WHEN t.voided_at IS NOT NULL
                    THEN CASE
                        WHEN t.source = 'transfer' AND t.reference_id IS NOT NULL
                        THEN 'transfer:' || t.reference_id
                        ELSE 'row:' || CAST(t.id AS TEXT)
                    END
                END) AS voided
            FROM transactions t
            WHERE t.id IN (SELECT id FROM matched)
            """,
            tuple(params),
        ).fetchone()
        summary = {
            "income": summary_row["income"] or 0,
            "expense": summary_row["expense"] or 0,
            "other": summary_row["other"] or 0,
            "voided": summary_row["voided"] or 0,
        }
        total_count = summary_row["total"] or 0

    rows = rows_to_dicts(conn.execute(query, query_params).fetchall())
    if rows and page is not None:
        for row in rows:
            row.pop("total_count", None)

    ledger = []
    transfer_groups = {}
    for row in rows:
        item = {
            **row,
            "source": row.get("source") or "manual",
            "kind": row.get("source") or "manual",
            "application": transaction_application_state(
                {"opened_at": row["account_opened_at"]}, row,
            ),
        }
        if item["source"] == "transfer" and not item.get("reference_id"):
            prefix = "from" if item["direction"] == "expense" else "to"
            item[f"{prefix}_account_id"] = item["account_id"]
            item[f"{prefix}_account_name"] = item["account_name"]
            item[f"{prefix}_account_owner"] = item["account_owner"]
        if item["source"] != "transfer" or not item.get("reference_id"):
            ledger.append(item)
            continue
        transfer_groups.setdefault(item["reference_id"], []).append(item)

    for reference_id, legs in transfer_groups.items():
        outgoing = next((item for item in legs if item["direction"] == "expense"), None)
        incoming = next((item for item in legs if item["direction"] == "income"), None)
        anchor = outgoing or incoming
        ledger.append({
            "id": f"transfer:{reference_id}",
            "reference_id": reference_id,
            "source": "transfer",
            "kind": "transfer",
            "direction": "transfer",
            "occurred_at": anchor["occurred_at"],
            "amount": outgoing["amount"] if outgoing else anchor["amount"],
            "base_amount": anchor["base_amount"],
            "currency": outgoing["currency"] if outgoing else anchor["currency"],
            "merchant": "资金划转",
            "note": anchor.get("note"),
            "account_id": outgoing["account_id"] if outgoing else None,
            "account_name": outgoing["account_name"] if outgoing else None,
            "account_owner": outgoing["account_owner"] if outgoing else None,
            "from_account_id": outgoing["account_id"] if outgoing else None,
            "from_account_name": outgoing["account_name"] if outgoing else None,
            "from_account_owner": outgoing["account_owner"] if outgoing else None,
            "to_account_id": incoming["account_id"] if incoming else None,
            "to_account_name": incoming["account_name"] if incoming else None,
            "to_account_owner": incoming["account_owner"] if incoming else None,
            "legs": legs,
            "voided_at": anchor.get("voided_at"),
            "void_reason": anchor.get("void_reason"),
        })
    result = sorted(
        ledger,
        key=lambda item: (item.get("occurred_at") or "", str(item.get("id") or "")),
        reverse=True,
    )
    if page is None:
        return result
    return {
        "items": result,
        "page": page,
        "page_size": page_size,
        "total": total_count or 0,
        "summary": summary,
    }


@consistent_query
def list_transactions(month=None, range_key="month", *, conn=None):
    context = get_auth_context(conn)
    account_scope, params = scoped_account_clause("a", context)
    clauses = [account_scope, "COALESCE(t.source, 'manual') = 'manual'", "t.voided_at IS NULL"]
    if month:
        months = month_range(month, range_key)
        placeholders = ",".join("?" for _ in months)
        clauses.append(f"substr(t.occurred_at, 1, 7) IN ({placeholders})")
        params.extend(months)
    return rows_to_dicts(conn.execute(
        f"""
        SELECT t.*, a.name AS account_name, a.owner AS account_owner, c.name AS category_name, c.icon, c.color
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE {" AND ".join(clauses)}
        ORDER BY t.occurred_at DESC
        """,
        tuple(params),
    ).fetchall())


@consistent_query
def ledger_export_rows(*, conn=None):
    account_scope, params = scoped_account_clause("a", get_auth_context(conn))
    return rows_to_dicts(conn.execute(
        f"""
        SELECT t.*, a.name AS account_name, a.owner AS account_owner,
               c.name AS category_name
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE {account_scope}
        ORDER BY t.occurred_at DESC, t.id DESC
        """,
        tuple(params),
    ).fetchall())
