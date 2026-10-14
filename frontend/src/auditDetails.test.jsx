// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FamilyDialog from "./components/FamilyDialog";
import AuditDetails from "./components/AuditDetails";

afterEach(cleanup);

it("shows correction markers and account balances from the nested transaction contract", () => {
  render(<AuditDetails event={{
    summary: "更正流水余额应用", entity_type: "transaction", payload_version: 1,
    before_value: { transaction: { id: 9, balance_applied: 0 }, account: { id: 7, balance: 100 } },
    after_value: { transaction: { id: 9, balance_applied: 1 }, account: { id: 7, balance: 90 } },
  }} />);
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByRole("row", { name: "余额应用（原流水） 未应用 已应用" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "账户余额（关联账户） 100 90" })).toBeTruthy();
});

it("opens the family audit details with amount, account and quantity changes", () => {
  const event = {
    id: 1, summary: "更正持仓", actor_name: "大宝", created_at: "2026-09-29T12:00:00",
    before_value: JSON.stringify({ id: 1, amount: 5, quantity: 0, account_id: 1, account_name: "A", account_owner: "大宝" }),
    after_value: JSON.stringify({ id: 1, amount: 7, quantity: 2, account_id: 2, account_name: "B", account_owner: "小宝" }),
  };
  render(<FamilyDialog family={{ name: "家庭", members: [], recent_activity: [event] }} onClose={vi.fn()} onChanged={vi.fn()} />);
  const trigger = screen.getByText("查看变更详情");
  expect(trigger.closest("details").open).toBe(false);
  fireEvent.click(trigger);
  expect(trigger.closest("details").open).toBe(true);
  const table = screen.getByRole("table", { name: "操作变更字段" });
  expect(within(table).getByRole("row", { name: "金额 5 7" })).toBeTruthy();
  expect(within(table).getByRole("row", { name: "数量 0 2" })).toBeTruthy();
  expect(within(table).getByRole("row", { name: /账户 大宝 · A（#1） 小宝 · B（#2）/ })).toBeTruthy();
});

it("shows an empty before value for creation and keeps an empty after value for deletion", () => {
  const { rerender } = render(<AuditDetails event={{ summary: "新增流水", after_value: '{"amount":7}' }} />);
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByRole("row", { name: "金额 — 7" })).toBeTruthy();
  rerender(<AuditDetails event={{ summary: "删除流水", before_value: '{"amount":7}' }} />);
  expect(screen.getByRole("row", { name: "金额 7 —" })).toBeTruthy();
});

it("handles old records without snapshots and never exposes unknown fields", () => {
  const { rerender } = render(<AuditDetails event={{ summary: "旧记录" }} />);
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByText("此历史记录未保存修改前后值。")).toBeTruthy();
  rerender(<AuditDetails event={{ summary: "资料", after_value: '{"amount":0,"password_hash":"sensitive"}' }} />);
  expect(screen.queryByText("sensitive")).toBeNull();
  expect(screen.getByRole("row", { name: "金额 — 0" })).toBeTruthy();
});

it("expands goal progress and budget allocations by stable business keys", () => {
  const goal = {
    summary: "目标进度", entity_type: "goal_record", payload_version: 1,
    before_value: JSON.stringify({
      goal: { id: 1, current_amount: 0 },
      allocation: { id: 10, member_id: 7, current_amount: 0 },
    }),
    after_value: JSON.stringify({
      goal: { id: 1, current_amount: 50 },
      allocation: { id: 11, member_id: 7, current_amount: 50 },
      record: { id: 20, member_id: 7, amount: 50, recorded_at: "2026-09-28" },
    }),
  };
  const { rerender } = render(
    <AuditDetails event={goal} members={[{ id: 7, display_name: "大宝" }]} />,
  );
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByRole("row", { name: "已存金额（目标汇总） 0 50" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "已存金额（成员进度：大宝） 0 50" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "记录日期（本次进度记录） — 2026-09-28" })).toBeTruthy();

  const budget = {
    summary: "预算", entity_type: "budget_plan", payload_version: 1,
    before_value: JSON.stringify({
      id: 1, month: "2026-09", total_amount: 100,
      categories: [{ id: 1, category_id: 5, amount: 100 }],
      member_allocations: [{ id: 2, member_id: 7, amount: 100 }],
      category_allocations: [{ id: 3, category_id: 5, member_id: 7, amount: 100 }],
    }),
    after_value: JSON.stringify({
      id: 1, month: "2026-09", total_amount: 200,
      categories: [{ id: 99, category_id: 5, amount: 200 }],
      member_allocations: [{ id: 98, member_id: 7, amount: 200 }],
      category_allocations: [{ id: 97, category_id: 5, member_id: 7, amount: 200 }],
    }),
  };
  rerender(<AuditDetails
    event={budget}
    members={[{ id: 7, display_name: "大宝" }]}
    categories={[{ id: 5, name: "餐饮" }]}
  />);
  expect(screen.getByRole("row", { name: "预算总额 100 200" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "金额（分类预算：餐饮） 100 200" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "金额（成员预算：大宝） 100 200" })).toBeTruthy();
});

it("shows embedded investment state and separates transfer rows with colliding ids", () => {
  const investment = {
    summary: "买入", entity_type: "investment_trade", payload_version: 1,
    after_value: JSON.stringify({
      id: 1, trade_type: "buy", quantity: 2,
      account_before: { id: 8, type: "investment", cash_available: 1000 },
      account_after: { id: 8, type: "investment", cash_available: 800 },
      holding_before: { id: 9, asset_type: "stock", quantity: 0 },
      holding_after: { id: 9, asset_type: "stock", quantity: 2 },
    }),
  };
  const { rerender } = render(<AuditDetails event={investment} />);
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByRole("row", { name: "现金可投（结算账户） 1000 800" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "数量（关联持仓） 0 2" })).toBeTruthy();

  rerender(<AuditDetails event={{
    summary: "转账", entity_type: "transfer", payload_version: 1,
    before_value: JSON.stringify([{ id: 1, type: "debit_card", balance: 100 }]),
    after_value: JSON.stringify([{ id: 1, source: "transfer", direction: "expense", amount: 20 }]),
  }} />);
  expect(screen.getByRole("row", { name: "账户余额（账户 1） 100 —" })).toBeTruthy();
  expect(screen.getByRole("row", { name: "收支方向（流水 1） — 支出" })).toBeTruthy();
});

it("explains historical payloads instead of guessing nested ids", () => {
  render(<AuditDetails event={{
    summary: "未来载荷", entity_type: "goal", payload_version: 9,
    after_value: '{"goal":{"id":1,"target_amount":100}}',
  }} />);
  fireEvent.click(screen.getByText("查看变更详情"));
  expect(screen.getByText("此历史记录使用旧版载荷，原始内容已保留但不能安全关联当前实体。")).toBeTruthy();
});
