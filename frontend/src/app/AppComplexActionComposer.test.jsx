// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AccountActionFields from "../features/accounts/AccountActionFields";
import InvestmentActionFields from "../features/investments/InvestmentActionFields";
import AppComplexActionComposer from "./AppComplexActionComposer";

const familyData = {
  can_manage: true,
  members: [{
    id: 1,
    display_name: "大宝",
    is_current: true,
    login_enabled: true,
  }],
};

const accounts = [{
  id: 1,
  owner: "大宝",
  name: "工资卡",
  type: "debit_card",
  currency: "CNY",
  balance: 100,
}];

afterEach(cleanup);

function AccountHarness({ actionMode = "account", onSubmit }) {
  const [form, setForm] = useState(actionMode === "account" ? {
    name: "",
    member_id: "1",
    type: "debit_card",
    balance: "",
    opening_date: "2026-10-13",
    currency: "CNY",
    exchange_rate_to_base: "1",
    last4: "",
    credit_limit: "",
    statement_day: "",
    repayment_day: "",
  } : {
    account_id: "1",
    actual_balance: "100",
    expected_balance: "100",
    occurred_at: "2026-10-13",
    reason: "银行核对",
  });
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };
  const getAccountById = (id) => accounts.find(
    (account) => String(account.id) === String(id),
  );
  const fieldProps = {
    getAccountById,
    handleChange,
    renderAllAccountOptions: () => (
      <option value="1">大宝 · 工资卡</option>
    ),
    renderDateButton: ({ label }) => <button type="button">{label}</button>,
  };
  return (
    <AppComplexActionComposer
      Fields={AccountActionFields}
      actionMode={actionMode}
      categoriesData={[]}
      dataScope="family"
      editTarget={null}
      familyData={familyData}
      fieldProps={fieldProps}
      form={form}
      getAccountById={getAccountById}
      handleChange={handleChange}
      handleDelete={vi.fn()}
      handleSubmitAction={onSubmit}
      isDatePickerOpen={false}
      isSubmitting={false}
      onClose={vi.fn()}
      title={actionMode === "account" ? "新增账户" : "余额核对 / 调整"}
    />
  );
}

function InvestmentHarness({ actionMode, onSubmit }) {
  const [form, setForm] = useState({
    name: "指数基金",
    code: "000001",
    asset_type: "fund",
    account_owner: "大宝",
    account_id: "2",
    market: "",
    currency: "CNY",
    exchange_rate_to_base: "1",
    buy_price: "",
    current_price: "",
    quantity: "",
    price: "",
    fee: "0",
    settlement_rate: "",
    trade_type: "buy",
    occurred_at: "2026-10-13",
    note: "",
  });
  const investmentAccounts = [{
    id: 2,
    owner: "大宝",
    name: "投资账户",
    type: "investment",
    currency: "CNY",
    balance: 1000,
  }];
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };
  const getAccountById = (id) => investmentAccounts.find(
    (account) => String(account.id) === String(id),
  );
  const fieldProps = {
    getAccountById,
    handleChange,
    renderAccountOwnerOptions: () => <option value="大宝">大宝</option>,
    renderInvestmentAccountOptions: () => (
      <option value="2">投资账户</option>
    ),
    renderDateButton: ({ label }) => <button type="button">{label}</button>,
  };
  return (
    <AppComplexActionComposer
      Fields={InvestmentActionFields}
      actionMode={actionMode}
      categoriesData={[]}
      dataScope="family"
      editTarget={null}
      familyData={familyData}
      fieldProps={fieldProps}
      form={form}
      getAccountById={getAccountById}
      handleChange={handleChange}
      handleDelete={vi.fn()}
      handleSubmitAction={onSubmit}
      isDatePickerOpen={false}
      isSubmitting={false}
      onClose={vi.fn()}
      title={actionMode === "holding" ? "录入已有持仓" : "买入持仓"}
    />
  );
}

it("edits every account number through one persistent App keypad", () => {
  const onSubmit = vi.fn();
  render(<AccountHarness onSubmit={onSubmit} />);

  const balanceInput = screen.getByLabelText("当前余额（CNY）");
  expect(balanceInput.readOnly).toBe(true);
  expect(balanceInput.inputMode).toBe("none");
  fireEvent.click(screen.getByRole("button", { name: "数字 1" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 2" }));
  fireEvent.click(screen.getByRole("button", { name: "小数点" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 5" }));

  fireEvent.click(screen.getByLabelText("账户尾号"));
  expect(screen.getByText("账户尾号", { selector: ".app-field-number-display > span" }))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "小数点" }).disabled).toBe(true);
  for (let index = 0; index < 4; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "数字 8" }));
  }

  fireEvent.click(balanceInput);
  fireEvent.click(screen.getByRole("button", { name: "创建账户" }));
  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      balance: "12.5",
      last4: "8888",
      member_id: "1",
    }),
  });
});

it("allows a negative balance only for a reconciliation field", () => {
  const onSubmit = vi.fn();
  render(<AccountHarness actionMode="adjustment" onSubmit={onSubmit} />);

  expect(screen.getByRole("button", { name: "切换正负数" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "切换正负数" }));
  fireEvent.click(screen.getByRole("button", { name: "保存核对" }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      actual_balance: "-100",
      account_id: "1",
    }),
  });
});

it.each([
  ["holding", "买入均价", "持仓数量", "保存持仓"],
  ["trade", "数量", "成交价格", "确认买入"],
])("switches every %s value without opening a native number keyboard", (
  actionMode,
  firstLabel,
  secondLabel,
  submitName,
) => {
  const onSubmit = vi.fn();
  render(<InvestmentHarness actionMode={actionMode} onSubmit={onSubmit} />);

  const firstInput = screen.getByLabelText(new RegExp(firstLabel));
  const secondInput = screen.getByLabelText(new RegExp(secondLabel));
  expect(firstInput.inputMode).toBe("none");
  expect(secondInput.inputMode).toBe("none");
  fireEvent.click(firstInput);
  fireEvent.click(screen.getByRole("button", { name: "数字 1" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 2" }));
  fireEvent.click(secondInput);
  fireEvent.click(screen.getByRole("button", { name: "数字 3" }));
  fireEvent.click(screen.getByRole("button", { name: submitName }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining(
      actionMode === "holding"
        ? { buy_price: "12", quantity: "3" }
        : { quantity: "12", price: "3" },
    ),
  });
});
