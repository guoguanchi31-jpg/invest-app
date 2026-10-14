// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TransferDetailDialog from "./TransferDetailDialog";

const transfer = {
  reference_id: "transfer-test",
  source: "transfer",
  from_account_id: 1,
  from_account_owner: "大宝",
  from_account_name: "美元账户",
  to_account_id: 2,
  to_account_owner: "小宝",
  to_account_name: "人民币账户",
  occurred_at: "2026-10-12",
  note: "家庭换汇",
  legs: [
    { direction: "expense", amount: 100, currency: "USD", base_amount: 700 },
    { direction: "income", amount: 700, currency: "CNY", base_amount: 700 },
  ],
};

afterEach(cleanup);

it("shows both transfer sides before offering reversal", () => {
  const onClose = vi.fn();
  const onReverse = vi.fn();
  render(<TransferDetailDialog
    accounts={[]}
    canReverse
    formatDateLabel={(value) => value}
    formatMoney={(value) => `¥${value}`}
    item={transfer}
    onClose={onClose}
    onReverse={onReverse}
  />);

  expect(screen.getByRole("dialog", { name: "转账详情" })).toBeTruthy();
  expect(screen.getByText("大宝 · 美元账户")).toBeTruthy();
  expect(screen.getByText("100.00 USD")).toBeTruthy();
  expect(screen.getByText("小宝 · 人民币账户")).toBeTruthy();
  expect(screen.getByText("700.00 CNY")).toBeTruthy();
  expect(screen.getByText("¥700")).toBeTruthy();
  expect(screen.getByText(/不计入收入、支出与结余/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "撤销转账" }));
  expect(onReverse).toHaveBeenCalledWith(transfer);
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps a voided transfer readable without a reversal command", () => {
  render(<TransferDetailDialog
    accounts={[]}
    canReverse={false}
    formatDateLabel={(value) => value}
    formatMoney={(value) => `¥${value}`}
    item={{
      ...transfer,
      voided_at: "2026-10-13T10:00:00",
      void_reason: "金额填错",
    }}
    onClose={vi.fn()}
    onReverse={vi.fn()}
  />);

  expect(screen.getByText("转账已撤销")).toBeTruthy();
  expect(screen.getByText("金额填错")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "撤销转账" })).toBeNull();
});
