from domain.catalog import get_category_visual
from infrastructure.database import get_connection, rows_to_dicts, family_write_connection
from schemas import CategoryCreate
from tenancy import get_auth_context


def list_categories(type: str | None = None):
    conn = get_connection()
    context = get_auth_context(conn)
    if type:
        rows = conn.execute(
            """
            SELECT * FROM categories
            WHERE family_id = ? AND is_active = 1 AND type = ?
            ORDER BY sort_order
            """,
            (context.family_id, type),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM categories
            WHERE family_id = ? AND is_active = 1
            ORDER BY type, sort_order
            """,
            (context.family_id,),
        ).fetchall()
    conn.close()
    return rows_to_dicts(rows)


def create_category(category: CategoryCreate):
    context = get_auth_context()
    with family_write_connection(context.family_id) as conn:
        existing = conn.execute(
            """
            SELECT id FROM categories
            WHERE family_id = ? AND name = ? AND type = ?
            """,
            (context.family_id, category.name, category.type),
        ).fetchone()
        if existing:
            return {"id": existing["id"], "message": "分类已存在"}
        max_order = conn.execute(
            """
            SELECT COALESCE(MAX(sort_order), 0) AS sort_order
            FROM categories WHERE family_id = ? AND type = ?
            """,
            (context.family_id, category.type),
        ).fetchone()["sort_order"]
        icon, color = get_category_visual(category.name, category.type)
        cursor = conn.execute(
            """
            INSERT INTO categories
            (family_id, name, type, icon, color, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(family_id, name, type) DO NOTHING
            RETURNING id
            """,
            (
                context.family_id,
                category.name,
                category.type,
                icon,
                color,
                max_order + 1,
            ),
        )
        created = cursor.fetchone()
        if created:
            return {"id": created["id"], "message": "分类已创建"}
        existing = conn.execute(
            """
            SELECT id FROM categories
            WHERE family_id = ? AND name = ? AND type = ?
            """,
            (context.family_id, category.name, category.type),
        ).fetchone()
        return {"id": existing["id"], "message": "分类已存在"}
