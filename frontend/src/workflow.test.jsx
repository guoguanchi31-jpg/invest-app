// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import LedgerPage from "./pages/LedgerPage";
import GoalsPage from "./pages/GoalsPage";
import AccountsPage from "./pages/AccountsPage";
import BudgetPage from "./pages/BudgetPage";
import { parseStatementRows } from "./statementImport";
import { clearSavedBudgetDrafts } from "./budgetDrafts";
import StatementImportDialog from "./components/StatementImportDialog";
import BackupDialog from "./components/BackupDialog";
import FamilyDialog from "./components/FamilyDialog";
import {
  PUBLIC_SECURITY_RECORD_ICON,
  PUBLIC_SECURITY_RECORD_NUMBER,
  PUBLIC_SECURITY_RECORD_URL,
} from "./components/SiteFooter";
import App from "./App";
import { fetchJson, patchJson, postJson } from "./api";
import usePaginatedResource from "./usePaginatedResource";
import { configureBusinessTimezone } from "./shared/businessDate";

vi.mock("./api", () => ({
  AUTH_TOKEN_KEY: "investAuthToken", DATA_SCOPE_KEY: "investDataScope",
  DATA_SCOPE_VERSION_KEY: "investDataScopeVersion",
  DATA_SCOPE_STORAGE_VERSION: "2",
  DEFAULT_DATA_SCOPE: "personal",
  fetchJson: vi.fn(), patchJson: vi.fn(), postJson: vi.fn(),
  deleteJson: vi.fn(), downloadFile: vi.fn(), apiUrl: (path) => path,
  requestHeaders: () => ({}), ensureResponse: async (response) => response,
  getRequestGeneration: () => 0,
  invalidateRequestGeneration: () => 1,
  isStaleRequestError: (error) => error?.stale === true,
  normalizeDataScope: (scope) => scope === "family" ? "family" : "personal",
  getStoredDataScope: () => localStorage.getItem("investDataScopeVersion") === "2"
    && localStorage.getItem("investDataScope") === "family" ? "family" : "personal",
  storeDataScope: (scope) => {
    const normalized = scope === "family" ? "family" : "personal";
    localStorage.setItem("investDataScope", normalized);
    localStorage.setItem("investDataScopeVersion", "2");
    return normalized;
  },
  clearStoredDataScope: () => {
    localStorage.removeItem("investDataScope");
    localStorage.removeItem("investDataScopeVersion");
  },
}));
vi.mock("./pages/DashboardPage", () => ({ default: () => <div>总览内容</div> }));
vi.mock("./pages/AssetsPage", () => ({ default: ({ view }) => <>
  <button onClick={() => view.openAction("new_trade")}>买入新标的</button>
  <button disabled={!view.creditAccountsView[0]} onClick={() => view.openRepayment(view.creditAccountsView[0])}>还款</button>
  <button onClick={() => view.openEditAction("goal", {
    id: 1,
    name: "旅行",
    family_target_amount: 1000,
    family_monthly_saving: 0,
    allocations: [{ member_id: 1, member_name: "大宝", target_amount: 1000, current_amount: 100, monthly_saving: 0 }],
  })}>编辑目标测试</button>
  <button disabled={!view.archivedAccountsData?.[0]} onClick={() => view.openAccountDetail(view.archivedAccountsData[0])}>打开归档账户</button>
</> }));

const accounts = [
  { id: 1, owner: "大宝", name: "银行卡", currency: "USD" },
  { id: 2, owner: "小宝", name: "银行卡", currency: "CNY" },
];
const exported = { 日期: "2026-09-20", 类型: "支出", 方向: "支出", 所属人: "大宝", 账户: "银行卡", 账户ID: "99", 金额: "10", 币种: "USD", 汇率: "7", "商户/来源": "咖啡店", 来源: "manual", 状态: "有效" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
  localStorage.clear();
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  configureBusinessTimezone();
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
  postJson.mockResolvedValueOnce({
    counts: { accounts: 2 },
    current_counts: { accounts: 3 },
    expected_fingerprint: "current-book",
    member_mapping: [{
      source_member_id: 2,
      source_name: "Alice",
      target_name: "Alice",
      action: "create_pending",
    }],
  })
    .mockResolvedValueOnce({ recovery_backup: "before.json" });
  const restored = vi.fn();
  const { container } = render(<BackupDialog onClose={vi.fn()} onRestored={restored} onDownload={vi.fn()} />);
  const file = new File(["{}"], "saved.json", { type: "application/json" });
  file.text = async () => JSON.stringify(backup);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  const restoreButton = await screen.findByRole("button", { name: "确认恢复" });
  expect(screen.getByText("恢复时新建待登录成员")).toBeTruthy();
  expect(restoreButton.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(restoreButton);
  await waitFor(() => expect(restored).toHaveBeenCalled());
  expect(postJson).toHaveBeenLastCalledWith(
    "/warehouse/restore",
    { backup, expected_fingerprint: "current-book", confirm_replace: true },
    expect.objectContaining({ submission: expect.any(Object) }),
  );
  expect(screen.getByRole("button", { name: "下载恢复前的数据副本" })).toBeTruthy();
});

