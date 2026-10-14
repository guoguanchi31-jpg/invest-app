// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { todayInputValue } from "../shared/businessDate";
import AppGoalRecordComposer from "./AppGoalRecordComposer";
import AppTransferComposer from "./AppTransferComposer";

afterEach(cleanup);

const accounts = [
  {
    id: 1, owner: "大宝", name: "工资卡", type: "debit_card",
    currency: "CNY", balance: 1000,
  },
  {
    id: 2, owner: "大宝", name: "支付宝", type: "wallet",
    currency: "CNY", balance: 500,
  },
];

function TransferHarness({ accountList = accounts, onSubmit }) {
  const [form, setForm] = useState({
    from_account_id: "1",
    from_account_owner: "大宝",
    to_account_id: "2",
    to_account_owner: "大宝",
    amount: "",
    to_amount: "",
    note: "",
    occurred_at: "2026-10-07",
  });
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };
  return (
    <AppTransferComposer
      form={form}
      getAccountById={(id) => accountList.find((account) => String(account.id) === String(id))}
      handleChange={handleChange}
      handleSubmitAction={onSubmit}
      isDatePickerOpen={false}
      isSubmitting={false}
      onClose={vi.fn()}
      renderAccountOptions={() => accountList.map(
        (account) => <option key={account.id} value={account.id}>{account.name}</option>,
      )}
      renderAccountOwnerOptions={() => <option value="大宝">大宝</option>}
      renderDateButton={() => <button type="button">选择划转日期</button>}
    />
  );
}

function GoalHarness({ onSubmit }) {
  const [form, setForm] = useState({
    goal_id: "8",
    name: "旅行基金",
    amount: "",
    goal_record_type: "deposit",
    member_id: "1",
    goal_allocations: [{
      member_id: 1,
      member_name: "大宝",
      current_amount: 1200,
    }],
    note: "",
    occurred_at: "2026-10-07",
  });
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };
  return (
    <AppGoalRecordComposer
      canManageFamily
      form={form}
      handleChange={handleChange}
      handleSubmitAction={onSubmit}
      isDatePickerOpen={false}
      isSubmitting={false}
      onClose={vi.fn()}
      renderDateButton={() => <button type="button">选择目标日期</button>}
    />
  );
}

it("keeps Today fixed and submits the App transfer amount", () => {
  const onSubmit = vi.fn();
  render(<TransferHarness onSubmit={onSubmit} />);

  expect(screen.getByRole("button", { name: "将日期设为今天" }).textContent)
    .toContain("今天");
  fireEvent.click(screen.getByRole("button", { name: "将日期设为今天" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 5" }));
  fireEvent.click(screen.getByRole("button", { name: "完成" }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      amount: "5",
      from_account_id: "1",
      to_account_id: "2",
      occurred_at: todayInputValue(),
    }),
  });
});

it("uses the same App amount flow for a goal withdrawal", () => {
  const onSubmit = vi.fn();
  render(<GoalHarness onSubmit={onSubmit} />);

  fireEvent.click(screen.getByRole("tab", { name: "取出" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 2" }));
  fireEvent.click(screen.getByRole("button", { name: "取出" }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      amount: "2",
      goal_id: "8",
      goal_record_type: "withdraw",
    }),
  });
});

it("collects both sides of a cross-currency App transfer", () => {
  const onSubmit = vi.fn();
  render(
    <TransferHarness
      accountList={[
        accounts[0],
        { ...accounts[1], currency: "USD" },
      ]}
      onSubmit={onSubmit}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "数字 1" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 0" }));
  fireEvent.click(screen.getByRole("button", { name: /实际到账/ }));
  fireEvent.click(screen.getByRole("button", { name: "数字 1" }));
  fireEvent.click(screen.getByRole("button", { name: "小数点" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 4" }));
  fireEvent.click(screen.getByRole("button", { name: "完成" }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      amount: "10",
      to_amount: "1.4",
    }),
  });
});
