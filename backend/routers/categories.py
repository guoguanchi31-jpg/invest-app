from fastapi import APIRouter

from application.categories import (
    create_category as create_category_use_case,
    list_categories as list_categories_query,
)
from schemas import CategoryCreate


router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories(type: str | None = None):
    return list_categories_query(type)


@router.post("")
def create_category(category: CategoryCreate):
    return create_category_use_case(category)