it("stores the replacement token before refreshing identity after a password change", async () => {
  localStorage.setItem("investAuthToken", "old-token");
  postJson.mockResolvedValue({ message: "密码已更新", access_token: "new-token" });
  const onChanged = vi.fn(() => {
    expect(localStorage.getItem("investAuthToken")).toBe("new-token");
  });
  render(<FamilyDialog family={{
    id: 1,
    name: "冠池家庭",
    can_manage: false,
    members: [{ id: 1, display_name: "大宝", role: "member", login_enabled: true, username: "dabao", account_count: 1, is_current: true }],
  }} onClose={vi.fn()} onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-pass" } });
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-pass-123" } });
  fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(postJson).toHaveBeenCalledWith("/auth/password", {
    current_password: "old-pass",
    new_password: "new-pass-123",
  });
});

it("keeps a committed member update terminal when the follow-up refresh fails", async () => {
  patchJson.mockResolvedValue({ message: "家庭成员已更新" });
  const onChanged = vi.fn().mockRejectedValue(new Error("GET unavailable"));
  render(<FamilyDialog family={{
    id: 1,
    name: "冠池家庭",
    role: "owner",
    can_manage: true,
    members: [{
      id: 2,
      user_id: 2,
      display_name: "小宝",
      role: "member",
      username: "xiaobao",
      login_enabled: true,
      is_current: false,
      account_count: 0,
    }],
  }} onClose={vi.fn()} onChanged={onChanged} />);

  fireEvent.click(screen.getByRole("button", { name: "管理小宝" }));
  const editor = document.querySelector(".family-member-editor");
  fireEvent.change(within(editor).getByLabelText("成员名称"), {
    target: { value: "小宝新名" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "保存成员" }));

  await waitFor(() => expect(patchJson).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(document.querySelector(".family-member-editor")).toBeNull());
  expect(screen.getByRole("status").textContent).toContain("已保存，数据刷新失败");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

function mockBook({
  archivedAccounts = [],
  businessTimezone = "Asia/Shanghai",
  dataScope = "family",
  storedToken = true,
} = {}) {
  if (storedToken) localStorage.setItem("investAuthToken", "isolated-test");
  if (dataScope) {
    localStorage.setItem("investDataScope", dataScope);
    localStorage.setItem("investDataScopeVersion", "2");
  }
  fetchJson.mockImplementation(async (path) => {
    if (path === "/auth/session") return {
      user: { id: 1, username: "dabao", display_name: "大宝" },
      family: { id: 1, name: "冠池家庭", role: "owner", member_id: 1 },
      scope: dataScope || "personal",
      business_timezone: businessTimezone,
    };
    if (path === "/family") return {
      id: 1, name: "冠池家庭", role: "owner", current_member_id: 1, can_manage: true,
      members: [
        { id: 1, user_id: 1, display_name: "大宝", role: "owner", username: "dabao", login_enabled: true, is_current: true, account_count: 1 },
        { id: 2, user_id: 2, display_name: "小宝", role: "member", username: "xiaobao", login_enabled: true, is_current: false, account_count: 0 },
      ],
    };
    if (path.startsWith("/budgets/monthly")) return {
      id: 1,
      items: [{
        id: 1,
        category_id: 1,
        can_edit: true,
        name: "餐饮",
        budget: 500,
        family_budget: 500,
        used: 0,
        member_allocations: [
          { member_id: 1, member_name: "大宝", amount: 500 },
          { member_id: 2, member_name: "小宝", amount: 0 },
        ],
      }],
      allocations: [
        { id: 1, member_id: 1, member_name: "大宝", amount: 500, used: 0, left: 500, percent: 100 },
        { id: 2, member_id: 2, member_name: "小宝", amount: 0, used: 0, left: 0, percent: 0 },
      ],
      member_count: 1,
      category_count: 1,
      family_total_budget: 500,
      total_budget: 500,
    };
    if (path === "/accounts/overview") return { accounts: [{ id: 1, member_id: 1, can_edit: true, name: "投资账户", owner: "大宝", type: "investment", currency: "CNY", balance: 1000 }], distribution: [] };
    if (path === "/accounts/archived") return archivedAccounts;
    if (path.startsWith("/accounts/")) {
      const account = archivedAccounts.find((item) => path === `/accounts/${item.id}`);
      if (account) return { account, transactions: [{ id: 10, amount: 100, direction: "income", occurred_at: "2026-08-01" }], holdings: [], trades: [], activity: [] };
    }
    if (path.startsWith("/ledger/monthly-overview?")) return {
      month: "2026-09",
      previous_month: "2026-08",
      base_currency: "CNY",
      summary: {
        income: 1000,
        expense: 600,
        balance: 400,
        previous_balance: -50,
      },
      directions: {
        expense: {
          total: 600,
          daily_average: 20,
          count: 3,
          highest_day: { date: "2026-09-10", amount: 500, count: 2 },
          daily: Array.from({ length: 30 }, (_, index) => ({
            date: `2026-09-${String(index + 1).padStart(2, "0")}`,
            amount: index === 9 ? 500 : index === 19 ? 100 : 0,
            count: index === 9 ? 2 : index === 19 ? 1 : 0,
          })),
          categories: [
            { id: 1, category_id: 1, name: "餐饮", icon: "🍜", color: "#214f3b", amount: 400, percent: 66.7, count: 2 },
            { id: 2, category_id: 2, name: "交通", icon: "🚇", color: "#78a88a", amount: 200, percent: 33.3, count: 1 },
          ],
        },
        income: {
          total: 1000,
          daily_average: 33.33,
          count: 1,
          highest_day: { date: "2026-09-05", amount: 1000, count: 1 },
          daily: Array.from({ length: 30 }, (_, index) => ({
            date: `2026-09-${String(index + 1).padStart(2, "0")}`,
            amount: index === 4 ? 1000 : 0,
            count: index === 4 ? 1 : 0,
          })),
          categories: [
            { id: 9, category_id: 9, name: "工资", icon: "💼", color: "#4f7ea3", amount: 1000, percent: 100, count: 1 },
          ],
        },
      },
    };
    if (path.startsWith("/ledger?")) return { items: [], page: 1, page_size: 30, total: 0, summary: { income: 0, expense: 0, other: 0, voided: 0 } };
    if (path.startsWith("/investments/trades?")) return { items: [], page: 1, page_size: 50, total: 0 };
    if (path === "/categories") return [
      { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#214f3b" },
      { id: 2, name: "交通", type: "expense", icon: "🚇", color: "#78a88a" },
    ];
    if (["/holdings", "/ledger", "/investments/trades"].includes(path) || path.startsWith("/transactions?")) return [];
    return {};
  });
}

it("shows the application preview before login without requesting protected data", async () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "家庭财务总览" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "登录账号", exact: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "游客体验" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "扫码下载 App" }));
  const appDownloadDialog = await screen.findByRole("dialog", { name: "扫码下载 Invest App" });
  expect(within(appDownloadDialog).getByRole("img", {
    name: "Invest Android App 下载二维码",
  }).getAttribute("data-download-url")).toBe(
    "https://ggcmoney.work/downloads/Invest-Android.apk",
  );
  expect(within(appDownloadDialog).getByRole("link", {
    name: "直接下载 APK",
  }).getAttribute("href")).toBe("/downloads/Invest-Android.apk");
  fireEvent.click(within(appDownloadDialog).getByRole("button", { name: "完成" }));
  expect(screen.queryByRole("dialog", { name: "扫码下载 Invest App" })).toBeNull();
  const icpLink = screen.getByRole("link", { name: "京ICP备2026067668号" });
  expect(icpLink.getAttribute("href")).toBe("https://beian.miit.gov.cn/");
  expect(icpLink.getAttribute("target")).toBe("_blank");
  const publicSecurityLink = screen.getByRole("link", {
    name: PUBLIC_SECURITY_RECORD_NUMBER,
  });
  expect(publicSecurityLink.getAttribute("href")).toBe(PUBLIC_SECURITY_RECORD_URL);
  expect(publicSecurityLink.getAttribute("target")).toBe("_blank");
  expect(publicSecurityLink.querySelector("img")?.getAttribute("src"))
    .toBe(PUBLIC_SECURITY_RECORD_ICON);
  expect(screen.queryByLabelText("登录密码")).toBeNull();
  expect(fetchJson).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "账本" }));
  expect(screen.getByRole("heading", { name: "流水明细", level: 1 })).toBeTruthy();
  expect(screen.getByText("账本数据已锁定")).toBeTruthy();
  expect(fetchJson).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "登录账号", exact: true }));
  const loginDialog = screen.getByRole("dialog", { name: "登录账号" });
  expect(loginDialog).toBeTruthy();
  expect(within(loginDialog).getByLabelText("登录账号")).toBeTruthy();
  expect(within(loginDialog).getByLabelText("登录密码")).toBeTruthy();
});

