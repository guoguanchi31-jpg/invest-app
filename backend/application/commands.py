"""Atomic financial commands with durable, opt-in HTTP retry keys."""
import hashlib
import inspect
import json
import os
from dataclasses import dataclass, field
from contextvars import ContextVar
from datetime import datetime, timedelta
from decimal import Decimal
from functools import wraps
from typing import Annotated, Any

from fastapi import Header, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from application.errors import CommandError
from infrastructure.database import (
    consistent_read_connection, family_write_connection, share_command_connection,
)
from tenancy import get_auth_context
from domain.accounting import AccountingConflict
from infrastructure.accounting_store import assert_investment_cash_nonnegative


_active_command_key = ContextVar("active_command_key", default=None)
_NO_REPLAY = object()
COMMAND_FINGERPRINT_VERSION = 2


def current_command_key():
    return _active_command_key.get()


def _replay(previous, fingerprints, request_scope):
    if previous is None:
        return _NO_REPLAY
    previous = dict(previous)
    if previous["invalidated"] or previous["status"] == "invalidated":
        raise CommandError("COMMAND_INVALIDATED", "账本已恢复，此操作已失效，请核对后重新录入")
    version = int(previous.get("fingerprint_version") or 0)
    stored_scope = previous.get("data_scope")
    fingerprint_matches = (
        previous["fingerprint"] in fingerprints.values()
        if version == 0
        else previous["fingerprint"] == fingerprints.get(version)
    )
    if (
        not fingerprint_matches
        or (version >= 2 and stored_scope != request_scope)
    ):
        raise CommandError("COMMAND_CONTENT_CONFLICT", "操作标识已用于不同内容，请重新打开表单")
    legacy_scope_unknown = version < 2 or stored_scope is None
    if (
        previous["status"] == "committed"
        and previous["response"] is not None
        and not legacy_scope_unknown
    ):
        return json.loads(previous["response"])
    if previous["status"] in {"committed", "expired"}:
        raise CommandError(
            "COMMAND_RESULT_EXPIRED",
            "该操作已处理，但结果明细已过期；请刷新账本核对，不能重新执行",
        )
    raise CommandError(
        "COMMAND_PROCESSING",
        "该操作正在处理或结果未知，请使用原操作标识稍后重试",
    )


def _command_jsonable(value):
    if isinstance(value, BaseModel):
        return _command_jsonable(value.model_dump(warnings=False))
    if isinstance(value, Decimal):
        return int(value) if value.as_tuple().exponent >= 0 else float(value)
    if isinstance(value, dict):
        return {key: _command_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_command_jsonable(item) for item in value]
    return jsonable_encoder(value)


def _fingerprint_jsonable(value):
    if isinstance(value, BaseModel):
        return _fingerprint_jsonable(value.model_dump(warnings=False))
    if isinstance(value, Decimal):
        return {"__decimal__": format(value, "f")}
    if isinstance(value, dict):
        return {key: _fingerprint_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_fingerprint_jsonable(item) for item in value]
    return jsonable_encoder(value)


