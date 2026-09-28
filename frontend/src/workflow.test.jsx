// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LedgerPage from "./pages/LedgerPage";
import GoalsPage from "./pages/GoalsPage";
import { parseStatementRows } from "./statementImport";
import { clearSavedBudgetDrafts } from "./budgetDrafts";
import StatementImportDialog from "./components/StatementImportDialog";
import BackupDialog from "./components/BackupDialog";
import App from "./App";
import { fetchJson, patchJson, postJson } from "./api";

vi.mock("./api", () => ({
  AUTH_TOKEN_KEY: "investAuthToken", fetchJson: vi.fn(), patchJson: vi.fn(), postJson: vi.fn(),
  deleteJson: vi.fn(), downloadFile: vi.fn(), apiUrl: (path) => path,
  requestHeaders: () => ({}), ensureResponse: async (response) => response,
}));
vi.mock("./pages/DashboardPage", () => ({ default: () => <div>总览内容</div> }));
vi.mock("./pages/AssetsPage", () => ({ default: ({ view }) => <>
  <button onClick={() => view.openAction("new_trade")}>买入新标的</button>
  <button onClick={() => view.openRepayment(view.creditAccountsView[0])}>还款</button>
  <button onClick={() => view.openEditAction("goal", { id: 1, name: "旅行", target_amount: 1000, current_amount: 100 })}>编辑目标测试</button>
</> }));

const accounts = [
  { id: 1, owner: "大宝", name: "银行卡", currency: "USD" },
  { id: 2, owner: "小宝", name: "银行卡", currency: "CNY" },
];
const exported = { 日期: "2026-09-20", 类型: "支出", 方向: "支出", 所属人: "大宝", 账户: "银行卡", 账户ID: "99", 金额: "10", 币种: "USD", 汇率: "7", "商户/来源": "咖啡店", 来源: "manual", 状态: "有效" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("imports exported direction, merchant and historical FX, using owner/name across books", () => {
  const { rows } = parseStatementRows([exported, { ...exported, 方向: "收入", 类型: "收入" }], accounts);
  expect(rows.map((row) => row.direction)).toEqual(["expense", "income"]);
  expect(rows[0]).toMatchObject({ account_id: 1, amount: 10, merchant: "咖啡店", exchange_rate_to_base: 7 });
});

it("rejects ambiguous account names and missing foreign historical rates", () => {
  expect(() => parseStatementRows([{ ...exported, 所属人: "" }], accounts)).toThrow("不唯一");
  expect(() => parseStatementRows([{ ...exported, 汇率: "" }], accounts)).toThrow("发生时");
});

it("reports skipped non-income/expense records and rejects impossible dates", () => {
  expect(parseStatementRows([{ ...exported, 来源: "transfer" }, { ...exported, 状态: "已撤销" }], accounts)).toEqual({ rows: [], skipped: 2 });
  expect(() => parseStatementRows([{ ...exported, 日期: "2026-02-30" }], accounts)).toThrow("日期");
});

it("clears only the saved draft version while preserving newer edits and other months", () => {
  expect(clearSavedBudgetDrafts({ 1: "900", 2: "700", 3: "200" }, { 1: "800", 2: "700" })).toEqual({ 1: "900", 3: "200" });
});

it("lets users explicitly include suspected duplicates and locks exact duplicates", async () => {
  const imported = vi.fn();
  postJson.mockResolvedValue({ imported: 2 });
  render(<StatementImportDialog preview={{ total: 3, rows: [
    { ...exported, duplicate: false },
    { ...exported, duplicate: true, duplicate_kind: "suspected", balance_applied: false, opened_at: "2026-09-28" },
    { ...exported, duplicate: true, duplicate_kind: "exact" },
  ] }} onClose={vi.fn()} onImported={imported} />);
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);
  expect(boxes[2].disabled).toBe(true);
  fireEvent.click(boxes[1]);
  fireEvent.click(screen.getByRole("button", { name: "确认导入 2 笔" }));
  await waitFor(() => expect(imported).toHaveBeenCalled());
  expect(postJson.mock.calls[0][1].rows.map((row) => row.decision)).toEqual(["import", "import", "skip"]);
});