it("enters and exits guest mode without creating an auth token", async () => {
  mockBook({ storedToken: false });
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "游客体验" }));
  expect(await screen.findByText("总览内容")).toBeTruthy();
  expect(screen.getByText("当前为本地示例数据，操作不会写入真实账本")).toBeTruthy();
  expect(localStorage.getItem("investAuthToken")).toBeNull();
  expect(localStorage.getItem("investGuestMode")).toBeTruthy();
  expect(localStorage.getItem("investDataScope")).toBe("family");

  fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
  expect(screen.queryByRole("menuitem", { name: /家庭与成员/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /数据与备份/ })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: /扫码下载 App/ }));
  expect(await screen.findByRole("dialog", { name: "扫码下载 Invest App" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "退出游客模式" }));

  expect(localStorage.getItem("investGuestMode")).toBeNull();
  expect(screen.getByText("账本数据已锁定")).toBeTruthy();
  expect(screen.queryByText("总览内容")).toBeNull();
});

it("loads the private application only after a successful modal login", async () => {
  mockBook({ dataScope: "personal", storedToken: false });
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, access_token: "new-token" }),
  });
  render(<App />);

  expect(fetchJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "登录账号", exact: true }));
  const loginDialog = screen.getByRole("dialog", { name: "登录账号" });
  fireEvent.change(within(loginDialog).getByLabelText("登录账号"), { target: { value: "admin" } });
  fireEvent.change(within(loginDialog).getByLabelText("登录密码"), { target: { value: "strong-password" } });
  fireEvent.click(within(loginDialog).getByRole("button", { name: "登录", exact: true }));

  expect(await screen.findByText("总览内容")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "登录账号" })).toBeNull();
  expect(localStorage.getItem("investAuthToken")).toBe("new-token");
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/auth/session",
    { scope: "personal" },
  ));
});

it("waits for stored-token identity verification before requesting financial data", async () => {
  localStorage.setItem("investAuthToken", "stored-token");
  let resolveSession;
  let resolveFamily;
  fetchJson.mockImplementation((path) => new Promise((resolve) => {
    if (path === "/auth/session") resolveSession = resolve;
    if (path === "/family") resolveFamily = resolve;
  }));
  render(<App />);

  await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
  expect(fetchJson.mock.calls.map(([path]) => path).sort()).toEqual([
    "/auth/session",
    "/family",
  ]);
  expect(screen.getByRole("heading", { name: "家庭财务总览" })).toBeTruthy();

  await act(async () => {
    resolveSession({
      user: { id: 1, username: "admin", display_name: "大宝" },
      family: { id: 1, name: "冠池家庭", role: "owner", member_id: 1 },
      scope: "personal",
      business_timezone: "Asia/Shanghai",
    });
    resolveFamily({
      id: 1,
      name: "冠池家庭",
      role: "owner",
      current_member_id: 1,
      can_manage: true,
      members: [],
    });
  });
  expect(await screen.findByText("总览内容")).toBeTruthy();
});

it("opens a session without a saved preference in personal scope", async () => {
  mockBook({ dataScope: null });
  render(<App />);
  const scopeSwitch = await screen.findByRole("group", { name: "数据范围" });
  expect(within(scopeSwitch).getAllByRole("button").map((button) => button.textContent.trim()))
    .toEqual(["个人", "家庭"]);
  const personalScope = await screen.findByRole("button", { name: "个人" });
  expect(personalScope.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "家庭" }).getAttribute("aria-pressed"))
    .toBe("false");
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/dashboard/summary?month=2026-09&trend_range=12m",
    { scope: "personal" },
  ));
});

it("initializes the selected month from the loaded server calendar", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T16:00:00Z"));
  mockBook({ businessTimezone: "America/Los_Angeles" });
  render(<App />);
  await screen.findByText("2026年9月");
  await waitFor(() => expect(fetchJson.mock.calls.some(([path]) =>
    path.includes("dashboard") && path.includes("month=2026-09"),
  )).toBe(true));
});

it("switches between family and personal scopes and opens family member management", async () => {
  mockBook();
  render(<App />);
  const familyScope = await screen.findByRole("button", { name: "家庭" });
  const personalScope = screen.getByRole("button", { name: "个人" });
  expect(familyScope.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(personalScope);
  expect(localStorage.getItem("investDataScope")).toBe("personal");
  expect(personalScope.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /家庭与成员/ }));
  expect(await screen.findByRole("heading", { name: "家庭与成员" })).toBeTruthy();
  expect(screen.getByText("账号 dabao")).toBeTruthy();
  expect(screen.getByText("账号 xiaobao")).toBeTruthy();
});

it("loads only the data required by the active page", async () => {
  mockBook();
  render(<App />);
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/dashboard/summary?month=2026-09&trend_range=12m",
    { scope: "family" },
  ));
  const initialPaths = fetchJson.mock.calls.map(([path]) => path);
  expect(initialPaths.some((path) => path.startsWith("/transactions?"))).toBe(false);
  expect(initialPaths.some((path) => path.startsWith("/ledger?"))).toBe(false);
  expect(initialPaths.some((path) => path.startsWith("/expenses/analysis"))).toBe(false);

  fetchJson.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/accounts/archived",
    { scope: "family" },
  ));
  expect(fetchJson.mock.calls.map(([path]) => path)).toEqual([
    "/accounts/archived",
  ]);
});

it("changes the global month without touching removed page-local filters", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /2026年9月/ }));
  const dialog = screen.getByRole("dialog", { name: "数据月份" });
  fireEvent.click(within(dialog).getByRole("button", { name: "8月" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "确认选择" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/dashboard/summary?month=2026-08&trend_range=12m",
    { scope: "family" },
  ));
});

