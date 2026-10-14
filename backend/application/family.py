from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException

from audit import record_audit_event
from infrastructure.database import (
    is_postgres_connection,
    is_unique_violation,
    family_write_connection,
)
from infrastructure.read_models import consistent_query
from schemas import FamilyMemberCreate, FamilyMemberUpdate, FamilyUpdate
from security import hash_password
from tenancy import assert_family_admin, get_auth_context


MEMBER_REMOVAL_REFERENCES = (
    ("accounts", "账户"),
    ("transactions", "流水"),
    ("holdings", "持仓"),
    ("investment_trades", "投资交易"),
    ("budgets", "预算"),
    ("budget_member_allocations", "预算成员分配"),
    ("budget_category_allocations", "预算分类分配"),
    ("goals", "储蓄目标"),
    ("goal_allocations", "目标成员分配"),
    ("goal_records", "目标积累记录"),
)


def member_removal_references(conn, family_id, member_id):
    references = []
    for table, label in MEMBER_REMOVAL_REFERENCES:
        if conn.execute(
            f"""
            SELECT 1 FROM {table}
            WHERE family_id = ? AND member_id = ?
            LIMIT 1
            """,
            (family_id, member_id),
        ).fetchone():
            references.append(label)
    return references


def family_payload(conn, context):
    family = conn.execute(
        "SELECT id, name, created_at, updated_at FROM families WHERE id = ?",
        (context.family_id,),
    ).fetchone()
    members = conn.execute(
        """
        SELECT
            fm.id, fm.member_key, fm.display_name, fm.role, fm.is_active,
            u.id AS user_id, u.username, u.is_active AS user_active,
            COUNT(a.id) AS account_count
        FROM family_members fm
        LEFT JOIN users u ON u.id = fm.user_id
        LEFT JOIN accounts a ON a.member_id = fm.id AND a.is_active = 1
        WHERE fm.family_id = ? AND fm.is_active = 1
        GROUP BY fm.id, fm.member_key, fm.display_name, fm.role, fm.is_active,
                 u.id, u.username, u.is_active
        ORDER BY CASE WHEN fm.role = 'owner' THEN 0 WHEN fm.role = 'admin' THEN 1 ELSE 2 END,
                 fm.id
        """,
        (context.family_id,),
    ).fetchall()
    recent_activity = conn.execute(
        """
        SELECT id, actor_name, action, entity_type, entity_id, summary, reason,
               before_value, after_value, payload_version, created_at
        FROM audit_events
        WHERE family_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 20
        """,
        (context.family_id,),
    ).fetchall()
    return {
        "id": family["id"],
        "name": family["name"],
        "role": context.role,
        "current_member_id": context.member_id,
        "can_manage": context.role in {"owner", "admin"},
        "members": [
            {
                **dict(member),
                "login_enabled": member["user_id"] is not None and bool(member["user_active"]),
                "is_current": member["id"] == context.member_id,
            }
            for member in members
        ],
        "recent_activity": [dict(item) for item in recent_activity],
    }


@consistent_query
def get_family(*, conn=None):
    context = get_auth_context()
    return family_payload(conn, context)


def update_family(payload: FamilyUpdate):
    context = assert_family_admin()
    now = datetime.now().isoformat(timespec="seconds")
    with family_write_connection(context.family_id) as conn:
        conn.execute(
            "UPDATE families SET name = ?, updated_at = ? WHERE id = ?",
            (payload.name.strip(), now, context.family_id),
        )
        record_audit_event(
            conn,
            "修改家庭资料",
            "family",
            context.family_id,
            summary=f"修改家庭名称为“{payload.name.strip()}”",
            context=context,
        )
        return family_payload(conn, context)


