"""Expire stored command responses while retaining replay tombstones."""

import argparse
import os
from datetime import datetime

from infrastructure.database import (
    consistent_read_connection, family_write_connection, write_connection,
)


JOB_KEY = "financial_command_response_retention"


def _record_status(conn, status, now, error=None):
    conn.execute(
        """
        INSERT INTO background_job_status
        (job_key, status, last_started_at, last_succeeded_at, last_failed_at,
         last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET
            status = excluded.status,
            last_started_at = CASE
                WHEN excluded.status = 'running' THEN excluded.last_started_at
                ELSE background_job_status.last_started_at
            END,
            last_succeeded_at = COALESCE(
                excluded.last_succeeded_at,
                background_job_status.last_succeeded_at
            ),
            last_failed_at = COALESCE(
                excluded.last_failed_at,
                background_job_status.last_failed_at
            ),
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        """,
        (
            JOB_KEY,
            status,
            now,
            now if status == "succeeded" else None,
            now if status == "failed" else None,
            error,
            now,
        ),
    )


def expire_command_responses(*, before=None, batch_size=None):
    cutoff = before or datetime.now().isoformat(timespec="seconds")
    size = batch_size or int(
        os.environ.get("FINANCIAL_COMMAND_RETENTION_BATCH_SIZE", "250")
    )
    size = min(max(int(size), 1), 5000)
    started_at = datetime.now().isoformat(timespec="seconds")
    try:
        with write_connection() as conn:
            _record_status(conn, "running", started_at)
        with consistent_read_connection() as conn:
            rows = conn.execute(
                """
                SELECT command_key, family_id
                FROM financial_commands
                WHERE status = 'committed'
                  AND response IS NOT NULL
                  AND response_expires_at IS NOT NULL
                  AND response_expires_at <= ?
                ORDER BY response_expires_at, command_key
                LIMIT ?
                """,
                (cutoff, size),
            ).fetchall()
        expired = 0
        families = sorted({row["family_id"] for row in rows})
        for family_id in families:
            keys = [row["command_key"] for row in rows if row["family_id"] == family_id]
            # Same order as restores: family coordination before command rows.
            with family_write_connection(family_id) as conn:
                placeholders = ",".join("?" for _ in keys)
                expired += conn.execute(
                    f"""
                    UPDATE financial_commands
                    SET response = NULL, status = 'expired', updated_at = ?
                    WHERE command_key IN ({placeholders})
                      AND family_id = ? AND status = 'committed'
                      AND response IS NOT NULL AND response_expires_at <= ?
                    """,
                    (datetime.now().isoformat(timespec="seconds"), *keys, family_id, cutoff),
                ).rowcount
        finished_at = datetime.now().isoformat(timespec="seconds")
        with write_connection() as conn:
            _record_status(conn, "succeeded", finished_at)
        return {"status": "succeeded", "expired": expired, "has_more": len(rows) == size}
    except Exception as exc:
        failed_at = datetime.now().isoformat(timespec="seconds")
        try:
            with write_connection() as conn:
                _record_status(conn, "failed", failed_at, "retention_failed")
        except Exception:
            pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--before")
    args = parser.parse_args()
    result = expire_command_responses(
        before=args.before,
        batch_size=args.batch_size,
    )
    print(
        f"status={result['status']} expired={result['expired']} "
        f"has_more={str(result['has_more']).lower()}"
    )


if __name__ == "__main__":
    main()