it("loads goals immediately after switching from budgets and keeps focus refresh on goals", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "计划" }));
  await waitFor(() => expect(fetchJson.mock.calls.some(
    ([path]) => path.startsWith("/budgets/monthly"),
  )).toBe(true));

  fetchJson.mockClear();
  fireEvent.click(await screen.findByRole("tab", { name: "储蓄目标" }));
  await waitFor(() => expect(fetchJson.mock.calls.some(
    ([path]) => path.startsWith("/goals?"),
  )).toBe(true));
  expect(fetchJson.mock.calls.some(([path]) => path.startsWith("/budgets/monthly"))).toBe(false);

  fetchJson.mockClear();
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(fetchJson.mock.calls.some(
    ([path]) => path.startsWith("/goals?"),
  )).toBe(true));
  expect(fetchJson.mock.calls.some(([path]) => path.startsWith("/budgets/monthly"))).toBe(false);
});

it("creates family totals with one monthly amount per member", async () => {
  mockBook();
  postJson.mockResolvedValue({});
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "计划" }));
  fireEvent.click(await screen.findByRole("button", { name: "设置预算" }));
  fireEvent.change(screen.getByLabelText("月度总预算"), { target: { value: "600" } });
  fireEvent.change(screen.getByLabelText("大宝月度总预算"), { target: { value: "400" } });
  fireEvent.change(screen.getByLabelText("小宝月度总预算"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "保存家庭预算" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/budgets", {
    month: "2026-09",
    total_amount: 600,
    categories: [],
    member_allocations: [
      { member_id: 1, amount: 400 },
      { member_id: 2, amount: 200 },
    ],
  }, expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" })));

  postJson.mockClear();
  fireEvent.click(await screen.findByRole("tab", { name: "储蓄目标" }));
  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "家庭旅行" } });
  fireEvent.change(screen.getByLabelText("家庭目标总额"), { target: { value: "20000" } });
  fireEvent.change(screen.getByLabelText("小宝目标额"), { target: { value: "20000" } });
  fireEvent.click(screen.getByRole("button", { name: "创建家庭目标" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/goals", expect.objectContaining({
    name: "家庭旅行",
    target_amount: 20000,
    allocations: [expect.objectContaining({ member_id: 2, target_amount: 20000 })],
  }), expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" })));
});

it("requests the ledger through the paginated endpoint", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "账本" }));
  const actions = await screen.findByRole("group", { name: "账本操作" });
  expect(within(actions).getAllByRole("button").map((button) => button.textContent.trim()))
    .toEqual(["账本诊断", "转账", "导入账单", "导出流水"]);
  expect(within(actions).getByRole("button", { name: "导入账单" }).tagName)
    .toBe("BUTTON");
  expect(screen.getAllByRole("button", { name: "记一笔" })).toHaveLength(1);
  await waitFor(() => expect(fetchJson.mock.calls.some(
    ([path]) => path.startsWith("/ledger?page=1&page_size=30"),
  )).toBe(true));
  expect(fetchJson.mock.calls.some(
    ([path]) => new URL(path, "http://test").searchParams.get("record_scope") === "effective",
  )).toBe(true);
  expect(fetchJson).not.toHaveBeenCalledWith("/ledger");
});

it("loads the monthly overview with scoped filters and drills into a category", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "账本" }));
  fireEvent.change(await screen.findByLabelText("搜索流水"), { target: { value: "旧搜索" } });
  fireEvent.click(await screen.findByRole("tab", { name: "月度概览" }));

  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/ledger/monthly-overview?month=2026-09",
    { scope: "family" },
  ));
  expect(await screen.findByRole("heading", { name: "2026年9月" })).toBeTruthy();
  expect(screen.getByText("9月10日")).toBeTruthy();
  expect(screen.getByText("3 笔")).toBeTruthy();
  expect(screen.getByRole("button", { name: "查看餐饮支出流水：¥400，2笔" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "收入" }));
  expect(screen.getByRole("button", { name: "查看工资收入流水：¥1,000，1笔" })).toBeTruthy();
  expect(screen.getByText("9月5日")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "支出" }));
  fireEvent.change(screen.getByLabelText("概览用户"), { target: { value: "大宝" } });
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/ledger/monthly-overview?month=2026-09&owner=%E5%A4%A7%E5%AE%9D",
    { scope: "family" },
  ));
  fireEvent.change(screen.getByLabelText("概览账户"), { target: { value: "1" } });
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/ledger/monthly-overview?month=2026-09&owner=%E5%A4%A7%E5%AE%9D&account_id=1",
    { scope: "family" },
  ));

  fireEvent.click(screen.getByRole("button", { name: "查看餐饮支出流水：¥400，2笔" }));
  expect(screen.getByRole("tab", { name: "流水明细" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(fetchJson.mock.calls.some(([path]) => {
    const url = new URL(path, "http://test");
    return url.pathname === "/ledger"
      && url.searchParams.get("direction") === "expense"
      && url.searchParams.get("category_id") === "1"
      && url.searchParams.get("date_from") === "2026-09-01"
      && url.searchParams.get("date_to") === "2026-09-30"
      && !url.searchParams.get("search");
  })).toBe(true));
});

it("lets a failed monthly overview reload without leaving the current filters", async () => {
  mockBook();
  const loadBook = fetchJson.getMockImplementation();
  let failOverview = true;
  fetchJson.mockImplementation((path, options) => {
    if (path.startsWith("/ledger/monthly-overview?") && failOverview) {
      return Promise.reject(new Error("网络中断"));
    }
    return loadBook(path, options);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "账本" }));
  fireEvent.click(await screen.findByRole("tab", { name: "月度概览" }));
  expect((await screen.findByRole("alert")).textContent).toContain("网络中断");
  failOverview = false;
  fireEvent.click(screen.getByRole("button", { name: "重新加载概览" }));
  expect(await screen.findByRole("button", { name: "查看餐饮支出流水：¥400，2笔" })).toBeTruthy();
});

