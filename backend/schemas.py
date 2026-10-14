from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

from domain.accounts import AccountStateViolation, validate_opening_state
from domain.dates import canonical_business_date, canonical_business_month
from money import money, money_equal, price, quantity, rate


MoneyValue = Annotated[Decimal, BeforeValidator(money)]
PriceValue = Annotated[Decimal, BeforeValidator(price)]
QuantityValue = Annotated[Decimal, BeforeValidator(quantity)]
RateValue = Annotated[Decimal, BeforeValidator(rate)]
BusinessDate = Annotated[str, BeforeValidator(canonical_business_date)]
BusinessMonth = Annotated[str, BeforeValidator(canonical_business_month)]


class DatedModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


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
    username: str | None = None
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class FamilyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class FamilyMemberCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=40)
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "member"] = "member"


class FamilyMemberUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    username: str | None = Field(default=None, min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: Literal["admin", "member"] | None = None
    login_enabled: bool | None = None


class AccountCreate(CurrencyModel):
    name: str = Field(min_length=1)
    type: str
    owner: str | None = "冠池"
    member_id: int | None = Field(default=None, gt=0)
    balance: MoneyValue = Decimal("0")
    opening_date: BusinessDate | None = None
    currency: str = "CNY"
    exchange_rate_to_base: RateValue = Field(default=Decimal("1"), gt=0)
    last4: str | None = None
    credit_limit: MoneyValue = Field(default=Decimal("0"), ge=0)
    statement_day: int | None = Field(default=None, ge=1, le=31)
    repayment_day: int | None = Field(default=None, ge=1, le=31)
    is_liability: bool = False

    @model_validator(mode="after")
    def validate_opening_balance(self):
        try:
            validate_opening_state(
                account_type=self.type,
                is_liability=self.type == "credit_card" or self.is_liability,
                opening_balance=self.balance,
                name=self.name,
            )
        except AccountStateViolation as exc:
            raise ValueError(str(exc)) from exc
        return self


class TransferCreate(DatedModel):
    from_account_id: int = Field(gt=0)
    to_account_id: int = Field(gt=0)
    amount: MoneyValue = Field(gt=0)
    to_amount: MoneyValue | None = Field(default=None, gt=0)
    occurred_at: BusinessDate
    note: str | None = None


class BalanceAdjustmentCreate(DatedModel):
    actual_balance: MoneyValue
    expected_balance: MoneyValue | None = None
    occurred_at: BusinessDate
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
    amount: MoneyValue = Field(gt=0)
    direction: Literal["income", "expense"]
    occurred_at: BusinessDate
    merchant: str | None = None
    note: str | None = None


class TransactionApplicationCorrection(BaseModel):
    expected_account_balance: MoneyValue
    expected_balance_applied: bool
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def nonblank_application_reason(cls, value):
        if not value.strip():
            raise ValueError("请填写余额应用标记更正原因")
        return value.strip()


class StatementImportRow(DatedModel):
    account_id: int = Field(gt=0)
    amount: MoneyValue = Field(gt=0)
    direction: Literal["income", "expense"]
    occurred_at: BusinessDate
    category_name: str | None = None
    merchant: str | None = None
    note: str | None = None
    external_id: str | None = None
    currency: str | None = None
    exchange_rate_to_base: RateValue | None = Field(default=None, gt=0)
    decision: Literal["auto", "import", "skip"] = "auto"


class StatementImportPayload(BaseModel):
    rows: list[StatementImportRow]
    skip_duplicates: bool = True


class HoldingCreate(CurrencyModel):
    name: str = Field(min_length=1)
    code: str = Field(min_length=1)
    buy_price: PriceValue = Field(ge=0)
    quantity: QuantityValue = Field(gt=0)
    current_price: PriceValue = Field(ge=0)
    account_id: int | None = Field(default=None, gt=0)
    asset_type: str = "stock"
    market: str | None = None
    currency: str = "CNY"
    exchange_rate_to_base: RateValue = Field(default=Decimal("1"), gt=0)


class InvestmentCashUpdate(BaseModel):
    account_id: int = Field(gt=0)
    cash_available: MoneyValue = Field(ge=0)
    expected_cash_available: MoneyValue = Field(ge=0)
    reason: str = Field(default="手动核对现金可投", min_length=1)


class InvestmentTradeCreate(DatedModel):
    holding_id: int | None = Field(default=None, gt=0)
    new_holding: HoldingCreate | None = None
    trade_type: Literal["buy", "sell"]
    quantity: QuantityValue = Field(gt=0)
    price: PriceValue = Field(gt=0)
    fee: PriceValue = Field(default=Decimal("0"), ge=0)
    settlement_rate: RateValue | None = Field(default=None, gt=0)
    occurred_at: BusinessDate
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


class MemberAmountAllocation(BaseModel):
    member_id: int = Field(gt=0)
    amount: MoneyValue = Field(ge=0)


class BudgetCategoryAllocation(BaseModel):
    category_id: int | None = Field(default=None, gt=0)
    category_name: str | None = Field(default=None, min_length=1)
    amount: MoneyValue = Field(gt=0)
    alert_threshold: RateValue = Field(default=Decimal("0.9"), gt=0, le=1)
    member_allocations: list[MemberAmountAllocation] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_category(self):
        if not self.category_id and not (self.category_name or "").strip():
            raise ValueError("请选择预算分类")
        member_ids = [item.member_id for item in self.member_allocations]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError("同一分类的成员承担不能重复")
        if self.member_allocations and not money_equal(
            sum(item.amount for item in self.member_allocations),
            self.amount,
        ):
            raise ValueError("每个分类的成员承担合计必须等于该分类预算")
        return self


class BudgetCreate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    month: str
    total_amount: MoneyValue = Field(gt=0)
    categories: list[BudgetCategoryAllocation] = Field(default_factory=list)
    member_allocations: list[MemberAmountAllocation] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_allocations(self):
        member_ids = [item.member_id for item in self.member_allocations]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError("成员分配不能重复")
        if not self.categories:
            if not self.member_allocations:
                raise ValueError("请提供成员预算分配")
            if not money_equal(
                sum(item.amount for item in self.member_allocations),
                self.total_amount,
            ):
                raise ValueError("成员分配合计必须等于月度总预算")
            return self
        category_keys = [
            ("id", item.category_id) if item.category_id else ("name", item.category_name.strip())
            for item in self.categories
        ]
        if len(set(category_keys)) != len(category_keys):
            raise ValueError("预算分类不能重复")
        category_total = sum(item.amount for item in self.categories)
        if not money_equal(category_total, self.total_amount):
            raise ValueError("分类预算合计必须等于月度总预算")
        nested = [bool(item.member_allocations) for item in self.categories]
        if any(nested) and not all(nested):
            raise ValueError("预算分类必须统一使用分类成员分配")
        if all(nested) and self.member_allocations:
            raise ValueError("分类成员分配与旧版成员总额不能同时提交")
        if not all(nested) and not self.member_allocations:
            raise ValueError("请提供成员预算分配")
        if self.member_allocations and not money_equal(
            sum(item.amount for item in self.member_allocations),
            self.total_amount,
        ):
            raise ValueError("成员分配合计必须等于月度总预算")
        return self


class BudgetCopyCreate(BaseModel):
    source_month: str
    target_month: str
    overwrite: bool = False


class BudgetBatchItem(BaseModel):
    id: int = Field(gt=0)
    amount: MoneyValue = Field(ge=0)


class BudgetBatchUpdate(BaseModel):
    items: list[BudgetBatchItem]


class GoalMemberAllocation(BaseModel):
    member_id: int = Field(gt=0)
    target_amount: MoneyValue = Field(gt=0)
    current_amount: MoneyValue | None = Field(default=None, ge=0)
    monthly_saving: MoneyValue = Field(default=Decimal("0"), ge=0)


class GoalUpdate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    name: str = Field(min_length=1)
    target_amount: MoneyValue = Field(gt=0)
    monthly_saving: MoneyValue = Field(default=Decimal("0"), ge=0)
    due_date: BusinessDate | None = None
    icon: str | None = None
    color: str | None = None
    allocations: list[GoalMemberAllocation] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_allocations(self):
        member_ids = [item.member_id for item in self.allocations]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError("目标成员分配不能重复")
        if not money_equal(
            sum(item.target_amount for item in self.allocations),
            self.target_amount,
        ):
            raise ValueError("成员目标合计必须等于家庭目标金额")
        if not money_equal(
            sum(item.monthly_saving for item in self.allocations),
            self.monthly_saving,
        ):
            raise ValueError("成员每月储蓄合计必须等于家庭每月计划")
        return self


class GoalCreate(GoalUpdate):
    status: Literal["active", "paused", "completed", "archived"] = "active"


class GoalRecordCreate(DatedModel):
    amount: MoneyValue
    recorded_at: BusinessDate
    note: str | None = None
    member_id: int | None = Field(default=None, gt=0)


class GoalStatusUpdate(BaseModel):
    status: Literal["active", "paused", "completed", "archived"]
