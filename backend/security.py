import base64
import hashlib
import hmac
import os
import secrets


PASSWORD_ITERATIONS = int(os.environ.get("PASSWORD_HASH_ITERATIONS", "120000"))
INSECURE_DEFAULT_PASSWORD = "123456"


def is_production():
    return os.environ.get("APP_ENV", "development").strip().lower() in {
        "production",
        "prod",
        "staging",
    }


def bootstrap_password():
    password = os.environ.get("APP_PASSWORD", "").strip()
    if password:
        return password
    if is_production():
        raise RuntimeError("生产环境必须设置 APP_PASSWORD")
    return INSECURE_DEFAULT_PASSWORD


def token_secret():
    secret = os.environ.get("APP_AUTH_SECRET", "").strip()
    if secret:
        return secret
    if is_production():
        raise RuntimeError("生产环境必须设置 APP_AUTH_SECRET")
    return hashlib.sha256(f"invest-local:{bootstrap_password()}".encode()).hexdigest()


def validate_runtime_security():
    password = bootstrap_password()
    secret = token_secret()
    if is_production() and (
        password == INSECURE_DEFAULT_PASSWORD
        or len(password) < 12
        or len(secret) < 32
    ):
        raise RuntimeError("生产环境 APP_PASSWORD 至少 12 位，APP_AUTH_SECRET 至少 32 位")


def hash_password(password: str):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "$".join([
        "pbkdf2_sha256",
        str(PASSWORD_ITERATIONS),
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    ])


def verify_password(password: str, encoded: str):
    try:
        algorithm, iterations, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            base64.urlsafe_b64decode(salt),
            int(iterations),
        )
        return hmac.compare_digest(
            base64.urlsafe_b64encode(digest).decode(),
            expected,
        )
    except (TypeError, ValueError):
        return False