it("defensively hides audit-only rows and rejects actions for unavailable accounts", () => {
  render(<LedgerPage view={{
    accountOwnerOptions: ["小宝"],
    accountsData: { accounts: [] },
    categoriesData: [],
    dataRevision: 0,
    expenseData: { categories: [], total_expense: 38 },
    incomeData: { categories: [], total_income: 0 },
    formatDateLabel: (date) => date,
    formatMoney: (amount) => `¥${amount}`,
    ledgerData: [
      {
        id: 1, source: "adjustment", direction: "income", account_id: 1,
        account_owner: "小宝", account_name: "支付宝", amount: 8338,
        occurred_at: "2026-09-29",
      },
      {
        id: "transfer:voided", source: "transfer", direction: "transfer",
        from_account_id: 1, from_account_name: "工资卡",
        to_account_id: 2, to_account_name: "支付宝", amount: 500,
        occurred_at: "2026-09-25", voided_at: "2026-09-26",
      },
      {
        id: 2, source: "manual", direction: "expense", account_id: 1,
        account_owner: "小宝", account_name: "支付宝", merchant: "咖啡",
        category_name: "咖啡", amount: 38, occurred_at: "2026-09-22",
      },
    ],
    ledgerAccountFilter: "all",
    ledgerMeta: {
      page: 1,
      page_size: 30,
      total: 3,
      summary: { income: 0, expense: 38, other: 1, voided: 1 },
    },
    ledgerRequest: {},
    loadLedgerPage: vi.fn(),
    setLedgerAccountFilter: vi.fn(),
    setReversalTarget: vi.fn(),
    monthlyExpense: 38,
    monthlyIncome: 0,
    openAction: vi.fn(),
    openEditAction: vi.fn(),
    selectedMonth: "2026-09",
  }} />);

  expect(screen.queryByRole("button", { name: "编辑咖啡" })).toBeNull();
  expect(screen.getByRole("img", { name: "账户已归档或当前身份无权操作" })).toBeTruthy();
  expect(screen.queryByText("余额核对")).toBeNull();
  expect(screen.queryByText("工资卡 → 支付宝")).toBeNull();
});

it("opens an archived account history and restores it before correction", async () => {
  mockBook({ archivedAccounts: [{
    id: 9,
    member_id: 1,
    name: "旧工资卡",
    owner: "大宝",
    type: "debit_card",
    currency: "CNY",
    balance: 0,
    is_active: 0,
    can_edit: false,
    can_restore: true,
    transaction_count: 1,
  }] });
  postJson.mockResolvedValue({ message: "账户已恢复，可继续更正历史账目" });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "资产" }));
  const openArchived = await screen.findByRole("button", { name: "打开归档账户" });
  await waitFor(() => expect(openArchived.disabled).toBe(false));
  fireEvent.click(openArchived);
  expect(await screen.findByRole("heading", { name: "旧工资卡" })).toBeTruthy();
  expect(screen.getByText("归档期间仅可查看历史；恢复后才能更正流水或余额。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "恢复账户" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith(
    "/accounts/9/restore",
    undefined,
    expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" }),
  ));
  expect(alert).toHaveBeenCalledWith("账户已恢复，可继续更正历史账目");
});

it("keeps only the newest paginated response when requests resolve out of order", async () => {
  localStorage.setItem("investDataScope", "family");
  let resolveFirst;
  let resolveSecond;
  fetchJson.mockImplementation((path) => new Promise((resolve) => {
    if (path.includes("search=A")) resolveFirst = resolve;
    if (path.includes("search=B")) resolveSecond = resolve;
  }));
  const { result } = renderHook(() => usePaginatedResource({
    dataScope: "family",
    endpoint: "/ledger",
    pageSize: 30,
    withSummary: true,
  }));

  let firstRequest;
  let secondRequest;
  act(() => {
    firstRequest = result.current.loadPage({ page: 1, search: "A" });
    secondRequest = result.current.loadPage({ page: 1, search: "B" });
  });
  await act(async () => {
    resolveSecond({
      items: [{ id: 2, merchant: "B" }],
      page: 1,
      page_size: 30,
      total: 1,
      summary: { income: 0, expense: 1, other: 0, voided: 0 },
    });
    await secondRequest;
  });
  expect(result.current.items[0].merchant).toBe("B");

  await act(async () => {
    resolveFirst({
      items: [{ id: 1, merchant: "A" }],
      page: 1,
      page_size: 30,
      total: 1,
      summary: { income: 1, expense: 0, other: 0, voided: 0 },
    });
    await firstRequest;
  });
  expect(result.current.items[0].merchant).toBe("B");
  expect(result.current.meta.summary.expense).toBe(1);
});

it("adds source=manual when filtering the paginated ledger by income or expense", async () => {
  const loadLedgerPage = vi.fn();
  render(<LedgerPage view={{
    accountOwnerOptions: ["大宝"],
    accountsData: { accounts: [] },
    categoriesData: [],
    dataRevision: 0,
    expenseData: {},
    incomeData: {},
    formatDateLabel: String,
    formatMoney: String,
    ledgerData: [],
    ledgerAccountFilter: "all",
    ledgerMeta: { page: 1, page_size: 30, total: 0, summary: null },
    loadLedgerPage,
    setLedgerAccountFilter: vi.fn(),
    setReversalTarget: vi.fn(),
    monthlyExpense: 0,
    monthlyIncome: 0,
    openAction: vi.fn(),
    openEditAction: vi.fn(),
    selectedMonth: "2026-09",
  }} />);

  const filterToggle = screen.getByRole("button", { name: "筛选" });
  expect(filterToggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(filterToggle);
  expect(filterToggle.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(loadLedgerPage).toHaveBeenCalledWith(
    expect.objectContaining({
      date_from: "2026-09-01",
      date_to: "2026-09-30",
    }),
  ));
  fireEvent.click(screen.getByRole("button", { name: "日期范围：2026年9月" }));
  fireEvent.click(within(document.querySelector(".date-range-presets")).getByRole("button", { name: /上个月/ }));
  fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
  await waitFor(() => expect(loadLedgerPage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      date_from: "2026-08-01",
      date_to: "2026-08-31",
    }),
  ));
  fireEvent.click(screen.getByRole("button", { name: "移除筛选：日期 · 2026年8月" }));
  await waitFor(() => expect(loadLedgerPage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      date_from: "2026-09-01",
      date_to: "2026-09-30",
    }),
  ));
  fireEvent.change(screen.getByLabelText("流水类型"), { target: { value: "income" } });
  await waitFor(() => expect(loadLedgerPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ direction: "income", source: "manual" }),
  ));
  const incomeChip = screen.getByRole("button", { name: "移除筛选：类型 · 收入" });
  expect(screen.getByRole("button", { name: /收起\s*1/ })).toBeTruthy();
  fireEvent.click(incomeChip);
  await waitFor(() => expect(loadLedgerPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ direction: undefined, source: undefined }),
  ));
  fireEvent.change(screen.getByLabelText("流水类型"), { target: { value: "expense" } });
  await waitFor(() => expect(loadLedgerPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ direction: "expense", source: "manual" }),
  ));
});

