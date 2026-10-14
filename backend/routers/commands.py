from typing import Annotated

from fastapi import APIRouter, Path

from queries.commands import get_command_status


router = APIRouter(prefix="/commands", tags=["commands"])


@router.get("/{command_key}")
def command_status(command_key: Annotated[str, Path(min_length=1, max_length=128)]):
    return get_command_status(command_key)
