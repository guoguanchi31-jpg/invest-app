import json
from datetime import datetime
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import database
from backup import fingerprint, restore, snapshot, validate_backup
from database import PostgresConnection, get_connection, write_connection
from services import get_warehouse_overview, get_warehouse_snapshots, refresh_warehouse_snapshot


router = APIRouter(prefix="/warehouse", tags=["warehouse"])


@router.get("/overview")
def warehouse_overview():
    return get_warehouse_overview()


@router.get("/snapshots")
def warehouse_snapshots(limit: int = 12):
    return {"snapshots": get_warehouse_snapshots(limit)}


@router.post("/refresh")
def refresh_warehouse(snapshot_date: str | None = None):
    return refresh_warehouse_snapshot(snapshot_date)


@router.get("/backup")
def download_data_backup():
    conn = get_connection()
    try:
        conn.execute("BEGIN ISOLATION LEVEL REPEATABLE READ" if isinstance(conn, PostgresConnection) else "BEGIN")
        payload = snapshot(conn)
    finally:
        conn.close()
    exported_at = datetime.now().isoformat(timespec="seconds")
    filename = f"invest-backup-{exported_at[:10]}.json"
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class RestoreRequest(BaseModel):
    backup: dict
    expected_fingerprint: str
    confirm_replace: bool = False


@router.post("/restore/preview")
def preview_restore(payload: dict):
    conn = get_connection()
    try:
        counts = validate_backup(conn, payload)
        current = snapshot(conn)
        return {
            "counts": counts,
            "current_counts": {table: len(rows) for table, rows in current["data"].items()},
            "expected_fingerprint": fingerprint(current),
        }
    finally:
        conn.close()


@router.post("/restore")
def restore_backup(payload: RestoreRequest):
    if not payload.confirm_replace:
        raise HTTPException(status_code=409, detail="请先确认覆盖当前账本")
    with write_connection() as conn:
        return restore(conn, payload.backup, payload.expected_fingerprint)


@router.get("/recovery/{filename}")
def recovery_backup(filename: str):
    if not re.fullmatch(r"before-restore-[a-f0-9]{32}\.json", filename):
        raise HTTPException(status_code=404, detail="备份不存在")
    path = Path(database.DB_DIR) / "backups" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="备份不存在")
    return FileResponse(path, filename=filename, media_type="application/json")
