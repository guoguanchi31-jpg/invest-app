"""Read-only ledger reconciliation. This module never repairs persisted data."""

from domain.reconciliation import reconstruct_account_state
from tenancy import can_edit_member, scoped_account_clause


def account_reconciliation(conn, context):
    account_scope, scope_params = scoped_account_clause("a", context)
    accounts = [
        dict(row)
        for row in conn.execute(
            f"""
            SELECT a.*
            FROM accounts a
            WHERE {account_scope}
            ORDER BY a.id
            """,
            tuple(scope_params),
        ).fetchall()
    ]
    if not accounts:
        return {
            "scope": context.scope,
            "family_id": context.family_id,
            "items": [],
            "difference_count": 0,
            "application_issue_count": 0,
            "repair_performed": False,
        }

    account_ids = [account["id"] for account in accounts]
    placeholders = ",".join("?" for _ in account_ids)
    transaction_rows = conn.execute(
        f"""
        SELECT id, account_id, amount, direction, source, occurred_at,
               balance_applied, voided_at
        FROM transactions
        WHERE account_id IN ({placeholders})
        ORDER BY account_id, id
        """,
        tuple(account_ids),
    ).fetchall()
    trade_rows = conn.execute(
        f"""
        SELECT account_id, trade_type, cash_amount
        FROM investment_trades
        WHERE account_id IN ({placeholders})
          AND voided_at IS NULL
        ORDER BY account_id, id
        """,
        tuple(account_ids),
    ).fetchall()

    history_rows = {}
    for row in transaction_rows:
        history_rows.setdefault(row["account_id"], []).append(dict(row))
    trades_by_account = {}
    for row in trade_rows:
        trades_by_account.setdefault(row["account_id"], []).append(dict(row))

    items = []
    for account in accounts:
        account_id = account["id"]
        reconciliation = reconstruct_account_state(
            account,
            history_rows.get(account_id, []),
            trades_by_account.get(account_id, []),
        )
        history = reconciliation["history"]
        application = reconciliation["application"]
        history_complete = history["status"] == "complete"
        application_consistent = application["balance_application_consistent"]
        reconstructable = history_complete and application_consistent
        limitation = None
        if not history_complete:
            limitation = "缺少可证明期初状态的历史事实，差异只能报告，不能自动修复"
        elif not application_consistent:
            limitation = (
                "流水余额应用标记与建账日期不一致；当前余额即使吻合也不能视为账本正常，"
                "请逐笔核对后使用受控更正"
            )
        elif not application["marker_consistent"]:
            limitation = (
                "已撤销流水存在历史应用标记异常；不影响当前余额，保留原记录供审计核对"
            )
        items.append({
            "account_id": account_id,
            "account_name": account["name"],
            "member_id": account["member_id"],
            "owner": account["owner"],
            "currency": account["currency"],
            "can_correct": bool(account["is_active"] and can_edit_member(account["member_id"], context)),
            "account_type": account["type"],
            "is_liability": bool(account["is_liability"]),
            **{key: value for key, value in reconciliation.items() if key != "history"},
            "reconstructable": reconstructable,
            "history": history,
            "application": application,
            "healthy": (
                history_complete
                and application["marker_consistent"]
                and reconciliation["matches"]
            ),
            "limitation": limitation,
        })
    return {
        "scope": context.scope,
        "family_id": context.family_id,
        "items": items,
        "difference_count": sum(not item["matches"] for item in items),
        "application_issue_count": sum(
            item["application"]["issue_count"] for item in items
        ),
        "repair_performed": False,
    }