it("refreshes identity, accounts and ledger after the owner renames a member", async () => {
  mockBook();
  patchJson.mockResolvedValue({ message: "家庭成员已更新" });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "账本" }));
  await waitFor(() => expect(fetchJson.mock.calls.some(
    ([path]) => path.startsWith("/ledger?"),
  )).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "打开用户菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /家庭与成员/ }));
  fireEvent.click(await screen.findByRole("button", { name: "管理小宝" }));
  const editor = document.querySelector(".family-member-editor");
  fireEvent.change(within(editor).getByLabelText("成员名称"), { target: { value: "小宝新名" } });
  fireEvent.change(within(editor).getByLabelText("重置密码（可选）"), { target: { value: "reset-pass" } });
  fireEvent.click(within(editor).getByRole("checkbox"));
  fetchJson.mockClear();
  fireEvent.click(within(editor).getByRole("button", { name: "保存成员" }));
  await waitFor(() => expect(patchJson).toHaveBeenCalledWith("/family/members/2", {
    display_name: "小宝新名",
    username: "xiaobao",
    password: "reset-pass",
    role: "member",
    login_enabled: false,
  }));
  await waitFor(() => {
    const paths = fetchJson.mock.calls.map(([path]) => path);
    expect(paths).toContain("/family");
    expect(paths).toContain("/accounts/overview");
    expect(paths.some((path) => path.startsWith("/ledger?"))).toBe(true);
  });
});

it("limits administrators to regular member profile changes", async () => {
  patchJson.mockResolvedValue({ message: "家庭成员已更新" });
  render(<FamilyDialog family={{
    id: 1,
    name: "冠池家庭",
    role: "admin",
    can_manage: true,
    members: [
      {
        id: 1, user_id: 1, display_name: "大宝", role: "owner",
        username: "dabao", login_enabled: true, is_current: false, account_count: 1,
      },
      {
        id: 2, user_id: 2, display_name: "管理员", role: "admin",
        username: "manager", login_enabled: true, is_current: true, account_count: 0,
      },
      {
        id: 3, user_id: 3, display_name: "小宝", role: "member",
        username: "xiaobao", login_enabled: true, is_current: false, account_count: 0,
      },
    ],
  }} onClose={vi.fn()} onChanged={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "管理大宝" })).toBeNull();
  expect(screen.queryByRole("button", { name: "管理管理员" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "管理小宝" }));
  const editor = document.querySelector(".family-member-editor");
  expect(within(editor).queryByLabelText("登录账号")).toBeNull();
  expect(within(editor).queryByLabelText("重置密码（可选）")).toBeNull();
  expect(within(editor).queryByLabelText("家庭角色")).toBeNull();
  expect(within(editor).queryByRole("checkbox")).toBeNull();
  fireEvent.change(within(editor).getByLabelText("成员名称"), {
    target: { value: "小宝新名" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "保存成员" }));
  await waitFor(() => expect(patchJson).toHaveBeenCalledWith(
    "/family/members/3",
    { display_name: "小宝新名" },
  ));
  expect(screen.queryByLabelText("家庭角色")).toBeNull();
});

it("keeps the family budget draft through background refresh and submits one balanced plan", async () => {
  mockBook();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  postJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "计划" }));
  fireEvent.click(await screen.findByRole("button", { name: "设置预算" }));
  const totalInput = screen.getByRole("textbox", { name: "月度总预算" });
  const memberInput = screen.getByRole("textbox", { name: "大宝月度总预算" });
  fireEvent.change(totalInput, { target: { value: "800" } });
  fireEvent.change(memberInput, { target: { value: "800" } });
  fireEvent.change(screen.getByRole("textbox", { name: "小宝月度总预算" }), { target: { value: "0" } });
  await act(async () => { vi.advanceTimersByTime(30000); window.dispatchEvent(new Event("focus")); });
  expect(totalInput.value).toBe("800");
  expect(memberInput.value).toBe("800");
  fireEvent.click(screen.getByRole("button", { name: "保存家庭预算" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/budgets", expect.objectContaining({
    total_amount: 800,
    categories: [],
    member_allocations: [
      { member_id: 1, amount: 800 },
      { member_id: 2, amount: 0 },
    ],
  }), expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" })));
});

it("locks a family budget save against duplicate submits", async () => {
  mockBook();
  let resolveSave;
  postJson.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "计划" }));
  fireEvent.click(await screen.findByRole("button", { name: "设置预算" }));
  const saveButton = screen.getByRole("button", { name: "保存家庭预算" });
  fireEvent.click(saveButton);
  fireEvent.click(saveButton);
  await waitFor(() => expect(postJson).toHaveBeenCalledTimes(1));
  await act(async () => resolveSave({}));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "调整家庭预算" })).toBeNull());
  expect(screen.getByRole("button", { name: "设置预算" })).toBeTruthy();
});

it("submits the first buy as one request with a new holding and trade details", async () => {
  mockBook();
  postJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "资产" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/accounts/overview",
    { scope: "family" },
  ));
  fireEvent.click(await screen.findByRole("button", { name: "买入新标的" }));
  fireEvent.change(screen.getByPlaceholderText("例如：贵州茅台 / 沪深300ETF"), { target: { value: "新股" } });
  fireEvent.change(screen.getByPlaceholderText("例如：600519 / 001186 / AAPL"), { target: { value: "NEW" } });
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("成交价格"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("/investments/trades", expect.objectContaining({
    new_holding: expect.objectContaining({ account_id: 1, code: "NEW" }),
    trade_type: "buy", quantity: 10, price: 20,
  }), expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" })));
});

it("keeps backup and logout in the user menu instead of the primary header", async () => {
  mockBook();
  render(<App />);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /数据与备份/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "备份与恢复" })).toBeNull();
  expect(screen.queryByRole("button", { name: "退出" })).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: "打开移动端用户菜单" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /数据与备份/ }));
  expect(screen.getByRole("heading", { name: "备份与恢复" })).toBeTruthy();
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));

  fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
  expect(localStorage.getItem("investAuthToken")).toBeNull();
  expect(screen.getByRole("heading", { name: "家庭财务总览" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "登录账号", exact: true })).toBeTruthy();
  expect(screen.queryByText("总览内容")).toBeNull();
});

it("locks both save buttons while a financial request is pending and allows the next real entry", async () => {
  mockBook();
  let resolve;
  postJson.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/accounts/overview",
    { scope: "family" },
  ));
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

