import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from application.errors import CommandError
from domain.calendar import business_timezone
from infrastructure.database import assert_schema_current, get_schema_version, init_db
from routers import accounts, auth, budgets, categories, commands, dashboard, family, goals, investments, transactions, warehouse
from migrations.schema import CURRENT_SCHEMA_VERSION
from security import is_production, validate_runtime_security
from snapshot_scheduler import daily_snapshot_worker, save_snapshot_safely


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("invest.api")


@asynccontextmanager
async def lifespan(_app):
    validate_runtime_security()
    business_timezone()  # Fail startup on an invalid configured calendar.
    auto_migrate = os.environ.get(
        "AUTO_MIGRATE_ON_STARTUP",
        "0" if is_production() else "1",
    ) == "1"
    if auto_migrate and await asyncio.to_thread(get_schema_version) != CURRENT_SCHEMA_VERSION:
        await asyncio.to_thread(init_db)
    else:
        await asyncio.to_thread(assert_schema_current)
    scheduler_default = "0" if os.environ.get("VERCEL") else "1"
    scheduler_enabled = os.environ.get(
        "ENABLE_SNAPSHOT_SCHEDULER",
        scheduler_default,
    ) == "1"
    task = None
    if scheduler_enabled:
        await save_snapshot_safely()
        task = asyncio.create_task(daily_snapshot_worker())
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

app = FastAPI(lifespan=lifespan)


@app.exception_handler(CommandError)
async def command_error_response(_request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
    )


allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost,https://localhost",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Data-Scope"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_observability(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(json.dumps({
            "event": "request_failed",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
        }, ensure_ascii=True))
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(json.dumps({
        "event": "request_completed",
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
    }, ensure_ascii=True))
    return response

app.include_router(auth.router)
protected = [Depends(auth.require_auth)]
app.include_router(commands.router, dependencies=protected)
app.include_router(family.router, dependencies=protected)
app.include_router(dashboard.router, dependencies=protected)
app.include_router(accounts.router, dependencies=protected)
app.include_router(categories.router, dependencies=protected)
app.include_router(transactions.router, dependencies=protected)
app.include_router(budgets.router, dependencies=protected)
app.include_router(investments.router, dependencies=protected)
app.include_router(goals.router, dependencies=protected)
app.include_router(warehouse.router, dependencies=protected)
