from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace

from fastapi import HTTPException


@dataclass(frozen=True)
class AuthContext:
    user_id: int
    username: str
    display_name: str
    family_id: int
    family_name: str
    member_id: int
    role: str
    scope: str = "family"
    authenticated: bool = False

    def with_scope(self, scope: str):
        return replace(self, scope=normalize_scope(scope))


_auth_context = ContextVar("auth_context", default=None)


def normalize_scope(scope: str | None):
    return "personal" if scope == "personal" else "family"


def set_auth_context(context: AuthContext):
    return _auth_context.set(context)


def reset_auth_context(token):
    _auth_context.reset(token)


@contextmanager
def use_auth_context(context: AuthContext):
    token = set_auth_context(context)
    try:
        yield context
    finally:
        reset_auth_context(token)


def get_auth_context(conn=None):
    context = _auth_context.get()
    if context is not None:
        return context
    raise HTTPException(status_code=401, detail="缺少已认证的家庭身份")


def scoped_resource_clause(alias: str, context=None):
    """Scope snapshot-like tables that store a dedicated family aggregate row."""
    context = context or get_auth_context()
    if context.scope == "personal":
        return f"{alias}.family_id = ? AND {alias}.member_id = ?", [
            context.family_id,
            context.member_id,
        ]
    return f"{alias}.family_id = ? AND {alias}.member_id IS NULL", [context.family_id]


def scoped_account_clause(alias: str = "a", context=None):
    context = context or get_auth_context()
    if context.scope == "personal":
        return f"{alias}.family_id = ? AND {alias}.member_id = ?", [
            context.family_id,
            context.member_id,
        ]
    return f"{alias}.family_id = ?", [context.family_id]


def scoped_member_data_clause(alias: str, context=None):
    """Scope member-owned rows; family scope is the union of every member."""
    context = context or get_auth_context()
    if context.scope == "personal":
        return f"{alias}.family_id = ? AND {alias}.member_id = ?", [
            context.family_id,
            context.member_id,
        ]
    return f"{alias}.family_id = ?", [context.family_id]


def can_manage_family(context=None):
    return (context or get_auth_context()).role in {"owner", "admin"}


def assert_family_admin(context=None):
    context = context or get_auth_context()
    if not can_manage_family(context):
        raise HTTPException(status_code=403, detail="只有家庭管理员可以执行此操作")
    return context


def get_account_for_access(
    conn,
    account_id: int,
    *,
    write=False,
    active=False,
    context=None,
):
    context = context or get_auth_context(conn)
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not row or row["family_id"] != context.family_id:
        raise HTTPException(status_code=404, detail="账户不存在")
    if context.scope == "personal" and row["member_id"] != context.member_id:
        raise HTTPException(status_code=404, detail="账户不存在")
    if write and not can_manage_family(context) and row["member_id"] != context.member_id:
        raise HTTPException(status_code=403, detail="只能修改自己的账户")
    if active and not row["is_active"]:
        raise HTTPException(status_code=409, detail="账户已归档，请先恢复账户再更正账目")
    return row


def can_edit_member(member_id: int | None, context=None):
    context = context or get_auth_context()
    return can_manage_family(context) or member_id == context.member_id


def resolve_member_for_write(conn, requested_member_id: int | None = None, context=None):
    context = context or get_auth_context(conn)
    if context.scope == "personal" or not can_manage_family(context):
        if requested_member_id is not None and requested_member_id != context.member_id:
            raise HTTPException(status_code=403, detail="只能修改自己的计划")
        member_id = context.member_id
    else:
        member_id = requested_member_id or context.member_id
    member = conn.execute(
        """
        SELECT id, display_name
        FROM family_members
        WHERE id = ? AND family_id = ? AND is_active = 1
        """,
        (member_id, context.family_id),
    ).fetchone()
    if not member:
        raise HTTPException(status_code=404, detail="家庭成员不存在")
    return member