it("requires backup preview and explicit replacement confirmation before restoring", async () => {
  const backup = { format: "invest-backup", data: {} };
  postJson.mockResolvedValueOnce({ counts: { accounts: 2 }, current_counts: { accounts: 3 }, expected_fingerprint: "current-book" })
    .mockResolvedValueOnce({ recovery_backup: "before.json" });
  const restored = vi.fn();
  const { container } = render(<BackupDialog onClose={vi.fn()} onRestored={restored} onDownload={vi.fn()} />);
  const file = new File(["{}"], "saved.json", { type: "application/json" });
  file.text = async () => JSON.stringify(backup);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  const restoreButton = await screen.findByRole("button", { name: "确认恢复" });
  expect(restoreButton.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(restoreButton);
  await waitFor(() => expect(restored).toHaveBeenCalled());
  expect(postJson).toHaveBeenLastCalledWith("/warehouse/restore", { backup, expected_fingerprint: "current-book", confirm_replace: true });
  expect(screen.getByRole("button", { name: "下载恢复前的数据副本" })).toBeTruthy();
});

function mockBook() {
  localStorage.setItem("investAuthToken", "isolated-test");
  fetchJson.mockImplementation(async (path) => {
    if (path.startsWith("/budgets/monthly")) return { items: [{ id: 1, name: "餐饮", budget: 500, used: 0 }], total_budget: 500 };
    if (path === "/accounts/overview") return { accounts: [{ id: 1, name: "投资账户", owner: "大宝", type: "investment", currency: "CNY", balance: 1000 }], distribution: [] };
    if (["/holdings", "/categories", "/ledger", "/investments/trades"].includes(path) || path.startsWith("/transactions?")) return [];
    return {};
  });
}

it("keeps budget input through interval/focus refresh and preserves typing during save", async () => {
  mockBook();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let resolveSave;
  patchJson.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "计划" }));
  const input = await screen.findByRole("textbox", { name: "餐饮预算金额" });
  fireEvent.change(input, { target: { value: "800" } });
  await act(async () => { vi.advanceTimersByTime(30000); window.dispatchEvent(new Event("focus")); });
  expect(input.value).toBe("800");
  fireEvent.click(screen.getByRole("button", { name: "保存批量调整" }));
  await waitFor(() => expect(patchJson).toHaveBeenCalledWith("/budgets/batch", { items: [{ id: 1, amount: 800 }] }));
  fireEvent.change(input, { target: { value: "900" } });
  await act(async () => resolveSave({}));
  expect(input.value).toBe("900");
  fireEvent.click(screen.getByRole("button", { name: "取消调整" }));
  expect(input.value).toBe("500");
});

it("submits the first buy as one request with a new holding and trade details", async () => {
  mockBook();
  postJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  fireEvent.click(await screen.findByRole("button", { name: "买入新标的" }));
  fireEvent.change(screen.getByPlaceholderText("例如：贵州茅台 / 沪深300ETF"), { target: { value: "新股" } });
  fireEvent.change(screen.getByPlaceholderText("例如：600519 / 001186 / AAPL"), { target: { value: "NEW" } });
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("成交价格"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/investments/trades", expect.objectContaining({
    new_holding: expect.objectContaining({ account_id: 1, code: "NEW" }),
    trade_type: "buy", quantity: 10, price: 20,
  })));
});

it("locks both save buttons while a financial request is pending and allows the next real entry", async () => {
  mockBook();
  let resolve;
  postJson.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith("/accounts/overview"));
  fireEvent.click(screen.getByRole("button", { name: "记一笔" }));
  fireEvent.change(screen.getByLabelText("金额"), { target: { value: "100" } });
  const keepOpen = screen.getByRole("button", { name: "再记一笔" });
  fireEvent.click(keepOpen);
  fireEvent.click(keepOpen);
  expect(postJson).toHaveBeenCalledTimes(1);
  expect(keepOpen.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "保存中…" }).disabled).toBe(true);
  await act(async () => resolve({ id: 1 }));
  expect(screen.getByLabelText("金额").value).toBe("");
  fireEvent.change(screen.getByLabelText("金额"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(postJson).toHaveBeenCalledTimes(2);
  await act(async () => resolve({ id: 2 }));
});

