// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppTransactionComposer from "./AppTransactionComposer";
import { todayInputValue } from "../shared/businessDate";

afterEach(cleanup);

const accounts = [
  { id: 1, owner: "大宝", name: "工资卡", currency: "CNY" },
  { id: 2, owner: "小宝", name: "支付宝", currency: "CNY" },
];

function Harness({ onSubmit }) {
  const [form, setForm] = useState({
    account_id: "1",
    account_owner: "大宝",
    amount: "",
    category_name: "",
    direction: "expense",
    merchant: "",
    note: "",
    occurred_at: "2026-10-07",
  });
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "direction" ? { category_name: "" } : null),
    }));
  };
  return (
    <AppTransactionComposer
      categoriesData={[
        { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#176b4d" },
        { id: 2, name: "工资", type: "income", icon: "💼", color: "#4f7ea3" },
      ]}
      form={form}
      getAccountById={(id) => accounts.find((account) => String(account.id) === String(id))}
      handleChange={handleChange}
      handleSubmitAction={onSubmit}
      isDatePickerOpen={false}
      isSubmitting={false}
      onClose={vi.fn()}
      renderAccountOptions={(owner) => accounts
        .filter((account) => account.owner === owner)
        .map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      renderAccountOwnerOptions={() => [
        <option key="大宝" value="大宝">大宝</option>,
        <option key="小宝" value="小宝">小宝</option>,
      ]}
      renderDateButton={() => <button type="button">选择日期</button>}
    />
  );
}

it("uses category-first entry and submits the calculated amount snapshot", () => {
  const onSubmit = vi.fn();
  render(<Harness onSubmit={onSubmit} />);

  fireEvent.click(screen.getByRole("button", { name: "餐饮" }));
  expect(screen.getByRole("button", { name: "餐饮" }).getAttribute("aria-pressed"))
    .toBe("true");
  expect(screen.getByRole("button", { name: "将日期设为今天" }).textContent)
    .toContain("今天");
  fireEvent.click(screen.getByRole("button", { name: "将日期设为今天" }));

  for (const key of ["1", "2", ".", "3", "4"]) {
    fireEvent.click(screen.getByRole("button", {
      name: key === "." ? "小数点" : `数字 ${key}`,
    }));
  }
  fireEvent.click(screen.getByRole("button", { name: "加" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 5" }));
  fireEvent.click(screen.getByRole("button", { name: "完成" }));

  expect(onSubmit).toHaveBeenCalledWith({
    formOverride: expect.objectContaining({
      account_id: "1",
      amount: "17.34",
      category_name: "餐饮",
      direction: "expense",
      occurred_at: todayInputValue(),
    }),
  });
});
