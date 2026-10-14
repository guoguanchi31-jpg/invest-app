from fastapi import APIRouter

from application.family import (
    create_family_member as create_family_member_use_case,
    get_family as get_family_query,
    remove_family_member as remove_family_member_use_case,
    update_family as update_family_use_case,
    update_family_member as update_family_member_use_case,
)
from schemas import FamilyMemberCreate, FamilyMemberUpdate, FamilyUpdate


router = APIRouter(prefix="/family", tags=["family"])


@router.get("")
def get_family():
    return get_family_query()


@router.patch("")
def update_family(payload: FamilyUpdate):
    return update_family_use_case(payload)


@router.post("/members")
def create_family_member(payload: FamilyMemberCreate):
    return create_family_member_use_case(payload)


@router.patch("/members/{member_id}")
def update_family_member(member_id: int, payload: FamilyMemberUpdate):
    return update_family_member_use_case(member_id, payload)


@router.delete("/members/{member_id}")
def remove_family_member(member_id: int):
    return remove_family_member_use_case(member_id)
