"""Application health queries with sanitized public output."""

from fastapi import HTTPException

from infrastructure.database import get_connection
from migrations.schema import CURRENT_SCHEMA_VERSION, schema_version
from snapshot_scheduler import get_snapshot_job_status


def get_health_summary():
    conn = get_connection()
    try:
        conn.execute("SELECT 1").fetchone()
        version = schema_version(conn)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="数据库不可用") from exc
    finally:
        conn.close()
    if version != CURRENT_SCHEMA_VERSION:
        raise HTTPException(status_code=503, detail="数据库结构尚未升级")
    return {
        "status": "ok",
        "schema_version": version,
        "snapshot_job": get_snapshot_job_status(),
    }
