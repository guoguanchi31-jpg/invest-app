from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DatedModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    @field_validator("occurred_at", "recorded_at", check_fields=False)
    @classmethod
    def validate_iso_date(cls, value: str):
        try:
            date.fromisoformat(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("日期必须是有效的 YYYY-MM-DD 格式") from exc
        return value


class CurrencyModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    @field_validator("currency", check_fields=False)
    @classmethod
    def normalize_currency(cls, value: str):
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("币种必须是三位字母代码")
        return normalized


class LoginData(BaseModel):
    password: str


class AccountCreate(CurrencyModel):
    name: str = Field(min_length=1)
    type: str
    owner: str | None = "冠池"
    balance: float = 0
    opening_date: str | None = None
    currency: str = "CNY"
    exchange_rate_to_base: float = Field(default=1, gt=0)
    last4: str | None = None
    credit_limit: float = Field(default=0, ge=0)
    statement_day: int | None = Field(default=None, ge=1, le=31)
    repayment_day: int | None = Field(default=None, ge=1, le=31)
    is_liability: bool = False

    @field_validator("opening_date")
    @classmethod
    def validate_opening_date(cls, value: str | None):
        if value:
            date.fromisoformat(value)
        return value


class TransferCreate(DatedModel):
    from_account_id: int = Field(gt=0)
    to_account_id: int = Field(gt=0)
    amount: float = Field(gt=0)
    to_amount: float | None = Field(default=None, gt=0)
    occurred_at: str
    note: str | None = None


class BalanceAdjustmentCreate(DatedModel):
    actual_balance: float
    expected_balance: float | None = None
    occurred_at: str
    reason: str = Field(min_length=1)


class CategoryCreate(BaseModel):
    name: str
    type: str
    icon: str | None = None
    color: str | None = None


class TransactionCreate(DatedModel):
    account_id: int = Field(gt=0)
    category_id: int | None = Field(default=None, gt=0)
    category_name: str | None = None
    amount: float = Field(gt=0)
    direction: Literal["income", "expense"]
    occurred_at: str
    merchant: str | None = None
    note: str | None = None


class StatementImportRow(DatedModel):
    account_id: int = Field(gt=0)
    amount: float = Field(gt=0)
    direction: Literal["income", "expense"]
    occurred_at: str
    category_name: str | None = None
    merchant: str | None = None
    note: str | None = None
    external_id: str | None = None
    currency: str | None = None
    exchange_rate_to_base: float | None = Field(default=None, gt=0)
    decision: Literal["auto", "import", "skip"] = "auto"


class StatementImportPayload(BaseModel):
    rows: list[StatementImportRow]
    skip_duplicates: bool = True


class HoldingCreate(CurrencyModel):
    name: str = Field(min_length=1)
    code: str = Field(min_length=1)
    buy_price: float = Field(ge=0)
    quantity: float = Field(gt=0)
    current_price: float = Field(ge=0)
    account_id: int | None = Field(default=None, gt=0)
    asset_type: str = "stock"
    market: str | None = None
    currency: str = "CNY"
    exchange_rate_to_base: float = Field(default=1, gt=0)


class InvestmentCashUpdate(BaseModel):
    account_id: int
    cash_available: float = Field(ge=0)


class InvestmentTradeCreate(DatedModel):
    holding_id: int | None = Field(default=None, gt=0)
    new_holding: HoldingCreate | None = None
    trade_type: Literal["buy", "sell"]
    quantity: float = Field(gt=0)
    price: float = Field(gt=0)
    fee: float = Field(default=0, ge=0)
    settlement_rate: float | None = Field(default=None, gt=0)
    occurred_at: str
    note: str | None = None

    @model_validator(mode="after")
    def validate_target(self):
        if bool(self.holding_id) == bool(self.new_holding):
            raise ValueError("请选择已有持仓或填写新标的")
        if self.new_holding and (self.trade_type != "buy" or not self.new_holding.account_id):
            raise ValueError("新标的必须关联投资账户并通过买入建仓")
        return self


class ReversalCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value):
        if not value.strip():
            raise ValueError("请填写撤销原因")
        return value.strip()


class BudgetCreate(BaseModel):
    month: str
    category_id: int | None = None
    category_name: str | None = None
    amount: float
    alert_threshold: float = 0.9


class BudgetCopyCreate(BaseModel):
    source_month: str
    target_month: str
    overwrite: bool = False


class BudgetBatchItem(BaseModel):
    id: int = Field(gt=0)
    amount: float = Field(ge=0)


class BudgetBatchUpdate(BaseModel):
    items: list[BudgetBatchItem]


class GoalUpdate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    name: str = Field(min_length=1)
    target_amount: float = Field(gt=0)
    monthly_saving: float = Field(default=0, ge=0)
    due_date: str | None = None
    icon: str | None = None
    color: str | None = None


class GoalCreate(GoalUpdate):
    current_amount: float = Field(default=0, ge=0)
    status: Literal["active", "paused", "completed", "archived"] = "active"


class GoalRecordCreate(DatedModel):
    amount: float
    recorded_at: str
    note: str | None = None


class GoalStatusUpdate(BaseModel):
    status: Literal["active", "paused", "completed", "archived"]
