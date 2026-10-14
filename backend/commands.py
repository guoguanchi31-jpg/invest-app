"""Compatibility exports for the financial application command boundary."""

from application.commands import (
    AuditFact,
    FinancialCommandResult,
    command_result,
    financial_command,
)

__all__ = [
    "AuditFact",
    "FinancialCommandResult",
    "command_result",
    "financial_command",
]
