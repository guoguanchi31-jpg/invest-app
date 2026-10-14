"""Authentication use cases and token-backed identity lookup."""

import base64
import binascii
import hashlib
import hmac
import json
import os
import time

from fastapi import HTTPException

from audit import record_audit_event
from infrastructure.database import get_connection, family_write_connection
from schemas import PasswordChange
from security import hash_password, token_secret, verify_password
from tenancy import AuthContext, normalize_scope


TOKEN_TTL_SECONDS = int(os.environ.get("AUTH_TOKEN_TTL_SECONDS", "604800"))
AUTH_SECRET = token_secret()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def identity_for_username(username):
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT u.id AS user_id, u.token_version, fm.family_id
            FROM users u
            JOIN family_members fm ON fm.user_id = u.id
            WHERE u.username = ? AND u.is_active = 1 AND fm.is_active = 1
            ORDER BY fm.id
            LIMIT 1
            """,
            (username.strip().lower(),),
        ).fetchone()
        if not row:
            raise RuntimeError(f"登录账号不存在或已停用：{username}")
        return row["user_id"], row["family_id"], row["token_version"]
    finally:
        conn.close()


def create_access_token(user_id, family_id, token_version) -> str:
    issued_at = int(time.time())
    payload = json.dumps(
        {
            "sub": user_id,
            "family_id": family_id,
            "ver": token_version,
            "iat": issued_at,
            "exp": issued_at + TOKEN_TTL_SECONDS,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    encoded_payload = _encode(payload)
    signature = hmac.new(
        AUTH_SECRET.encode(),
        encoded_payload.encode(),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_encode(signature)}"


def create_access_token_for_username(username) -> str:
    return create_access_token(*identity_for_username(username))


def decode_access_token(token: str):
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(
            AUTH_SECRET.encode(),
            encoded_payload.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_decode(encoded_signature), expected_signature):
            return None
        payload = json.loads(_decode(encoded_payload))
        return payload if int(payload["exp"]) > int(time.time()) else None
    except (binascii.Error, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def verify_access_token(token: str) -> bool:
    return decode_access_token(token) is not None


def context_from_token(token: str, scope: str | None = None):
    payload = decode_access_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    family_id = payload.get("family_id")
    if user_id is None or family_id is None:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT
                u.id AS user_id, u.username, u.display_name, u.token_version,
                f.id AS family_id, f.name AS family_name,
                fm.id AS member_id, fm.role
            FROM users u
            JOIN family_members fm ON fm.user_id = u.id
            JOIN families f ON f.id = fm.family_id
            WHERE u.id = ? AND f.id = ?
              AND u.is_active = 1 AND fm.is_active = 1
            ORDER BY fm.id
            LIMIT 1
            """,
            (int(user_id), int(family_id)),
        ).fetchone()
        if not row:
            return None
        if payload.get("ver") is None and row["token_version"] != 1:
            return None
        if payload.get("ver") is not None and int(payload["ver"]) != row["token_version"]:
            return None
        return AuthContext(
            user_id=row["user_id"],
            username=row["username"],
            display_name=row["display_name"],
            family_id=row["family_id"],
            family_name=row["family_name"],
            member_id=row["member_id"],
            role=row["role"],
            scope=normalize_scope(scope),
            authenticated=True,
        )
    finally:
        conn.close()


def authenticate_credentials(username: str, password: str):
    conn = get_connection()
    try:
        user = conn.execute(
            """
            SELECT id, username, password_hash, display_name, token_version
            FROM users
            WHERE username = ? AND is_active = 1
            """,
            (username,),
        ).fetchone()
        if not user or not verify_password(password, user["password_hash"]):
            return None
        membership = conn.execute(
            """
            SELECT fm.family_id
            FROM family_members fm
            WHERE fm.user_id = ? AND fm.is_active = 1
            ORDER BY fm.id
            LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
        if not membership:
            return None
        return {
            "user_id": user["id"],
            "family_id": membership["family_id"],
            "token_version": user["token_version"],
        }
    finally:
        conn.close()


def change_password(context: AuthContext, payload: PasswordChange):
    with family_write_connection(context.family_id) as conn:
        user = conn.execute(
            "SELECT password_hash, token_version FROM users WHERE id = ?",
            (context.user_id,),
        ).fetchone()
        if not user or not verify_password(
            payload.current_password,
            user["password_hash"],
        ):
            raise HTTPException(status_code=409, detail="当前密码不正确")
        next_version = user["token_version"] + 1
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, token_version = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                hash_password(payload.new_password),
                next_version,
                time.strftime("%Y-%m-%dT%H:%M:%S"),
                context.user_id,
            ),
        )
        record_audit_event(
            conn,
            "修改登录密码",
            "user",
            context.user_id,
            summary="修改自己的登录密码",
            context=context,
        )
    return {
        "message": "密码已更新",
        "access_token": create_access_token(
            context.user_id,
            context.family_id,
            next_version,
        ),
    }