it("closes only the topmost layer when tapping nested modal backdrops", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "记一笔" }));
  expect(screen.getByRole("heading", { name: "记一笔" })).toBeTruthy();

  fireEvent.click(screen.getByLabelText("选择日期"));
  expect(screen.getByRole("heading", { name: "日期" })).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(document.querySelector(".date-picker-layer[data-modal-backdrop]"));
  expect(screen.queryByRole("heading", { name: "日期" })).toBeNull();
  expect(screen.getByRole("heading", { name: "记一笔" })).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");

  fireEvent.click(document.querySelector(".modal-backdrop[data-modal-backdrop]"));
  expect(screen.queryByRole("heading", { name: "记一笔" })).toBeNull();
  expect(document.body.style.overflow).toBe("");
});

it("keeps the transaction draft when dismissing the in-app category picker", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "记一笔" }));
  fireEvent.change(screen.getByLabelText("金额"), { target: { value: "88" } });

  expect(screen.queryByRole("combobox", { name: "分类" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "选择分类" }));
  expect(screen.getByRole("dialog", { name: "选择分类" })).toBeTruthy();

  fireEvent.click(document.querySelector(".category-picker-layer[data-modal-backdrop]"));
  expect(screen.queryByRole("dialog", { name: "选择分类" })).toBeNull();
  expect(screen.getByRole("heading", { name: "记一笔" })).toBeTruthy();
  expect(screen.getByLabelText("金额").value).toBe("88");

  fireEvent.click(screen.getByRole("button", { name: "选择分类" }));
  fireEvent.click(await screen.findByRole("option", { name: "餐饮" }));
  expect(screen.queryByRole("dialog", { name: "选择分类" })).toBeNull();
  expect(screen.getByRole("button", { name: "分类：餐饮" })).toBeTruthy();
  expect(screen.getByLabelText("金额").value).toBe("88");
});

it("prefills foreign card debt in original currency and recalculates after changing the paying account", async () => {
  mockBook();
  const defaultFetch = fetchJson.getMockImplementation();
  fetchJson.mockImplementation(async (path) => path === "/accounts/overview" ? { accounts: [
    { id: 4, owner: "小宝", name: "人民币储蓄", type: "debit_card", currency: "CNY", balance: 1000, original_balance: 1000, can_edit: true },
    { id: 5, owner: "大宝", name: "只读储蓄", type: "debit_card", currency: "USD", exchange_rate_to_base: 8, balance: 8000, original_balance: 1000, can_edit: false },
    { id: 1, owner: "大宝", name: "美元储蓄", type: "debit_card", currency: "USD", exchange_rate_to_base: 8, balance: 8000, original_balance: 1000, can_edit: true },
    { id: 2, owner: "大宝", name: "美元信用卡", type: "credit_card", is_liability: 1, currency: "USD", exchange_rate_to_base: 7, balance: 700, original_balance: 100 },
    { id: 3, owner: "大宝", name: "人民币储蓄", type: "debit_card", currency: "CNY", balance: 1000, original_balance: 1000 },
  ], distribution: [] } : defaultFetch(path));
  postJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  const repaymentButton = await screen.findByRole("button", { name: "还款" });
  await waitFor(() => expect(repaymentButton.disabled).toBe(false));
  fireEvent.click(repaymentButton);
  expect(screen.getByLabelText(/转出账户只展示/).value).toBe("1");
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
  }), expect.objectContaining({ scope: "family", operationIdentity: "1:1:family" })));
});

it("does not submit cached progress or status when editing goal metadata", async () => {
  mockBook();
  patchJson.mockResolvedValue({});
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑目标测试" }));
  fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "新旅行" } });
  fireEvent.click(screen.getByRole("button", { name: "保存目标调整" }));
  await waitFor(() => expect(patchJson).toHaveBeenCalled());
  expect(patchJson.mock.calls[0][1]).not.toHaveProperty("current_amount");
  expect(patchJson.mock.calls[0][1]).not.toHaveProperty("status");
  expect(patchJson.mock.calls[0][1].allocations[0].current_amount).toBeNull();
});

it("shows fee-inclusive original cash and prevents interpreting valuation rates as settlement rates", async () => {
  mockBook();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "资产" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/accounts/overview",
    { scope: "family" },
  ));
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
  const { container } = render(<LedgerPage view={{
    accountOwnerOptions: ["大宝"],
    accountsData: {
      accounts: [{ id: 1, owner: "大宝", name: "工资卡", can_edit: true }],
    },
    categoriesData: [],
    expenseData: {}, incomeData: {}, formatDateLabel: (date) => date, formatMoney: (amount) => `¥${amount}`,
    ledgerData: [...rows, { ...rows[0], id: 32, voided_at: "2026-09-28" }, { ...rows[0], id: 33, source: "opening" }],
    ledgerAccountFilter: "all", setLedgerAccountFilter: vi.fn(),
    monthlyExpense: 9999, monthlyIncome: 10000, selectedMonth: "2026-09",
  }} />);
  const totals = within(screen.getByLabelText("筛选结果合计"));
  expect(totals.getByText("¥2170")).toBeTruthy();
  expect(totals.getByText("¥-2170").className).toBe("negative");
  expect(container.querySelector(".ledger-direction svg")?.classList.contains("lucide-receipt-text")).toBe(true);
  expect(screen.getByRole("button", { name: "编辑消费1" })).toBeTruthy();
  expect(screen.queryByText("消费31")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("消费31")).toBeTruthy();
  expect(totals.getByText("¥2170")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("搜索流水"), { target: { value: "消费31" } });
  expect(totals.getByText("¥70")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
});

it("uses compact semantic actions and keeps budget editing at the family-plan level", () => {
  const noop = vi.fn();
  const { unmount } = render(<AccountsPage view={{
    formatMoney: (amount) => `¥${amount}`,
    accountsData: { asset_total: 0, liability_total: 100, net_worth: -100 },
    assetAccountsView: [],
    creditAccountsView: [{
      id: 1, name: "信用卡", owner: "大宝", code: "···· 1234", bill: 100,
      due: "25日",
    }],
    accountOwnerGroups: [],
    openEditAction: noop,
    openAccountDetail: noop,
    openRepayment: noop,
    accountDistributionView: [],
  }} />);
  expect(screen.getByText("当前欠款")).toBeTruthy();
  expect(screen.queryByText("状态")).toBeNull();
  expect(screen.queryByText("未接入账单状态")).toBeNull();
  expect(screen.getByRole("button", { name: "还款" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "编辑信用卡" })).toBeTruthy();
  unmount();

  render(<BudgetPage view={{
    formatMoney: (amount) => `¥${amount}`,
    dataScope: "family",
    canManagePlans: true,
    budgetData: { total_budget: 1000, total_used: 700, unbudgeted_expense: 200, left: 300 },
    budgetCategoriesView: [{
      id: 1, name: "餐饮", icon: "🍜", color: "#214f3b", budget: 1000,
      used: 500, status: "50%", statusTone: "success",
    }],
    budgetUsedPercent: 50,
    selectedMonth: "2026-09",
    IconBadge: ({ icon }) => <span>{icon}</span>,
    handleCopyPreviousBudget: noop,
  }} />);
  expect(screen.getAllByText("¥1000").length).toBeGreaterThan(0);
  expect(screen.queryByText("未纳入分类预算的支出 ¥200")).toBeNull();
  expect(screen.getByRole("button", { name: "沿用上月" }).title).toBe("沿用上月的家庭总预算和成员额度");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
});

