import os

from fastapi import FastAPI
from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import accounts, auth, budgets, categories, dashboard, goals, investments, transactions, warehouse

app = FastAPI()

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
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)

init_db()

app.include_router(auth.router)
protected = [Depends(auth.require_auth)]
app.include_router(dashboard.router, dependencies=protected)
app.include_router(accounts.router, dependencies=protected)
app.include_router(categories.router, dependencies=protected)
app.include_router(transactions.router, dependencies=protected)
app.include_router(budgets.router, dependencies=protected)
app.include_router(investments.router, dependencies=protected)
app.include_router(goals.router, dependencies=protected)
app.include_router(warehouse.router, dependencies=protected)
