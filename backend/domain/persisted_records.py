"""Business constraints shared by restore preview and persisted database state."""

from dataclasses import dataclass

from domain.accounts import AccountStateViolation, validate_account_state
from domain.money import decimal_value


@dataclass(frozen=True)
class PersistedRecordViolation(ValueError):
    table: str
    row_id: int | None
    rule: str

    def __str__(self):
        suffix = f"（{self.table} id={self.row_id}）" if self.row_id else f"（{self.table}）"
        return f"{self.rule}{suffix}"


def _reject(table, row, message):
    raise PersistedRecordViolation(table, row.get("id"), message)


def _number_rule(table, row, field, predicate, message):
    value = row.get(field)
    if value is not None and not predicate(decimal_value(value)):
        _reject(table, row, message)


def validate_persisted_financial_rows(data):
    """Mirror database CHECK constraints before destructive restore work begins."""
    for row in data["accounts"]:
        _number_rule("accounts", row, "exchange_rate_to_base", lambda value: value > 0, "账户汇率必须大于 0")
        _number_rule("accounts", row, "credit_limit", lambda value: value >= 0, "账户信用额度不能为负数")
        try:
            validate_account_state(row)
        except AccountStateViolation as exc:
            _reject("accounts", row, str(exc))

    for row in data["transactions"]:
        _number_rule("transactions", row, "amount", lambda value: value > 0, "流水金额必须大于 0")
        _number_rule("transactions", row, "exchange_rate_to_base", lambda value: value > 0, "流水汇率必须大于 0")
        if row.get("direction") not in {"income", "expense"}:
            _reject("transactions", row, "流水方向无效")

    for row in data["holdings"]:
        _number_rule("holdings", row, "quantity", lambda value: value >= 0, "持仓数量不能为负数")
        _number_rule("holdings", row, "buy_price", lambda value: value >= 0, "持仓成本不能为负数")
        _number_rule("holdings", row, "current_price", lambda value: value >= 0, "持仓现价不能为负数")
        _number_rule("holdings", row, "exchange_rate_to_base", lambda value: value > 0, "持仓汇率必须大于 0")

    for row in data["investment_trades"]:
        _number_rule("investment_trades", row, "quantity", lambda value: value > 0, "投资交易数量必须大于 0")
        _number_rule("investment_trades", row, "price", lambda value: value > 0, "投资交易价格必须大于 0")
        _number_rule("investment_trades", row, "fee", lambda value: value >= 0, "投资交易费用不能为负数")
        _number_rule("investment_trades", row, "cash_amount", lambda value: value > 0, "投资交易结算金额必须大于 0")
        _number_rule("investment_trades", row, "exchange_rate_to_base", lambda value: value > 0, "投资交易汇率必须大于 0")
        if row.get("trade_type") not in {"buy", "sell"}:
            _reject("investment_trades", row, "投资交易类型无效")

    for row in data["prices"]:
        _number_rule("prices", row, "price", lambda value: value > 0, "行情价格必须大于 0")
    for row in data["budget_plans"]:
        _number_rule("budget_plans", row, "total_amount", lambda value: value > 0, "月度总预算必须大于 0")
    for row in data["budgets"]:
        _number_rule("budgets", row, "amount", lambda value: value > 0, "分类预算必须大于 0")
        _number_rule("budgets", row, "alert_threshold", lambda value: 0 < value <= 1, "预算提醒阈值必须在 0 到 1 之间")
    for table in ("budget_category_allocations", "budget_member_allocations"):
        for row in data[table]:
            _number_rule(table, row, "amount", lambda value: value >= 0, "预算分配不能为负数")

    for row in data["goals"]:
        _number_rule("goals", row, "target_amount", lambda value: value > 0, "目标金额必须大于 0")
        _number_rule("goals", row, "current_amount", lambda value: value >= 0, "目标当前金额不能为负数")
        _number_rule("goals", row, "monthly_saving", lambda value: value >= 0, "目标月储蓄不能为负数")
        if row.get("status") not in {"active", "paused", "completed", "archived"}:
            _reject("goals", row, "目标状态无效")
    for row in data["goal_allocations"]:
        _number_rule("goal_allocations", row, "target_amount", lambda value: value > 0, "成员目标金额必须大于 0")
        _number_rule("goal_allocations", row, "current_amount", lambda value: value >= 0, "成员目标当前金额不能为负数")
        _number_rule("goal_allocations", row, "monthly_saving", lambda value: value >= 0, "成员目标月储蓄不能为负数")