def create_family_member(payload: FamilyMemberCreate):
    context = assert_family_admin()
    if payload.role == "admin" and context.role != "owner":
        raise HTTPException(status_code=403, detail="只有家庭创建者可以新增管理员")
    now = datetime.now().isoformat(timespec="seconds")
    username = payload.username.strip().lower()
    display_name = payload.display_name.strip()
    try:
        with family_write_connection(context.family_id) as conn:
            if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
                raise HTTPException(status_code=409, detail="登录账号已被使用")
            pending = conn.execute(
                """
                SELECT id
                FROM family_members
                WHERE family_id = ? AND display_name = ? AND user_id IS NULL AND is_active = 1
                """,
                (context.family_id, display_name),
            ).fetchone()
            user_id = conn.execute(
                """
                INSERT INTO users
                (username, password_hash, display_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?) RETURNING id
                """,
                (username, hash_password(payload.password), display_name, now, now),
            ).fetchone()["id"]
            if pending:
                member_id = pending["id"]
                conn.execute(
                    """
                    UPDATE family_members
                    SET user_id = ?, role = ?,
                        member_key = COALESCE(NULLIF(member_key, ''), ?),
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (user_id, payload.role, uuid4().hex, now, member_id),
                )
            else:
                member_id = conn.execute(
                    """
                    INSERT INTO family_members
                    (member_key, family_id, user_id, display_name, role, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                    """,
                    (
                        uuid4().hex,
                        context.family_id,
                        user_id,
                        display_name,
                        payload.role,
                        now,
                        now,
                    ),
                ).fetchone()["id"]
            record_audit_event(
                conn,
                "创建成员账号",
                "family_member",
                member_id,
                summary=f"为成员“{display_name}”开通登录",
                context=context,
            )
            return {"id": member_id, "message": "家庭成员账号已创建"}
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="成员名称或登录账号已被使用") from exc
        raise


def assert_privileged_member_management_allowed(context, member):
    if context.role != "owner" and member["role"] in {"owner", "admin"}:
        raise HTTPException(
            status_code=403,
            detail="只有家庭创建者可以管理创建者或管理员",
        )


def assert_member_update_allowed(context, member, payload):
    credential_change = any(
        value is not None
        for value in (
            payload.username,
            payload.password,
            payload.login_enabled,
        )
    )
    role_change = payload.role is not None
    assert_privileged_member_management_allowed(context, member)
    if context.role != "owner" and (credential_change or role_change):
        raise HTTPException(
            status_code=403,
            detail="只有家庭创建者可以修改成员登录权限或角色",
        )
    if member["id"] == context.member_id and credential_change:
        raise HTTPException(
            status_code=409,
            detail="请使用“修改我的密码”校验当前密码后更新登录凭据",
        )
    if member["role"] == "owner" and role_change:
        raise HTTPException(status_code=409, detail="家庭创建者角色不能修改")


def update_family_member(member_id: int, payload: FamilyMemberUpdate):
    context = assert_family_admin()
    now = datetime.now().isoformat(timespec="seconds")
    try:
        with family_write_connection(context.family_id) as conn:
            lock_suffix = " FOR UPDATE OF fm" if is_postgres_connection(conn) else ""
            member = conn.execute(
                f"""
                SELECT fm.*, u.username, u.is_active AS user_active
                FROM family_members fm
                LEFT JOIN users u ON u.id = fm.user_id
                WHERE fm.id = ? AND fm.family_id = ? AND fm.is_active = 1
                {lock_suffix}
                """,
                (member_id, context.family_id),
            ).fetchone()
            if not member:
                raise HTTPException(status_code=404, detail="家庭成员不存在")
            assert_member_update_allowed(context, member, payload)

            display_name = (
                payload.display_name.strip()
                if payload.display_name
                else member["display_name"]
            )
            role = payload.role or member["role"]
            user_id = member["user_id"]
            username = (
                payload.username.strip().lower()
                if payload.username
                else member["username"]
            )
            if user_id is None:
                wants_login = payload.login_enabled is True
                if wants_login:
                    if not username or not payload.password:
                        raise HTTPException(
                            status_code=409,
                            detail="开通登录需同时填写账号和初始密码",
                        )
                    if conn.execute(
                        "SELECT id FROM users WHERE username = ?",
                        (username,),
                    ).fetchone():
                        raise HTTPException(status_code=409, detail="登录账号已被使用")
                    user_id = conn.execute(
                        """
                        INSERT INTO users
                        (username, password_hash, display_name, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?) RETURNING id
                        """,
                        (
                            username,
                            hash_password(payload.password),
                            display_name,
                            now,
                            now,
                        ),
                    ).fetchone()["id"]
            else:
                updates = ["display_name = ?", "updated_at = ?"]
                params = [display_name, now]
                invalidate_tokens = False
                if payload.username:
                    updates.append("username = ?")
                    params.append(username)
                if payload.password:
                    updates.append("password_hash = ?")
                    params.append(hash_password(payload.password))
                    invalidate_tokens = True
                if (
                    payload.login_enabled is not None
                    and bool(member["user_active"]) != payload.login_enabled
                ):
                    if not payload.login_enabled and (
                        member["role"] == "owner" or member_id == context.member_id
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail="不能停用家庭创建者或当前登录账号",
                        )
                    updates.append("is_active = ?")
                    params.append(int(payload.login_enabled))
                    invalidate_tokens = True
                if invalidate_tokens:
                    updates.append("token_version = token_version + 1")
                params.append(user_id)
                conn.execute(
                    f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
                    tuple(params),
                )
            conn.execute(
                """
                UPDATE family_members
                SET user_id = ?, display_name = ?, role = ?, updated_at = ?
                WHERE id = ?
                """,
                (user_id, display_name, role, now, member_id),
            )
            conn.execute(
                """
                UPDATE accounts
                SET owner = ?, updated_at = ?
                WHERE family_id = ? AND member_id = ?
                """,
                (display_name, now, context.family_id, member_id),
            )
            changes = []
            if display_name != member["display_name"]:
                changes.append(f"改名为“{display_name}”")
            if username != member["username"]:
                changes.append("修改登录账号")
            if role != member["role"]:
                changes.append(f"角色调整为{role}")
            if payload.password:
                changes.append("重置密码")
            if (
                payload.login_enabled is not None
                and bool(member["user_active"]) != payload.login_enabled
            ):
                changes.append("启用登录" if payload.login_enabled else "停用登录")
            record_audit_event(
                conn,
                "修改家庭成员",
                "family_member",
                member_id,
                summary=f"更新成员“{display_name}”：{'、'.join(changes) or '资料确认'}",
                context=context,
            )
            return {"message": "家庭成员已更新"}
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="成员名称或登录账号已被使用") from exc
        raise


def remove_family_member(member_id: int):
    context = assert_family_admin()
    if member_id == context.member_id:
        raise HTTPException(status_code=409, detail="不能移除当前登录成员")
    with family_write_connection(context.family_id) as conn:
        member = conn.execute(
            """
            SELECT role
            FROM family_members
            WHERE id = ? AND family_id = ? AND is_active = 1
            """,
            (member_id, context.family_id),
        ).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="家庭成员不存在")
        assert_privileged_member_management_allowed(context, member)
        if member["role"] == "owner":
            raise HTTPException(status_code=409, detail="不能移除家庭创建者")
        references = member_removal_references(
            conn,
            context.family_id,
            member_id,
        )
        if references:
            summary = "、".join(references[:3])
            if len(references) > 3:
                summary += "等记录"
            raise HTTPException(
                status_code=409,
                detail=(
                    f"该成员已有{summary}，不能移除；"
                    "请停用登录以保留历史归属"
                ),
            )
        conn.execute(
            "UPDATE family_members SET is_active = 0, updated_at = ? WHERE id = ?",
            (datetime.now().isoformat(timespec="seconds"), member_id),
        )
        record_audit_event(
            conn,
            "移除家庭成员",
            "family_member",
            member_id,
            summary="移除无业务记录的家庭成员",
            context=context,
        )
        return {"message": "家庭成员已移除"}
