"""Minimal command receipts, scoped to the authenticated author and family."""
from infrastructure.read_models import consistent_query
from tenancy import get_auth_context


@consistent_query
def get_command_status(command_key, *, conn=None):
    context = get_auth_context(conn)
    row = conn.execute(
        """SELECT status, invalidated, fingerprint_version, data_scope
           FROM financial_commands
           WHERE command_key = ? AND family_id = ? AND user_id = ?""",
        (command_key, context.family_id, context.user_id),
    ).fetchone()
    # Absence is not evidence of rejection: an in-flight transaction is invisible.
    if row is None:
        return {
            "status": "unknown",
            "protocol_version": None,
            "scope_known": False,
        }
    row = dict(row)
    protocol_version = int(row.get("fingerprint_version") or 0)
    stored_scope = row.get("data_scope")
    if protocol_version >= 2 and stored_scope != context.scope:
        return {
            "status": "unknown",
            "protocol_version": None,
            "scope_known": False,
        }
    return {
        "status": "invalidated" if row["invalidated"] else row["status"],
        "protocol_version": protocol_version,
        "scope_known": stored_scope is not None,
    }
