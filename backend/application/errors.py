"""Stable command outcomes; the human-readable detail remains API compatible."""
from fastapi import HTTPException


class CommandError(HTTPException):
    def __init__(self, code, detail, *, status_code=409):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
