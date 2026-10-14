import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from domain.calendar import business_today
from domain.dates import canonical_business_date, parsed_business_date
from application.snapshots import (
    refresh_family_warehouse_snapshots,
    refresh_warehouse_snapshot,
)
from application.warehouse import get_warehouse_overview
from audit import record_audit_event
from application.backup import (
    export_family_backup,
    preview_family_restore,
    resolve_family_recovery_backup,
    restore_family_backup,
    prepare_family_restore,
)
from application.commands import command_result, financial_command
from queries.finance import (
    get_warehouse_snapshots,
)
from tenancy import get_auth_context
from schemas import BusinessDate


router = APIRouter(prefix="/warehouse", tags=["warehouse"])


@router.get("/overview")
def warehouse_overview():
    return get_warehouse_overview()


@router.get("/snapshots")
def warehouse_snapshots(limit: int = 12):
    return {"snapshots": get_warehouse_snapshots(limit)}


@router.post("/refresh")
def refresh_warehouse(snapshot_date: BusinessDate | None = None):
    requested_date = snapshot_date or business_today().isoformat()
    try:
        requested_date = canonical_business_date(requested_date)
        parsed_date = parsed_business_date(requested_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="快照日期格式无效") from exc
    if parsed_date != business_today():
        raise HTTPException(
            status_code=409,
            detail="公开刷新仅支持当天快照，历史快照不能使用当前资产覆盖",
        )
    return refresh_warehouse_snapshot(
        parsed_date.isoformat(),
        context=get_auth_context(),
    )


@router.get("/backup")
def download_data_backup():
    payload = export_family_backup()
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
    return preview_family_restore(payload)


def prepare_restore(payload: RestoreRequest):
    if not payload.confirm_replace:
        raise HTTPException(status_code=409, detail="请先确认覆盖当前账本")
    return prepare_family_restore(payload.backup, payload.expected_fingerprint)


@router.post("/restore")
@financial_command(update_snapshot=False, prepare=prepare_restore)
def restore_backup(payload: RestoreRequest, *, _prepared=None):
    return command_result(restore_family_backup(
        payload.backup, payload.expected_fingerprint, prepared=_prepared,
    ))


@router.get("/recovery/{filename}")
def recovery_backup(filename: str):
    path = resolve_family_recovery_backup(filename)
    return FileResponse(path, filename=filename, media_type="application/json")
