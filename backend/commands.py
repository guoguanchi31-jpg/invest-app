"""Atomic financial commands with durable, opt-in HTTP retry keys."""
import hashlib
import inspect
import json
from datetime import datetime
from functools import wraps
from typing import Annotated

from fastapi import Header, HTTPException
from fastapi.encoders import jsonable_encoder

from database import share_command_connection, write_connection


def financial_command(endpoint):
    signature = inspect.signature(endpoint)

    @wraps(endpoint)
    def execute(*args, **kwargs):
        key = kwargs.pop("idempotency_key", None)
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        canonical = json.dumps(
            [endpoint.__module__, endpoint.__name__, jsonable_encoder(bound.arguments)],
            sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
        )
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        with write_connection() as conn:
            if key:
                # The unique key waits for a concurrent command to commit (PG) or
                # is serialized by BEGIN IMMEDIATE (SQLite).
                conn.execute("""
                    INSERT INTO financial_commands (command_key, fingerprint, created_at)
                    VALUES (?, ?, ?) ON CONFLICT(command_key) DO NOTHING
                """, (key, fingerprint, datetime.now().isoformat()))
                previous = conn.execute(
                    "SELECT * FROM financial_commands WHERE command_key = ?", (key,),
                ).fetchone()
                if previous["invalidated"]:
                    raise HTTPException(status_code=409, detail="账本已恢复，此操作已失效，请核对后重新录入")
                if previous["fingerprint"] != fingerprint:
                    raise HTTPException(status_code=409, detail="操作标识已用于不同内容，请重新打开表单")
                if previous["response"] is not None:
                    return json.loads(previous["response"])
            with share_command_connection(conn):
                response = endpoint(*args, **kwargs)
            if key:
                conn.execute(
                    "UPDATE financial_commands SET response = ? WHERE command_key = ?",
                    (json.dumps(jsonable_encoder(response), ensure_ascii=False, allow_nan=False), key),
                )
            return response

    execute.__signature__ = signature.replace(parameters=[
        *signature.parameters.values(),
        inspect.Parameter(
            "idempotency_key", inspect.Parameter.KEYWORD_ONLY, default=None,
            annotation=Annotated[str | None, Header(min_length=1, max_length=128)],
        ),
    ])
    return execute
