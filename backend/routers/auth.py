import base64
import binascii
import hashlib
import hmac
import json
import os
import time

from fastapi import APIRouter, Header, HTTPException

from schemas import LoginData


router = APIRouter()
PASSWORD = os.environ.get("APP_PASSWORD", "123456")
TOKEN_TTL_SECONDS = int(os.environ.get("AUTH_TOKEN_TTL_SECONDS", "604800"))
AUTH_SECRET = os.environ.get("APP_AUTH_SECRET") or hashlib.sha256(
    f"invest-local:{PASSWORD}".encode()
).hexdigest()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_access_token() -> str:
    issued_at = int(time.time())
    payload = json.dumps(
        {"iat": issued_at, "exp": issued_at + TOKEN_TTL_SECONDS},
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


def verify_access_token(token: str) -> bool:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(
            AUTH_SECRET.encode(),
            encoded_payload.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_decode(encoded_signature), expected_signature):
            return False
        payload = json.loads(_decode(encoded_payload))
        return int(payload["exp"]) > int(time.time())
    except (binascii.Error, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


def require_auth(authorization: str | None = Header(default=None)):
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token or not verify_access_token(token):
        raise HTTPException(
            status_code=401,
            detail="登录状态无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/login")
def login(data: LoginData):
    if not hmac.compare_digest(data.password, PASSWORD):
        return {"ok": False}
    return {
        "ok": True,
        "access_token": create_access_token(),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
    }


@router.get("/")
def read_root():
    return {"message": "我的投资系统后端已启动!"}


@router.get("/healthz")
def healthcheck():
    return {"status": "ok"}