it("shows family totals and member allocations while keeping personal plans read only", () => {
  const noop = vi.fn();
  const { unmount } = render(<BudgetPage view={{
    formatMoney: (amount) => `¥${amount}`,
    dataScope: "family",
    budgetData: {
      total_budget: 1500, total_used: 300, unbudgeted_expense: 0, left: 1200,
      member_count: 2, category_count: 1,
      allocations: [
        {
          member_id: 1, member_name: "大宝", amount: 1000, used: 100, left: 900, percent: 66.7,
          categories: [{ category_id: 1, name: "餐饮", amount: 1000 }],
        },
        {
          member_id: 2, member_name: "小宝", amount: 500, used: 200, left: 300, percent: 33.3,
          categories: [{ category_id: 2, name: "交通", amount: 500 }],
        },
      ],
    },
    budgetCategoriesView: [
      {
        id: 1, can_edit: false, name: "餐饮", icon: "🍜",
        color: "#214f3b", budget: 1500, used: 300,
      },
    ],
    budgetUsedPercent: 20,
    selectedMonth: "2026-09",
    IconBadge: ({ icon }) => <span>{icon}</span>,
    handleCopyPreviousBudget: noop,
    canManagePlans: false,
  }} />);

  expect(screen.getByText("家庭月度总预算")).toBeTruthy();
  expect(screen.getByText("大宝")).toBeTruthy();
  expect(screen.getByText("小宝")).toBeTruthy();
  expect(screen.getByText("66.7%")).toBeTruthy();
  expect(screen.getByText("占家庭总预算 66.7%")).toBeTruthy();
  expect(screen.getByText("占家庭总预算 33.3%")).toBeTruthy();
  expect(screen.queryByText("餐饮 ¥1000")).toBeNull();
  expect(screen.queryByRole("button", { name: "沿用上月" })).toBeNull();
  unmount();

  render(<GoalsPage view={{
    formatMoney: (amount) => `¥${amount}`,
    dataScope: "family",
    goalsData: { target_total: 1000, current_total: 100, monthly_saving: 50, progress: 10 },
    goalCardsView: [{
      id: 2, can_edit: false, can_contribute: false,
      name: "旅行", icon: "✈️", status: "active",
      target: 1000, current: 100, saved: 100, monthly: 50,
      allocations: [
        { member_id: 1, member_name: "大宝", target_amount: 600, current_amount: 60, monthly_saving: 30 },
        { member_id: 2, member_name: "小宝", target_amount: 400, current_amount: 40, monthly_saving: 20 },
      ],
    }],
    handleGoalStatus: noop,
    openGoalRecord: noop,
    openGoalRecords: noop,
    openEditAction: noop,
    formatMonthLabel: String,
    ChartRangeSwitch: () => null,
    chartRangeOptions: {},
    goalPlanView: [],
  }} />);
  expect(screen.getByText(/目标 ¥1000/)).toBeTruthy();
  expect(screen.getByText("大宝")).toBeTruthy();
  expect(screen.getByText("小宝")).toBeTruthy();
  expect(screen.getByRole("button", { name: "查看记录" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "存入" })).toBeNull();
  expect(screen.queryByRole("button", { name: "旅行更多操作" })).toBeNull();
});

it("lists archived accounts as a low-frequency history entry", () => {
  const openAccountDetail = vi.fn();
  render(<AccountsPage view={{
    formatMoney: String,
    accountsData: { asset_total: 0, liability_total: 0, net_worth: 0 },
    assetAccountsView: [],
    creditAccountsView: [],
    accountOwnerGroups: [],
    accountDistributionView: [],
    archivedAccountsData: [{
      id: 9,
      owner: "大宝",
      name: "旧工资卡",
      type: "debit_card",
      transaction_count: 12,
      trade_count: 0,
    }],
    openEditAction: vi.fn(),
    openAccountDetail,
    openRepayment: vi.fn(),
  }} />);
  const archived = screen.getByRole("button", { name: /大宝 · 旧工资卡.*12 笔流水.*查看历史/ });
  fireEvent.click(archived);
  expect(openAccountDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
});

it("groups goal actions by frequency and keeps lifecycle changes in the more menu", async () => {
  const handleGoalStatus = vi.fn();
  const openGoalRecord = vi.fn();
  const openGoalRecords = vi.fn();
  const openEditAction = vi.fn();
  const goal = {
    target: 1000,
    current: 100,
    saved: 100,
    monthly: 100,
    can_edit: true,
    can_contribute: true,
  };
  render(<GoalsPage view={{
    formatMoney: String, goalsData: {}, goalCardsView: [
      { ...goal, id: 1, name: "进行旅行", status: "active" },
      { ...goal, id: 2, name: "已完成旅行", status: "completed" },
      { ...goal, id: 3, name: "归档旅行", status: "archived" },
    ], handleGoalStatus, openGoalRecord, openGoalRecords, openEditAction,
    formatMonthLabel: String, ChartRangeSwitch: () => null,
    chartRangeOptions: {}, goalPlanView: [],
  }} />);
  expect(screen.getByRole("button", { name: "存入" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "取出" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "查看记录" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "标记完成" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "进行旅行更多操作" }));
  expect(screen.getByRole("menuitem", { name: "编辑目标" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "标记完成" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "归档目标" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: /^已完成/ }));
  expect(screen.queryByRole("button", { name: "存入" })).toBeNull();
  expect(screen.getByText(/已完成旅行/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "恢复" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "已完成旅行更多操作" }));
  expect(screen.queryByRole("menuitem", { name: "标记完成" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "归档目标" })).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: /^已归档/ }));
  expect(screen.queryByRole("menuitem", { name: "归档目标" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "恢复" }));
  await waitFor(() => expect(handleGoalStatus).toHaveBeenCalledWith(
    expect.objectContaining({ id: 3 }),
    "active",
    expect.any(Function),
  ));
});