it("prefills foreign card debt in original currency and recalculates after changing the paying account", async () => {
  mockBook();
  const defaultFetch = fetchJson.getMockImplementation();
  fetchJson.mockImplementation(async (path) => path === "/accounts/overview" ? { accounts: [
    { id: 1, owner: "大宝", name: "美元储蓄", type: "debit_card", currency: "USD", exchange_rate_to_base: 8, balance: 8000, original_balance: 1000 },
    { id: 2, owner: "大宝", name: "美元信用卡", type: "credit_card", is_liability: 1, currency: "USD", exchange_rate_to_base: 7, balance: 700, original_balance: 100 },
    { id: 3, owner: "大宝", name: "人民币储蓄", type: "debit_card", currency: "CNY", balance: 1000, original_balance: 1000 },
  ], distribution: [] } : defaultFetch(path));
  postJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  fireEvent.click(await screen.findByRole("button", { name: "还款" }));
  expect(screen.getByLabelText(/付款金额/).value).toBe("100");
  expect(screen.getByText("付款 100.00 USD → 到账 100.00 USD")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/转出账户只展示/), { target: { value: "3" } });
  expect(screen.getByLabelText(/付款金额/).value).toBe("700");
  expect(screen.getByLabelText(/实际到账/).value).toBe("100");
  fireEvent.change(screen.getByLabelText(/转出账户只展示/), { target: { value: "1" } });
  expect(screen.getByLabelText(/付款金额/).value).toBe("100");
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/accounts/transfer", expect.objectContaining({
    from_account_id: 1, to_account_id: 2, amount: 100, to_amount: 100,
  })));
});

it("does not submit cached progress or status when editing goal metadata", async () => {
  mockBook();
  patchJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑目标测试" }));
  fireEvent.change(screen.getByLabelText(/目标名称/), { target: { value: "新旅行" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(patchJson).toHaveBeenCalled());
  expect(patchJson.mock.calls[0][1]).not.toHaveProperty("current_amount");
  expect(patchJson.mock.calls[0][1]).not.toHaveProperty("status");
});

it("shows fee-inclusive original cash and prevents interpreting valuation rates as settlement rates", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  fireEvent.click(await screen.findByRole("button", { name: "买入新标的" }));
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("成交价格"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/手续费使用/), { target: { value: "2" } });
  expect(screen.getByText("现金扣减 202.00 CNY")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: /^计价币种/ }), { target: { value: "USD" } });
  expect(screen.queryByText("现金扣减 202.00 CNY")).toBeNull();
  fireEvent.change(screen.getByLabelText(/实际结算汇率/), { target: { value: "7" } });
  expect(screen.getByText("现金扣减 1,414.00 CNY")).toBeTruthy();
});

it("totals every filtered page in base currency, excludes voided/non-cashflow rows and keeps a negative balance", () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: index + 1, source: "manual", direction: "expense", account_id: 1, account_owner: "大宝",
    occurred_at: "2026-09-28", amount: 10, base_amount: 70, merchant: `消费${index + 1}`,
  }));
  render(<LedgerPage view={{
    accountOwnerOptions: ["大宝"], accountsData: { accounts: [] }, categoriesData: [],
    expenseData: {}, incomeData: {}, formatDateLabel: (date) => date, formatMoney: (amount) => `¥${amount}`,
    ledgerData: [...rows, { ...rows[0], id: 32, voided_at: "2026-09-28" }, { ...rows[0], id: 33, source: "opening" }],
    ledgerAccountFilter: "all", setLedgerAccountFilter: vi.fn(),
    monthlyExpense: 9999, monthlyIncome: 10000, selectedMonth: "2026-09",
  }} />);
  const totals = within(screen.getByLabelText("筛选结果合计"));
  expect(totals.getByText("¥2170")).toBeTruthy();
  expect(totals.getByText("¥-2170").className).toBe("negative");
  expect(screen.queryByText("消费31")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("消费31")).toBeTruthy();
  expect(totals.getByText("¥2170")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("搜索商户、备注、分类或账户"), { target: { value: "消费31" } });
  expect(totals.getByText("¥70")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
});

it("groups goals by status and offers recovery instead of deposits on completed and archived goals", () => {
  const handleGoalStatus = vi.fn();
  const goal = { target: 1000, current: 100, saved: 100, monthly: 100 };
  render(<GoalsPage view={{
    formatMoney: String, goalsData: {}, goalCardsView: [
      { ...goal, id: 1, name: "进行旅行", status: "active" },
      { ...goal, id: 2, name: "已完成旅行", status: "completed" },
      { ...goal, id: 3, name: "归档旅行", status: "archived" },
    ], handleGoalStatus, formatMonthLabel: String, ChartRangeSwitch: () => null,
    chartRangeOptions: {}, goalPlanView: [],
  }} />);
  expect(screen.getByRole("button", { name: "存入" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "已完成 · 1" }));
  expect(screen.queryByRole("button", { name: "存入" })).toBeNull();
  expect(screen.getByText(/已完成旅行/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "已归档 · 1" }));
  expect(screen.queryByRole("button", { name: "归档" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "恢复进行中" }));
  expect(handleGoalStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), "active");
});
