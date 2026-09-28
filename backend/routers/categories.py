from fastapi import APIRouter

from database import get_category_visual, get_connection, rows_to_dicts
from schemas import CategoryCreate


router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories(type: str | None = None):
    conn = get_connection()
    if type:
        rows = conn.execute(
            "SELECT * FROM categories WHERE is_active = 1 AND type = ? ORDER BY sort_order",
            (type,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM categories WHERE is_active = 1 ORDER BY type, sort_order"
        ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


@router.post("")
def create_category(category: CategoryCreate):
    conn = get_connection()
    existing = conn.execute(
        "SELECT id FROM categories WHERE name = ? AND type = ? AND is_active = 1",
        (category.name, category.type),
    ).fetchone()
    if existing:
        conn.close()
        return {"id": existing["id"], "message": "分类已存在"}
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM categories WHERE type = ?",
        (category.type,),
    ).fetchone()["sort_order"]
    icon, color = get_category_visual(category.name, category.type)
    cursor = conn.execute(
        "INSERT INTO categories (name, type, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)",
        (
            category.name,
            category.type,
            icon,
            color,
            max_order + 1,
        ),
    )
    conn.commit()
    category_id = cursor.lastrowid
    conn.close()
    return {"id": category_id, "message": "分类已创建"}
