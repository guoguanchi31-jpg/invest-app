from fastapi import APIRouter

from services import get_dashboard_summary


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def dashboard_summary(month: str | None = None, trend_range: str = "12m"):
    return get_dashboard_summary(month, trend_range)


@router.get("/trend")
def dashboard_trend(month: str | None = None, trend_range: str = "12m"):
    return {"trend": get_dashboard_summary(month, trend_range)["trend"]}
