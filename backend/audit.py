import json
from datetime import datetime

from tenancy import get_auth_context
from domain.audit_payloads import AUDIT_PAYLOAD_VERSION


def record_audit_event(
    conn,
    action,
    entity_type,
    entity_id=None,
    *,
    reason=None,
    summary=None,
    account_ids=None,
    before_value=None,
    after_value=None,
    context=None,
):
    context = context or get_auth_context(conn)
    event = conn.execute(
        """
        INSERT INTO audit_events
        (family_id, member_id, actor_user_id, actor_name, action, entity_type,
         entity_id, summary, reason, before_value, after_value, created_at, payload_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (
            context.family_id,
            context.member_id,
            context.user_id or None,
            context.display_name,
            action,
            entity_type,
            str(entity_id) if entity_id is not None else None,
            summary or action,
            reason,
            _json_value(before_value),
            _json_value(after_value),
            datetime.now().isoformat(timespec="seconds"),
            AUDIT_PAYLOAD_VERSION,
        ),
    ).fetchone()
    for account_id in dict.fromkeys(account_ids or ()):
        if account_id is None:
            continue
        conn.execute(
            """
            INSERT INTO audit_event_accounts
            (family_id, audit_event_id, account_id)
            VALUES (?, ?, ?)
            ON CONFLICT(audit_event_id, account_id) DO NOTHING
            """,
            (context.family_id, event["id"], account_id),
        )
    return event["id"]


def _json_value(value):
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
