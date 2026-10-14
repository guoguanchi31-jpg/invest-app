import asyncio
import json
import logging
import os
from datetime import datetime, time, timedelta
from uuid import uuid4

from application.snapshots import refresh_all_warehouse_snapshots
from domain.calendar import business_now, business_timezone, business_today
from infrastructure.database import get_connection, is_postgres_connection


logger = logging.getLogger(__name__)
SNAPSHOT_TIME = time(hour=0, minute=5)
SNAPSHOT_JOB_KEY = "daily_warehouse_snapshot"
SNAPSHOT_JOB_LOCK_ID = 821_476_220


def seconds_until_next_snapshot(now=None):
    # Naive arguments are business-local values for existing CLI/test callers.
    if now is not None and now.tzinfo is None:
        now = now.replace(tzinfo=business_timezone())
    now = business_now(now)
    next_run = datetime.combine(now.date(), SNAPSHOT_TIME, tzinfo=now.tzinfo)
    if next_run <= now:
        next_run += timedelta(days=1)
    return max(next_run.timestamp() - now.timestamp(), 1)


async def save_snapshot_safely():
    try:
        result = await asyncio.to_thread(run_snapshot_job)
        if result["status"] == "failed":
            logger.error("自动资产快照保存失败: %s", result["error"])
        return result
    except Exception:
        logger.exception("自动资产快照保存失败")
        return None


async def daily_snapshot_worker():
    while True:
        await asyncio.sleep(seconds_until_next_snapshot())
        await save_snapshot_safely()


def _update_job_status(
    conn,
    status,
    now,
    *,
    run_id,
    requested_for,
    error=None,
):
    succeeded_at = now if status == "succeeded" else None
    failed_at = now if status == "failed" else None
    conn.execute(
        """
        INSERT INTO background_job_status
        (job_key, status, last_started_at, last_succeeded_at, last_failed_at,
         last_error, updated_at, current_run_id, last_requested_for)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET
            status = excluded.status,
            last_started_at = CASE
                WHEN excluded.status = 'running'
                THEN excluded.last_started_at
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
            updated_at = excluded.updated_at,
            current_run_id = excluded.current_run_id,
            last_requested_for = excluded.last_requested_for
        """,
        (
            SNAPSHOT_JOB_KEY,
            status,
            now,
            succeeded_at,
            failed_at,
            error,
            now,
            run_id,
            requested_for,
        ),
    )


def _claim_job(conn, requested_for, run_id, started_at):
    existing = conn.execute(
        "SELECT * FROM background_job_status WHERE job_key = ?",
        (SNAPSHOT_JOB_KEY,),
    ).fetchone()
    stale_after = max(
        int(os.environ.get("SNAPSHOT_JOB_STALE_SECONDS", "3600")),
        60,
    )
    if existing and existing["status"] == "running" and existing["updated_at"]:
        updated_at = datetime.fromisoformat(existing["updated_at"])
        if (datetime.now() - updated_at).total_seconds() < stale_after:
            return {"status": "skipped", "reason": "already_running"}
    if (
        existing
        and existing["status"] == "succeeded"
        and existing["last_requested_for"] == requested_for
    ):
        return {"status": "skipped", "reason": "already_succeeded"}
    _update_job_status(
        conn,
        "running",
        started_at,
        run_id=run_id,
        requested_for=requested_for,
    )
    conn.execute(
        """
        INSERT INTO background_job_runs
        (job_key, run_id, requested_for, status, started_at)
        VALUES (?, ?, ?, 'running', ?)
        """,
        (SNAPSHOT_JOB_KEY, run_id, requested_for, started_at),
    )
    return None


def _finish_job(conn, status, now, run_id, requested_for, *, error=None, summary=None):
    _update_job_status(
        conn,
        status,
        now,
        run_id=run_id,
        requested_for=requested_for,
        error=error,
    )
    conn.execute(
        """
        UPDATE background_job_runs
        SET status = ?, finished_at = ?, error = ?, result_summary = ?
        WHERE run_id = ?
        """,
        (status, now, error, summary, run_id),
    )


def run_snapshot_job(snapshot_date=None):
    requested_for = snapshot_date or business_today().isoformat()
    run_id = uuid4().hex
    conn = get_connection()
    postgres = is_postgres_connection(conn)
    lock_acquired = False
    try:
        if postgres:
            acquired = conn.execute(
                "SELECT pg_try_advisory_lock(?) AS acquired",
                (SNAPSHOT_JOB_LOCK_ID,),
            ).fetchone()["acquired"]
            if not acquired:
                conn.rollback()
                return {"status": "skipped", "reason": "already_running"}
            lock_acquired = True
        else:
            conn.execute("BEGIN IMMEDIATE")

        started_at = datetime.now().isoformat(timespec="seconds")
        skipped = _claim_job(conn, requested_for, run_id, started_at)
        if skipped:
            conn.rollback()
            return skipped
        conn.commit()

        # Each family commits independently; the job lease spans the batch.
        snapshots = refresh_all_warehouse_snapshots(requested_for)

        finished_at = datetime.now().isoformat(timespec="seconds")
        if not postgres:
            conn.execute("BEGIN IMMEDIATE")
        _finish_job(
            conn,
            "succeeded",
            finished_at,
            run_id,
            requested_for,
            summary=json.dumps(
                {"snapshot_count": len(snapshots)},
                separators=(",", ":"),
            ),
        )
        conn.commit()
        return {
            "status": "succeeded",
            "snapshot_count": len(snapshots),
            "finished_at": finished_at,
        }
    except Exception as exc:
        conn.rollback()
        failed_at = datetime.now().isoformat(timespec="seconds")
        logger.exception("资产快照任务执行失败")
        try:
            if not postgres:
                conn.execute("BEGIN IMMEDIATE")
            _finish_job(
                conn,
                "failed",
                failed_at,
                run_id,
                requested_for,
                error="snapshot_failed",
            )
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("资产快照任务失败状态写入失败")
        return {
            "status": "failed",
            "error": "snapshot_failed",
            "failed_at": failed_at,
        }
    finally:
        if postgres and lock_acquired:
            try:
                conn.execute(
                    "SELECT pg_advisory_unlock(?)",
                    (SNAPSHOT_JOB_LOCK_ID,),
                )
            except Exception:
                logger.exception("资产快照任务协调锁释放失败")
        conn.close()


def get_snapshot_job_status():
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM background_job_status WHERE job_key = ?",
            (SNAPSHOT_JOB_KEY,),
        ).fetchone()
        if not row:
            return {"job_key": SNAPSHOT_JOB_KEY, "status": "never"}
        return {
            "job_key": row["job_key"],
            "status": row["status"],
            "last_started_at": row["last_started_at"],
            "last_succeeded_at": row["last_succeeded_at"],
            "last_failed_at": row["last_failed_at"],
            "updated_at": row["updated_at"],
            "last_requested_for": row["last_requested_for"],
            "has_error": bool(row["last_error"]),
        }
    finally:
        conn.close()
