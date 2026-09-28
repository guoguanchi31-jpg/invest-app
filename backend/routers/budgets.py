from datetime import datetime

from fastapi import APIRouter, HTTPException

from commands import financial_command
from database import get_category_visual, get_connection, is_unique_violation
from schemas import BudgetBatchUpdate, BudgetCopyCreate, BudgetCreate
from services import get_budget_monthly


router = APIRouter(prefix="/budgets", tags=["budgets"])


def get_or_create_expense_category(conn, name):
    if not name:
        return None
    existing = conn.execute(
        "SELECT id FROM categories WHERE name = ? AND type = 'expense' AND is_active = 1",
        (name,),
    ).fetchone()
    if existing:
        return existing["id"]
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM categories WHERE type = 'expense'"
    ).fetchone()["sort_order"]
    icon, color = get_category_visual(name, "expense")
    cursor = conn.execute(
        "INSERT INTO categories (name, type, icon, color, sort_order) VALUES (?, 'expense', ?, ?, ?)",
        (name, icon, color, max_order + 1),
    )
    return cursor.lastrowid


@router.get("/monthly")
def monthly_budget(month: str | None = None):
    return get_budget_monthly(month)


@router.post("")
@financial_command
def create_or_update_budget(budget: BudgetCreate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    category_id = budget.category_id or get_or_create_expense_category(conn, budget.category_name)
    if not category_id:
        conn.close()
        return {"ok": False, "message": "请提供分类"}
    row = conn.execute(
        """
        INSERT INTO budgets (month, category_id, amount, alert_threshold, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(month, category_id) DO UPDATE
        SET amount = excluded.amount,
            alert_threshold = excluded.alert_threshold,
            updated_at = excluded.updated_at
        RETURNING id
        """,
        (budget.month, category_id, budget.amount, budget.alert_threshold, now, now),
    ).fetchone()
    budget_id = row["id"]
    conn.commit()
    conn.close()
    return {"id": budget_id, "message": "预算已保存"}


@router.post("/copy")
@financial_command
def copy_monthly_budget(payload: BudgetCopyCreate):
    if payload.source_month == payload.target_month:
        raise HTTPException(status_code=409, detail="来源月份和目标月份不能相同")
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT category_id, amount, alert_threshold
        FROM budgets
        WHERE month = ?
        ORDER BY id
        """,
        (payload.source_month,),
    ).fetchall()
    if not rows:
        conn.close()
        raise HTTPException(status_code=404, detail="来源月份没有可沿用的预算")
    copied = 0
    skipped = 0
    for row in rows:
        existing = conn.execute(
            "SELECT id FROM budgets WHERE month = ? AND category_id = ?",
            (payload.target_month, row["category_id"]),
        ).fetchone()
        if existing and not payload.overwrite:
            skipped += 1
            continue
        if existing:
            conn.execute(
                """
                UPDATE budgets
                SET amount = ?, alert_threshold = ?, updated_at = ?
                WHERE id = ?
                """,
                (row["amount"], row["alert_threshold"], now, existing["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO budgets
                (month, category_id, amount, alert_threshold, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.target_month,
                    row["category_id"],
                    row["amount"],
                    row["alert_threshold"],
                    now,
                    now,
                ),
            )
        copied += 1
    conn.commit()
    conn.close()
    return {
        "message": f"已沿用 {copied} 项预算",
        "copied": copied,
        "skipped": skipped,
    }


@router.patch("/batch")
@financial_command
def batch_update_budgets(payload: BudgetBatchUpdate):
    if not payload.items:
        raise HTTPException(status_code=409, detail="请至少选择一项预算")
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    updated = 0
    for item in payload.items:
        cursor = conn.execute(
            """
            UPDATE budgets
            SET amount = ?, updated_at = ?
            WHERE id = ?
            """,
            (item.amount, now, item.id),
        )
        updated += cursor.rowcount
    if updated != len(payload.items):
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=404, detail="部分预算不存在，未执行批量调整")
    conn.commit()
    conn.close()
    return {"message": f"已调整 {updated} 项预算", "updated": updated}


@router.patch("/{budget_id}")
@financial_command
def update_budget(budget_id: int, budget: BudgetCreate):
    now = datetime.now().isoformat(timespec="seconds")
    conn = get_connection()
    category_id = budget.category_id or get_or_create_expense_category(conn, budget.category_name)
    if not category_id:
        conn.close()
        return {"ok": False, "message": "请提供分类"}
    existing = conn.execute(
        "SELECT id FROM budgets WHERE id = ?",
        (budget_id,),
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="预算不存在")
    conflict = conn.execute(
        """
        SELECT id
        FROM budgets
        WHERE month = ? AND category_id = ? AND id != ?
        """,
        (budget.month, category_id, budget_id),
    ).fetchone()
    if conflict:
        conn.close()
        raise HTTPException(status_code=409, detail="该月份与分类已存在预算")
    try:
        conn.execute(
            """
            UPDATE budgets
            SET month = ?, category_id = ?, amount = ?, alert_threshold = ?, updated_at = ?
            WHERE id = ?
            """,
            (budget.month, category_id, budget.amount, budget.alert_threshold, now, budget_id),
        )
    except Exception as exc:
        conn.rollback()
        conn.close()
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="该月份与分类已存在预算") from exc
        raise
    conn.commit()
    conn.close()
    return {"message": "预算已更新"}


@router.delete("/{budget_id}")
@financial_command
def delete_budget(budget_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
    conn.commit()
    conn.close()
    return {"message": "预算已删除"}