def command_fingerprint(context, endpoint, arguments, version):
    identity = [context.family_id, context.user_id]
    if version >= 2:
        identity.append(context.scope)
    canonical = json.dumps(
        [
            *identity,
            endpoint.__module__,
            endpoint.__name__,
            _fingerprint_jsonable(arguments),
        ],
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def command_fingerprints(context, endpoint, arguments):
    return {
        version: command_fingerprint(context, endpoint, arguments, version)
        for version in (1, COMMAND_FINGERPRINT_VERSION)
    }


@dataclass(frozen=True)
class AuditFact:
    action: str
    entity_type: str
    entity_id: Any = None
    summary: str | None = None
    reason: str | None = None
    account_ids: tuple[int, ...] = ()
    before_value: Any = None
    after_value: Any = None


@dataclass(frozen=True)
class FinancialCommandResult:
    response: Any
    affected_account_ids: tuple[int, ...] = ()
    affected_member_ids: tuple[int, ...] = ()
    audit_facts: tuple[AuditFact, ...] = field(default_factory=tuple)


def command_result(
    response,
    *,
    affected_account_ids=(),
    affected_member_ids=(),
    audit_facts=(),
):
    return FinancialCommandResult(
        response=response,
        affected_account_ids=tuple(dict.fromkeys(affected_account_ids)),
        affected_member_ids=tuple(dict.fromkeys(affected_member_ids)),
        audit_facts=tuple(audit_facts),
    )


def _discard_prepared(prepared):
    discard = getattr(prepared, "discard", None)
    if callable(discard):
        discard()


def _execute_financial_transaction(
    *,
    endpoint,
    args,
    kwargs,
    context,
    key,
    fingerprints,
    prepared,
    prepare,
    update_snapshot,
):
    with family_write_connection(context.family_id) as conn:
        if key:
            # The unique key waits for a concurrent command to commit (PG) or
            # is serialized by BEGIN IMMEDIATE (SQLite).
            created_at = datetime.now().isoformat(timespec="seconds")
            inserted = conn.execute("""
                INSERT INTO financial_commands
                (command_key, fingerprint, fingerprint_version, data_scope,
                 family_id, user_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)
                ON CONFLICT(command_key) DO NOTHING
            """, (
                key,
                fingerprints[COMMAND_FINGERPRINT_VERSION],
                COMMAND_FINGERPRINT_VERSION,
                context.scope,
                context.family_id,
                context.user_id,
                created_at,
                created_at,
            )).rowcount
            previous = conn.execute(
                "SELECT * FROM financial_commands WHERE command_key = ?", (key,),
            ).fetchone()
            if not inserted:
                return _replay(previous, fingerprints, context.scope), False
        from audit import record_audit_event
        with share_command_connection(conn):
            active_key = _active_command_key.set(key)
            try:
                raw_result = endpoint(
                    *args, **kwargs, **({"_prepared": prepared} if prepare else {}),
                )
            finally:
                _active_command_key.reset(active_key)
            if not isinstance(raw_result, FinancialCommandResult):
                raise RuntimeError(
                    f"{endpoint.__name__} 必须返回 FinancialCommandResult"
                )
            response = raw_result.response
            for fact in raw_result.audit_facts:
                record_audit_event(
                    conn,
                    fact.action,
                    fact.entity_type,
                    fact.entity_id,
                    reason=fact.reason,
                    summary=fact.summary,
                    account_ids=fact.account_ids,
                    before_value=fact.before_value,
                    after_value=fact.after_value,
                    context=context,
                )
            assert_investment_cash_nonnegative(
                conn,
                raw_result.affected_account_ids,
            )
            affected_members = raw_result.affected_member_ids or None
            if update_snapshot:
                from application.snapshots import (
                    refresh_family_warehouse_snapshots,
                    refresh_warehouse_snapshot,
                )
                if context.authenticated:
                    refresh_family_warehouse_snapshots(
                        conn,
                        context,
                        member_ids=affected_members,
                    )
                else:
                    refresh_warehouse_snapshot(conn=conn, context=context)
        if key:
            completed_at = datetime.now()
            retention_days = max(
                int(os.environ.get("FINANCIAL_COMMAND_RESPONSE_RETENTION_DAYS", "90")),
                1,
            )
            conn.execute(
                """
                UPDATE financial_commands
                SET response = ?, status = 'committed', completed_at = ?,
                    response_expires_at = ?, updated_at = ?
                WHERE command_key = ?
                """,
                (
                    json.dumps(
                        _command_jsonable(response),
                        ensure_ascii=False,
                        allow_nan=False,
                    ),
                    completed_at.isoformat(timespec="seconds"),
                    (completed_at + timedelta(days=retention_days)).isoformat(
                        timespec="seconds"
                    ),
                    completed_at.isoformat(timespec="seconds"),
                    key,
                ),
            )
    return response, True


def financial_command(endpoint=None, *, update_snapshot=True, prepare=None):
    if endpoint is None:
        return lambda target: financial_command(
            target,
            update_snapshot=update_snapshot,
            prepare=prepare,
        )

    # Preparation may perform filesystem I/O, never while holding family locks.
    # Its result is internal and excluded from both HTTP schema and fingerprint.
    signature = inspect.signature(endpoint).replace(parameters=[
        item for name, item in inspect.signature(endpoint).parameters.items()
        if name != "_prepared"
    ])

    def run_command(*args, **kwargs):
        key = kwargs.pop("idempotency_key", None)
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        context = get_auth_context()
        fingerprints = command_fingerprints(context, endpoint, bound.arguments)
        if prepare and key:
            # Return committed results even if the book has since changed.
            with consistent_read_connection() as read:
                replay = _replay(read.execute(
                    "SELECT * FROM financial_commands WHERE command_key = ?", (key,),
                ).fetchone(), fingerprints, context.scope)
                if replay is not _NO_REPLAY:
                    return replay
        try:
            prepared = prepare(*args, **kwargs) if prepare else None
        except Exception:
            # A concurrent identical restore can commit between the initial
            # replay lookup and preparation's snapshot/fingerprint check.
            if prepare and key:
                with consistent_read_connection() as read:
                    replay = _replay(read.execute(
                        "SELECT * FROM financial_commands WHERE command_key = ?", (key,),
                    ).fetchone(), fingerprints, context.scope)
                    if replay is not _NO_REPLAY:
                        return replay
            raise
        try:
            response, consumed = _execute_financial_transaction(
                endpoint=endpoint,
                args=args,
                kwargs=kwargs,
                context=context,
                key=key,
                fingerprints=fingerprints,
                prepared=prepared,
                prepare=prepare,
                update_snapshot=update_snapshot,
            )
        except Exception:
            _discard_prepared(prepared)
            raise
        if not consumed:
            _discard_prepared(prepared)
        return response

    @wraps(endpoint)
    def execute(*args, **kwargs):
        try:
            return run_command(*args, **kwargs)
        except AccountingConflict as exc:
            raise CommandError("BUSINESS_CONFLICT", str(exc)) from exc
        except HTTPException as exc:
            if exc.status_code == 409 and not isinstance(exc, CommandError):
                raise CommandError("BUSINESS_CONFLICT", exc.detail) from exc
            raise

    execute.__signature__ = signature.replace(parameters=[
        *signature.parameters.values(),
        inspect.Parameter(
            "idempotency_key", inspect.Parameter.KEYWORD_ONLY, default=None,
            annotation=Annotated[str | None, Header(min_length=1, max_length=128)],
        ),
    ])
    return execute
