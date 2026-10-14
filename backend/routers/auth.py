import asyncio
import os
import threading
import time

from fastapi import APIRouter, Depends, Header, HTTPException

from application.authentication import (
    AUTH_SECRET,
    TOKEN_TTL_SECONDS,
    authenticate_credentials,
    change_password as change_password_use_case,
    context_from_token,
    create_access_token,
    create_access_token_for_username,
    decode_access_token,
    verify_access_token,
)
from application.health import get_health_summary
from domain.calendar import business_timezone
from schemas import LoginData, PasswordChange
from tenancy import AuthContext, set_auth_context


router = APIRouter()
DEFAULT_USERNAME = os.environ.get("APP_USERNAME", "admin").strip().lower() or "admin"
LOGIN_MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(os.environ.get("LOGIN_WINDOW_SECONDS", "300"))
LOGIN_TRACKED_IDENTITIES = int(os.environ.get("LOGIN_TRACKED_IDENTITIES", "10000"))
_login_attempts = {}
_login_attempts_lock = threading.Lock()


def _login_attempts_for(username):
    now = time.monotonic()
    with _login_attempts_lock:
        recent = [
            attempt
            for attempt in _login_attempts.get(username, ())
            if now - attempt < LOGIN_WINDOW_SECONDS
        ]
        if recent:
            _login_attempts[username] = recent
        else:
            _login_attempts.pop(username, None)
        return recent


def _reject_if_login_limited(username):
    if len(_login_attempts_for(username)) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="登录尝试过多，请稍后再试",
            headers={"Retry-After": str(LOGIN_WINDOW_SECONDS)},
        )


def _record_login_failure(username):
    with _login_attempts_lock:
        if username not in _login_attempts and len(_login_attempts) >= LOGIN_TRACKED_IDENTITIES:
            _login_attempts.pop(next(iter(_login_attempts)))
        _login_attempts.setdefault(username, []).append(time.monotonic())


def _clear_login_failures(username):
    with _login_attempts_lock:
        _login_attempts.pop(username, None)


async def require_auth(
    authorization: str | None = Header(default=None),
    data_scope: str | None = Header(default=None, alias="X-Data-Scope"),
):
    scheme, _, token = (authorization or "").partition(" ")
    requested_scope = "family" if data_scope == "family" else "personal"
    context = (
        await asyncio.to_thread(context_from_token, token, requested_scope)
        if scheme.lower() == "bearer" and token
        else None
    )
    if not context:
        raise HTTPException(
            status_code=401,
            detail="登录状态无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    set_auth_context(context)
    return context


@router.post("/login")
def login(data: LoginData):
    username = (data.username or DEFAULT_USERNAME).strip().lower()
    _reject_if_login_limited(username)
    identity = authenticate_credentials(username, data.password)
    if not identity:
        _record_login_failure(username)
        return {"ok": False}
    _clear_login_failures(username)
    return {
        "ok": True,
        "access_token": create_access_token(
            identity["user_id"],
            identity["family_id"],
            identity["token_version"],
        ),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
    }


@router.get("/auth/session")
def session(context: AuthContext = Depends(require_auth)):
    return {
        "user": {
            "id": context.user_id,
            "username": context.username,
            "display_name": context.display_name,
        },
        "family": {
            "id": context.family_id,
            "name": context.family_name,
            "role": context.role,
            "member_id": context.member_id,
        },
        "scope": context.scope,
        "business_timezone": business_timezone().key,
    }


@router.post("/auth/password")
def change_password(payload: PasswordChange, context: AuthContext = Depends(require_auth)):
    return change_password_use_case(context, payload)


@router.get("/")
def read_root():
    return {"message": "我的投资系统后端已启动!"}


@router.get("/healthz")
def healthcheck():
    return get_health_summary()


@router.get("/livez")
def liveness():
    return {"status": "ok"}
