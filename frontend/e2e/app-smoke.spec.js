import { expect, test } from "@playwright/test";


const PUBLIC_SECURITY_RECORD_NUMBER = "京公网安备11011302008442号";
const PUBLIC_SECURITY_RECORD_URL =
  "https://beian.mps.gov.cn/#/query/webSearch?code=11011302008442";

const responses = {
  "/auth/session": {
    user: { id: 1, username: "admin", display_name: "大宝" },
    family: { id: 1, name: "测试家庭", role: "owner", member_id: 1 },
    scope: "family",
  },
  "/family": {
    id: 1,
    name: "测试家庭",
    role: "owner",
    current_member_id: 1,
    can_manage: true,
    members: [{
      id: 1,
      display_name: "大宝",
      role: "owner",
      login_enabled: true,
      is_current: true,
    }],
    recent_activity: Array.from({ length: 36 }, (_, index) => ({
      id: index + 1,
      actor_name: "大宝",
      action: "测试操作",
      entity_type: "transaction",
      entity_id: String(index + 1),
      summary: `测试操作记录 ${index + 1}`,
      reason: "用于验证长弹窗滚动",
      created_at: "2026-09-29T20:44:12",
    })),
  },
  "/accounts/overview": {
    asset_total: 1000,
    liability_total: 0,
    net_worth: 1000,
    accounts: [
      {
        id: 1, owner: "小宝", name: "支付宝", type: "wallet",
        currency: "CNY", balance: 500, can_edit: true,
      },
      {
        id: 2, owner: "小宝", name: "投资账户", type: "investment",
        currency: "CNY", balance: 500, can_edit: true,
      },
      {
        id: 7, owner: "大宝", name: "投资账户", type: "investment",
        currency: "CNY", balance: 0, can_edit: true,
      },
    ],
    distribution: [],
  },
  "/dashboard/summary": {
    net_worth: 419511.38,
    monthly_income: 999999999.99,
    monthly_expense: 20,
    monthly_balance: 80,
    savings_rate: 80,
    asset_allocation: [],
    trend: [],
    recent_transactions: [
      {
        id: 201,
        direction: "expense",
        amount: 2778,
        base_amount: 2778,
        occurred_at: "2026-09-07",
        category_name: "服饰",
        merchant: "服饰电商",
        account_owner: "大宝",
        account_name: "招行信用卡",
        icon: "🛍️",
        color: "#b77a22",
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: 202 + index,
        direction: index === 2 ? "income" : "expense",
        amount: 120 + index * 35,
        base_amount: 120 + index * 35,
        occurred_at: `2026-09-0${6 - index}`,
        category_name: index === 2 ? "奖金" : "餐饮",
        merchant: index === 2 ? "项目奖金" : `日常消费 ${index + 1}`,
        account_owner: "大宝",
        account_name: "招行信用卡",
        icon: index === 2 ? "🎁" : "🍜",
        color: index === 2 ? "#176b4d" : "#b77a22",
      })),
    ],
    budget: { total: 100, used: 20, left: 80, used_percent: 20 },
  },
  "/investments/summary": {
    total_value: 98400.85,
    total_profit: 13299.55,
    profit_rate: 15.6,
    cash_available: 0,
    cash_accounts: [{
      id: 7,
      owner: "大宝",
      name: "投资账户",
      cash_available: 0,
      can_edit: true,
    }],
    allocation: [
      { name: "fund", value: 42607.57, percent: 43.3 },
      { name: "stock", value: 22730.60, percent: 23.1 },
      { name: "bond", value: 20270.58, percent: 20.6 },
      { name: "gold", value: 12792.10, percent: 13.0 },
    ],
    holdings: [{
      id: 301,
      name: "易方达蓝筹精选",
      code: "005827",
      asset_type: "fund",
      buy_price: 2.15,
      current_price: 2.486,
      quantity: 39582,
      market_value: 98400.85,
      profit: 13299.55,
      profit_rate: 15.6,
      account_id: 7,
      account_owner: "大宝",
      account_name: "投资账户",
      included_in_totals: 1,
      can_edit: true,
    }],
    trend: [],
  },
  "/goals": {
    target_total: 0,
    current_total: 0,
    monthly_saving: 0,
    progress: 0,
    goals: [],
    plan: [],
  },
  "/categories": [],
  "/income/analysis": { total_income: 100, categories: [], trend: [] },
  "/expenses/analysis": { total_expense: 20, categories: [], cashflow: [] },
  "/ledger/monthly-overview": {
    month: "2026-10",
    previous_month: "2026-09",
    base_currency: "CNY",
    summary: {
      income: 12600,
      expense: 5502,
      balance: 7098,
      previous_balance: -7967.5,
    },
    directions: {
      expense: {
        total: 5502,
        daily_average: 177.48,
        count: 51,
        highest_day: { date: "2026-10-17", amount: 1482, count: 4 },
        daily: Array.from({ length: 31 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          amount: index === 16 ? 1482 : index < 20 ? (index % 4) * 95 : 0,
          count: index === 16 ? 4 : index < 20 ? 1 : 0,
        })),
        categories: [
          { id: 1, category_id: 1, name: "餐饮", icon: "🍜", color: "#c45d52", amount: 2005, percent: 36.4, count: 24 },
          { id: 2, category_id: 2, name: "日用", icon: "🧻", color: "#d8a54c", amount: 1086, percent: 19.7, count: 9 },
          { id: 3, category_id: 3, name: "服饰", icon: "👕", color: "#5f927c", amount: 951, percent: 17.3, count: 5 },
          { id: 6, category_id: 6, name: "旅行", icon: "✈️", color: "#38879a", amount: 655, percent: 11.9, count: 9 },
          { id: 4, category_id: 4, name: "通讯", icon: "☎️", color: "#4f7ea3", amount: 450, percent: 8.2, count: 1 },
          { id: 5, category_id: 5, name: "家庭", icon: "🏠", color: "#7a6ca8", amount: 355, percent: 6.5, count: 3 },
        ],
      },
      income: {
        total: 12600,
        daily_average: 406.45,
        count: 2,
        highest_day: { date: "2026-10-05", amount: 10000, count: 1 },
        daily: Array.from({ length: 31 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          amount: index === 4 ? 10000 : index === 14 ? 2600 : 0,
          count: index === 4 || index === 14 ? 1 : 0,
        })),
        categories: [
          { id: 9, category_id: 9, name: "工资", icon: "💼", color: "#176b4d", amount: 10000, percent: 79.4, count: 1 },
          { id: 10, category_id: 10, name: "奖金", icon: "🎁", color: "#b77a22", amount: 2600, percent: 20.6, count: 1 },
        ],
      },
    },
  },
};

const ledgerRows = [
  {
    id: 101,
    source: "adjustment",
    direction: "income",
    account_id: 1,
    account_owner: "小宝",
    account_name: "支付宝",
    amount: 8338,
    base_amount: 8338,
    occurred_at: "2026-09-29",
    note: "测试环境余额核对基线",
  },
  {
    id: "transfer:voided",
    reference_id: "voided",
    source: "transfer",
    direction: "transfer",
    from_account_id: 1,
    from_account_owner: "小宝",
    from_account_name: "工资卡",
    to_account_id: 2,
    to_account_owner: "小宝",
    to_account_name: "支付宝",
    amount: 500,
    base_amount: 500,
    occurred_at: "2026-09-25",
    voided_at: "2026-09-26T10:00:00",
    void_reason: "测试转账撤销",
  },
  {
    id: "transfer:active",
    reference_id: "active",
    source: "transfer",
    direction: "transfer",
    from_account_id: 1,
    from_account_owner: "小宝",
    from_account_name: "储蓄卡",
    to_account_id: 2,
    to_account_owner: "小宝",
    to_account_name: "投资账户",
    amount: 1000,
    base_amount: 1000,
    occurred_at: "2026-09-24",
    note: "定投准备",
  },
  {
    id: 102,
    source: "manual",
    direction: "expense",
    account_id: 1,
    account_owner: "小宝",
    account_name: "支付宝",
    category_name: "咖啡",
    merchant: "咖啡",
    amount: 38,
    base_amount: 38,
    balance_applied: 1,
    occurred_at: "2026-09-22",
  },
];


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (new URL(window.location.href).searchParams.has("guestTest")) {
      localStorage.clear();
      return;
    }
    localStorage.setItem("investAuthToken", "e2e-token");
    localStorage.setItem("investDataScope", "family");
    localStorage.setItem("investDataScopeVersion", "2");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api/, "");
    const recordScope = url.searchParams.get("record_scope") || "effective";
    const sourceFilter = url.searchParams.get("source");
    const directionFilter = url.searchParams.get("direction");
    const visibleLedgerRows = ledgerRows.filter((item) => {
      if (sourceFilter && item.source !== sourceFilter) return false;
      if (directionFilter && item.direction !== directionFilter) return false;
      if (recordScope === "all_records") return true;
      if (recordScope === "voided") return Boolean(item.voided_at);
      if (item.voided_at) return false;
      return sourceFilter && ["adjustment", "opening"].includes(sourceFilter)
        ? true
        : !["adjustment", "opening"].includes(item.source);
    });
    const key = Object.keys(responses).find((path) => apiPath === path);
    const body = key
      ? responses[key]
      : apiPath === "/accounts/archived"
        ? []
        : apiPath === "/transactions"
          ? []
          : apiPath === "/ledger"
            ? {
                items: visibleLedgerRows,
                page: 1,
                page_size: 30,
                total: visibleLedgerRows.length,
                summary: {
                  income: 0,
                  expense: visibleLedgerRows.some((item) => item.id === 102) ? 38 : 0,
                  other: visibleLedgerRows.filter((item) => item.source !== "manual" && !item.voided_at).length,
                  voided: visibleLedgerRows.filter((item) => item.voided_at).length,
                },
              }
            : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});


test("loads the dashboard and navigates to the ledger", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "测试家庭财务总览" })).toBeVisible();
  const icpLink = page.getByRole("link", { name: "京ICP备2026067668号" });
  await expect(icpLink).toHaveAttribute("href", "https://beian.miit.gov.cn/");
  await expect(icpLink.locator("svg")).toHaveClass(/site-footer-record-icon/);
  const publicSecurityLink = page.getByRole("link", {
    name: PUBLIC_SECURITY_RECORD_NUMBER,
  });
  await expect(publicSecurityLink).toHaveAttribute("href", PUBLIC_SECURITY_RECORD_URL);
  await expect(publicSecurityLink.locator("img")).toHaveAttribute(
    "src",
    "/beian-police.png",
  );
  const filingLayout = await page.locator(".site-footer-records").evaluate((element) => {
    const linkRects = [...element.querySelectorAll("a")]
      .map((link) => link.getBoundingClientRect());
    const [icpRect, publicSecurityRect] = linkRects;
    const icon = element.querySelector(".site-footer-police-record img");
    const iconRects = [...element.querySelectorAll(".site-footer-record-icon")]
      .map((recordIcon) => recordIcon.getBoundingClientRect());
    const linksOverlap = !(
      icpRect.right <= publicSecurityRect.left
      || publicSecurityRect.right <= icpRect.left
      || icpRect.bottom <= publicSecurityRect.top
      || publicSecurityRect.bottom <= icpRect.top
    );
    return {
      iconLoaded: icon.complete && icon.naturalWidth === 20 && icon.naturalHeight === 20,
      iconsSized: iconRects.every((rect) => rect.width === 20 && rect.height === 20),
      linksOverlap,
      overflows: element.scrollWidth > element.clientWidth,
    };
  });
  expect(filingLayout).toEqual({
    iconLoaded: true,
    iconsSized: true,
    linksOverlap: false,
    overflows: false,
  });
  await expect(
    page.locator(".metric-card").filter({ hasText: "净资产" }).getByText("¥419,511.38"),
  ).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await page.getByRole("button", { name: "账本" }).click();
  await expect(page.getByRole("heading", { name: "流水明细" })).toBeVisible();
  await expect(page.locator("button:visible").filter({ hasText: /^记一笔$/ }).first()).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});

test("runs guest interactions locally without calling the real API", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto("/?guestTest=1");
  apiRequests.length = 0;

  const appDownloadButton = page.getByRole("button", { name: "扫码下载 App" });
  expect(await appDownloadButton.evaluate(
    (button) => button.scrollWidth <= button.clientWidth,
  )).toBe(true);
  await appDownloadButton.click();
  const appDownloadDialog = page.getByRole("dialog", { name: "扫码下载 Invest App" });
  await expect(appDownloadDialog).toBeVisible();
  await expect(appDownloadDialog.getByRole("img", {
    name: "Invest Android App 下载二维码",
  })).toHaveAttribute(
    "data-download-url",
    "https://ggcmoney.work/downloads/Invest-Android.apk",
  );
  await expect(appDownloadDialog.getByRole("link", { name: "直接下载 APK" }))
    .toHaveAttribute("href", "/downloads/Invest-Android.apk");
  const qrLayout = await appDownloadDialog.locator(".app-download-qr").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const dialog = element.closest(".app-download-dialog");
    const footer = dialog.querySelector(".dialog-panel-footer").getBoundingClientRect();
    const actions = dialog.querySelector(".dialog-action-bar").getBoundingClientRect();
    const actionWidths = [...dialog.querySelectorAll(".dialog-action-button")]
      .map((action) => action.getBoundingClientRect().width);
    return {
      width: bounds.width,
      height: bounds.height,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      actionBalance: Math.abs(
        (actions.left - footer.left) - (footer.right - actions.right),
      ),
      actionWidthSpread: Math.max(...actionWidths) - Math.min(...actionWidths),
    };
  });
  expect(Math.abs(qrLayout.width - qrLayout.height)).toBeLessThanOrEqual(1);
  expect(qrLayout.width).toBeLessThan(qrLayout.viewportWidth);
  expect(qrLayout.overflow).toBe(0);
  expect(qrLayout.actionBalance).toBeLessThanOrEqual(1);
  expect(qrLayout.actionWidthSpread).toBeLessThanOrEqual(1);
  await appDownloadDialog.getByRole("button", { name: "完成" }).click();
  await expect(appDownloadDialog).toBeHidden();
  await expect(page.getByRole("link", { name: "京ICP备2026067668号" }))
    .toHaveAttribute("href", "https://beian.miit.gov.cn/");
  await expect(page.getByRole("link", { name: PUBLIC_SECURITY_RECORD_NUMBER }))
    .toHaveAttribute("href", PUBLIC_SECURITY_RECORD_URL);
  const realLedgerButton = page.getByRole("button", { name: "登录真实账本" });
  const realLedgerLayout = await realLedgerButton.evaluate((button) => ({
    fits: button.scrollWidth <= button.clientWidth,
    whiteSpace: getComputedStyle(button).whiteSpace,
    height: button.getBoundingClientRect().height,
  }));
  expect(realLedgerLayout.fits).toBe(true);
  expect(realLedgerLayout.whiteSpace).toBe("nowrap");
  expect(realLedgerLayout.height).toBeLessThanOrEqual(48);
  await page.getByRole("button", { name: "游客体验" }).click();
  await expect(page.getByRole("heading", { name: "游客示例家庭财务总览" })).toBeVisible();
  await expect(page.locator(".member-card .member-copy strong")).toHaveText("小白");
  await expect(page.getByText("当前为本地示例数据，操作不会写入真实账本")).toBeVisible();
  await expect(page.locator(".metric-card").first()).toContainText("¥");
  await expect(page.locator(".dashboard-grid .transaction-list .transaction")).toHaveCount(7);
  await expect(page.getByRole("link", { name: "京ICP备2026067668号" })).toBeVisible();
  await expect(page.getByRole("link", { name: PUBLIC_SECURITY_RECORD_NUMBER })).toBeVisible();
  expect(apiRequests).toEqual([]);

  await page.getByRole("button", { name: "资产" }).click();
  await expect(page.getByRole("button", { name: /工资卡/ })).toBeVisible();
  await page.getByRole("tab", { name: "投资持仓" }).click();
  await expect(page.getByRole("button", { name: "查看沪深300ETF持仓详情" })).toBeVisible();
  await page.getByRole("button", { name: "计划" }).click();
  await expect(page.getByText("家庭月度总预算", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "储蓄目标" }).click();
  await expect(page.getByRole("heading", { name: /应急储备/ })).toBeVisible();
  await page.getByRole("button", { name: "总览" }).click();
  expect(apiRequests).toEqual([]);

  await page.locator(".record-button:visible").first().click();
  const transaction = page.getByRole("dialog", { name: "记一笔" });
  await transaction.getByRole("textbox", { name: "金额" }).fill("66");
  await transaction.getByRole("button", { name: "选择分类" }).click();
  await page.getByRole("option", { name: "餐饮" }).click();
  await transaction.locator("summary", { hasText: "商户与备注" }).click();
  await transaction.getByLabel("商户 / 来源").fill("游客咖啡");
  await transaction.getByRole("button", { name: "完成" }).click();
  await expect(transaction).toBeHidden();

  await page.getByRole("button", { name: "账本" }).click();
  await expect(page.getByText("游客咖啡", { exact: true })).toBeVisible();
  const guestActions = page.getByRole("group", { name: "账本操作" });
  await expect(guestActions.getByRole("button")).toHaveText(["转账", "导出流水"]);
  const guestActionLayout = await guestActions.evaluate((group) => {
    const groupBox = group.getBoundingClientRect();
    const boxes = [...group.querySelectorAll("button")].map(
      (button) => button.getBoundingClientRect(),
    );
    return {
      leftGap: boxes[0].left - groupBox.left,
      rightGap: groupBox.right - boxes.at(-1).right,
      widthSpread: Math.max(...boxes.map((box) => box.width))
        - Math.min(...boxes.map((box) => box.width)),
    };
  });
  expect(Math.abs(guestActionLayout.leftGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(guestActionLayout.rightGap)).toBeLessThanOrEqual(1);
  if (page.viewportSize().width <= 760) {
    expect(guestActionLayout.widthSpread).toBeLessThanOrEqual(1);
  }
  expect(apiRequests).toEqual([]);

  await page.getByRole("button", { name: "退出游客模式" }).click();
  await expect(page.getByText("账本数据已锁定")).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("orders the account primary action before the secondary transfer action", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "资产", exact: true }).click();
  const actions = page.getByRole("group", { name: "账户操作" });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button")).toHaveText(["新增账户", "资金划转"]);
});

test("keeps every three-metric summary consistent across pages and widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [390, 600, 834, 1440];
  const inspectSummary = async (selector, width, name) => {
    const summary = page.locator(selector);
    await expect(summary.locator(".metric-card")).toHaveCount(3);
    await expect(summary.locator(".metric-card").first()).toBeVisible();
    const layout = await summary.evaluate((element) => {
      const cards = [...element.querySelectorAll(".metric-card")];
      const boxes = cards.map((card) => card.getBoundingClientRect());
      return {
        rowCount: new Set(boxes.map((box) => Math.round(box.top))).size,
        widthSpread: Math.max(...boxes.map((box) => box.width))
          - Math.min(...boxes.map((box) => box.width)),
        valuesContained: cards.every((card) => {
          const value = card.querySelector(".metric-value");
          return value.scrollWidth <= value.clientWidth + 1;
        }),
      };
    });
    expect(layout.widthSpread, `${width}px ${name} card widths`).toBeLessThanOrEqual(1);
    expect(layout.valuesContained, `${width}px ${name} value containment`).toBe(true);
    expect(layout.rowCount, `${width}px ${name} rows`).toBe(width < 560 ? 3 : 1);
  };

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");

    await page.getByRole("button", { name: "账本", exact: true }).click();
    await inspectSummary(".ledger-summary", width, "ledger");

    await page.getByRole("button", { name: "资产", exact: true }).click();
    await inspectSummary(".account-summary", width, "accounts");

    await page.getByRole("button", { name: "计划", exact: true }).click();
    await inspectSummary(".budget-summary", width, "budget");
    await page.getByRole("tab", { name: "储蓄目标" }).click();
    await inspectSummary(".goals-summary", width, "goals");

    if (width === 600) {
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("three-metric-summaries-600.png"),
      });
    }
  }
});

test("keeps holdings dense and actionable across intrinsic panel widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 514, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "资产", exact: true }).click();
    await page.getByRole("tab", { name: "投资持仓", exact: true }).click();
    const panel = page.locator(".holdings-overview-panel");
    const row = panel.locator(".investment-row").first();
    await expect(row).toBeVisible();
    await page.waitForTimeout(250);

    const layout = await panel.evaluate((element) => {
      const rowElement = element.querySelector(".investment-row");
      const toolbar = element.querySelector(".holdings-toolbar");
      const toolbarChildren = [...toolbar.children];
      const actionButtons = [...rowElement.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length > 0);
      const summaryTrigger = rowElement.querySelector(".holding-list-summary");
      const directActions = rowElement.querySelector(".row-actions");
      const rowBox = rowElement.getBoundingClientRect();
      const panelBox = element.getBoundingClientRect();
      const toolbarBox = toolbar.getBoundingClientRect();
      const rowStyle = getComputedStyle(rowElement);
      return {
        documentContained: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        panelContained: panelBox.left >= -1 && panelBox.right <= window.innerWidth + 1,
        toolbarContained: toolbarChildren.every((child) => {
          const box = child.getBoundingClientRect();
          return box.left >= toolbarBox.left - 1 && box.right <= toolbarBox.right + 1;
        }),
        rowHeight: rowBox.height,
        rowDisplay: rowStyle.display,
        columnCount: rowStyle.display === "grid"
          ? rowStyle.gridTemplateColumns.split(" ").length
          : 0,
        summaryDisplay: getComputedStyle(summaryTrigger).display,
        directActionDisplay: getComputedStyle(directActions).display,
        actionSize: Math.min(...actionButtons.map((button) => {
          const box = button.getBoundingClientRect();
          return Math.min(box.width, box.height);
        })),
      };
    });

    const desktopTable = width >= 1200;
    expect(layout.documentContained, `${width}px document containment`).toBe(true);
    expect(layout.panelContained, `${width}px holdings panel containment`).toBe(true);
    expect(layout.toolbarContained, `${width}px holdings toolbar containment`).toBe(true);
    expect(layout.rowDisplay, `${width}px holding row mode`).toBe(desktopTable ? "grid" : "block");
    expect(layout.columnCount, `${width}px holdings metric columns`).toBe(desktopTable ? 9 : 0);
    expect(layout.rowHeight, `${width}px holding row density`).toBeLessThanOrEqual(desktopTable ? 64 : 72);
    expect(layout.summaryDisplay, `${width}px holding summary trigger`).toBe(desktopTable ? "none" : "grid");
    expect(layout.directActionDisplay, `${width}px direct holding actions`).toBe(desktopTable ? "flex" : "none");
    expect(layout.actionSize, `${width}px holding action size`).toBeGreaterThanOrEqual(width <= 760 ? 44 : 38);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`holdings-${width}.png`),
    });
  }
});

test("opens a holding detail drawer from the compact list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByRole("tab", { name: "投资持仓", exact: true }).click();

  const trigger = page.getByRole("button", { name: "查看易方达蓝筹精选持仓详情" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "易方达蓝筹精选" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("当前市值", { exact: true })).toBeVisible();
  await expect(dialog.getByText("持仓盈亏", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button")).toContainText(["买入", "卖出", "编辑"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: "买入", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "买入持仓" })).toBeVisible();
});

test("renders allocation as a labeled donut and keeps trade history balanced", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 510, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "资产", exact: true }).click();
    await page.getByRole("tab", { name: "投资持仓", exact: true }).click();
    const allocation = page.locator(".allocation-panel");
    await expect(allocation.locator(".recharts-pie-sector")).toHaveCount(4);
    await expect(allocation.locator(".allocation-pie-label")).toHaveCount(4);
    await expect(allocation.locator(".allocation-legend-row")).toHaveCount(4);

    const layout = await page.evaluate(() => {
      const allocation = document.querySelector(".allocation-panel");
      const donut = allocation.querySelector(".allocation-donut");
      const legend = allocation.querySelector(".allocation-legend");
      const history = document.querySelector(".trade-history-panel");
      const historyHeader = history.querySelector(".trade-history-header");
      const historyFilter = history.querySelector(".trade-history-filter");
      const historySelect = historyFilter.querySelector("select");
      const historyLabel = historyFilter.querySelector("span");
      const box = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, height: value.height };
      };
      const allocationBox = box(allocation);
      const donutBox = box(donut);
      const legendBox = box(legend);
      const historyBox = box(history);
      const headerBox = box(historyHeader);
      const filterBox = box(historyFilter);
      const selectStyle = getComputedStyle(historySelect);
      return {
        documentContained: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        allocationContained: donutBox.left >= allocationBox.left - 1
          && donutBox.right <= allocationBox.right + 1
          && legendBox.left >= allocationBox.left - 1
          && legendBox.right <= allocationBox.right + 1,
        historyContained: filterBox.left >= historyBox.left - 1
          && filterBox.right <= historyBox.right + 1,
        historyHeight: historyBox.height,
        headerHeight: headerBox.height,
        filterHeight: historySelect.getBoundingClientRect().height,
        filterFontSize: Number.parseFloat(selectStyle.fontSize),
        filterRadius: Number.parseFloat(selectStyle.borderRadius),
        labelPosition: getComputedStyle(historyLabel).position,
      };
    });

    expect(layout.documentContained, `${width}px chart document containment`).toBe(true);
    expect(layout.allocationContained, `${width}px donut and legend containment`).toBe(true);
    expect(layout.historyContained, `${width}px trade filter containment`).toBe(true);
    expect(layout.historyHeight, `${width}px empty trade panel density`).toBeLessThanOrEqual(250);
    expect(layout.headerHeight, `${width}px trade header hierarchy`).toBeLessThanOrEqual(100);
    expect(layout.filterHeight, `${width}px trade filter height`).toBeCloseTo(48, 2);
    expect(layout.filterFontSize, `${width}px trade filter font`).toBe(13);
    expect(layout.filterRadius, `${width}px trade filter radius`).toBe(8);
    expect(layout.labelPosition, `${width}px trade filter label`).toBe("absolute");
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`investment-charts-${width}.png`),
    });
  }
});

test("keeps the responsive shell continuous across phone, intermediate and desktop widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 360, 375, 390, 425, 520, 521, 600, 744, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "测试家庭财务总览" })).toBeVisible();
    await expect(page.locator(".summary-grid > .metric-card").first()).toBeVisible();
    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      const workspace = document.querySelector(".workspace");
      const cards = [...document.querySelectorAll(".summary-grid > .metric-card")];
      const recordButton = document.querySelector(".top-actions .record-button");
      const recordIcon = recordButton?.querySelector("svg");
      const recordButtonBox = recordButton?.getBoundingClientRect();
      const recordIconBox = recordIcon?.getBoundingClientRect();
      const metricValues = cards.map((card) => {
        const value = card.querySelector(".metric-value");
        const range = document.createRange();
        range.selectNodeContents(value);
        const cardBox = card.getBoundingClientRect();
        const cardStyles = getComputedStyle(card);
        const textRects = [...range.getClientRects()];
        return {
          contained: textRects.every((rect) => (
            rect.left >= cardBox.left + Number.parseFloat(cardStyles.paddingLeft) - 1
            && rect.right <= cardBox.right - Number.parseFloat(cardStyles.paddingRight) + 1
          )),
          fontSize: Number.parseFloat(getComputedStyle(value).fontSize),
          lineCount: textRects.length,
        };
      });
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        sidebarPosition: getComputedStyle(sidebar).position,
        workspaceWidth: workspace.getBoundingClientRect().width,
        cardsContained: cards.every((card) => {
          const box = card.getBoundingClientRect();
          return box.left >= -1 && box.right <= window.innerWidth + 1;
        }),
        metricValues,
        recordAction: recordButtonBox && recordIconBox ? {
          insideNavigation: recordButtonBox.top >= sidebar.getBoundingClientRect().top
            && recordButtonBox.bottom <= sidebar.getBoundingClientRect().bottom,
          clearOfNavigationItems: [...sidebar.querySelectorAll("nav button")].every((button) => (
            button.getBoundingClientRect().right <= recordButtonBox.left
          )),
          centerDeltaX: (
            recordIconBox.left + recordIconBox.width / 2
            - recordButtonBox.left - recordButtonBox.width / 2
          ),
          centerDeltaY: (
            recordIconBox.top + recordIconBox.height / 2
            - recordButtonBox.top - recordButtonBox.height / 2
          ),
          height: recordButtonBox.height,
          width: recordButtonBox.width,
        } : null,
      };
    });

    expect(layout.documentWidth, `${width}px document overflow`).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.cardsContained, `${width}px summary card containment`).toBe(true);
    expect(
      layout.metricValues.every((value) => value.contained),
      `${width}px metric value containment`,
    ).toBe(true);
    expect(
      layout.metricValues.every((value) => value.lineCount === 1),
      `${width}px metric value line count`,
    ).toBe(true);
    expect(
      Math.min(...layout.metricValues.map((value) => value.fontSize)),
      `${width}px minimum metric font size`,
    ).toBeGreaterThanOrEqual(15);
    if (width <= 760) {
      expect(layout.sidebarPosition, `${width}px mobile navigation`).toBe("fixed");
      expect(layout.workspaceWidth, `${width}px mobile workspace`).toBeGreaterThanOrEqual(width - 1);
      expect(layout.recordAction, `${width}px record action`).not.toBeNull();
      expect(layout.recordAction.insideNavigation, `${width}px action stays in navigation`).toBe(true);
      expect(layout.recordAction.clearOfNavigationItems, `${width}px navigation remains reachable`).toBe(true);
      expect(
        Math.abs(layout.recordAction.centerDeltaX),
        `${width}px horizontal icon centering`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(layout.recordAction.centerDeltaY),
        `${width}px vertical icon centering`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(layout.recordAction.width - layout.recordAction.height),
        `${width}px circular action box`,
      ).toBeLessThanOrEqual(0.5);
    } else {
      expect(layout.sidebarPosition, `${width}px sidebar navigation`).toBe("sticky");
      expect(layout.workspaceWidth, `${width}px desktop workspace`).toBeLessThan(width);
    }
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`dashboard-${width}.png`),
    });
  }
});

test("keeps the desktop dashboard grid filled without stretching compact cards", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [1000, 1180, 1181, 1440, 1920, 2560];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".dashboard-grid .chart-panel")).toBeVisible();
    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      };
      return {
        chart: box(".dashboard-grid .chart-panel"),
        transaction: box(".dashboard-grid .transaction-panel"),
        budget: box(".dashboard-grid .budget-panel"),
        goal: box(".dashboard-grid .goal-panel"),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(layout.documentWidth, `${width}px document overflow`)
      .toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.budget.height, `${width}px budget card height`).toBeLessThan(260);
    if (width >= 1181) {
      expect(Math.abs(layout.chart.top - layout.transaction.top), `${width}px first row`)
        .toBeLessThanOrEqual(1);
      expect(layout.chart.right, `${width}px chart/transaction separation`)
        .toBeLessThanOrEqual(layout.transaction.left);
      expect(Math.abs(layout.chart.left - layout.goal.left), `${width}px primary stack`)
        .toBeLessThanOrEqual(1);
      expect(Math.abs(layout.chart.right - layout.goal.right), `${width}px primary stack width`)
        .toBeLessThanOrEqual(1);
      expect(layout.goal.top - layout.chart.bottom, `${width}px primary stack gap`)
        .toBeCloseTo(14, 0);
      expect(Math.abs(layout.transaction.bottom - layout.goal.bottom), `${width}px dynamic stack alignment`)
        .toBeLessThanOrEqual(1);
      expect(Math.abs(layout.budget.left - layout.chart.left), `${width}px full-width budget start`)
        .toBeLessThanOrEqual(1);
      expect(Math.abs(layout.budget.right - layout.transaction.right), `${width}px full-width budget end`)
        .toBeLessThanOrEqual(1);
      expect(layout.budget.top - layout.goal.bottom, `${width}px budget row gap`)
        .toBeCloseTo(14, 0);
    } else {
      expect(Math.abs(layout.chart.width - layout.transaction.width), `${width}px full rows`)
        .toBeLessThanOrEqual(1);
      expect(layout.transaction.top, `${width}px transaction row order`)
        .toBeGreaterThan(layout.chart.top);
      expect(Math.abs(layout.budget.top - layout.goal.top), `${width}px compact pair`)
        .toBeLessThanOrEqual(1);
      expect(layout.budget.right, `${width}px compact pair separation`)
        .toBeLessThanOrEqual(layout.goal.left);
    }
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`dashboard-grid-${width}.png`),
    });
  }
});

test("keeps recent transaction metadata compact and visually subordinate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 560, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const row = page.locator(".transaction-list .transaction").first();
    await expect(row).toBeVisible();
    await page.waitForTimeout(250);

    const layout = await row.evaluate((element) => {
      const main = element.querySelector(".transaction-main");
      const tail = element.querySelector(".transaction-tail");
      const date = element.querySelector(".transaction-secondary time");
      const rowBox = element.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const tailBox = tail.getBoundingClientRect();
      const dateStyle = getComputedStyle(date);
      return {
        rowHeight: rowBox.height,
        contained: rowBox.left >= -1 && rowBox.right <= window.innerWidth + 1,
        separated: mainBox.right <= tailBox.left + 1,
        role: element.getAttribute("role"),
        dateFontSize: Number.parseFloat(dateStyle.fontSize),
        dateBackground: dateStyle.backgroundColor,
        dateBorderWidth: Number.parseFloat(dateStyle.borderTopWidth),
        nestedButtons: element.querySelectorAll("button").length,
      };
    });

    expect(layout.contained, `${width}px transaction containment`).toBe(true);
    expect(layout.separated, `${width}px transaction column separation`).toBe(true);
    expect(layout.rowHeight, `${width}px transaction density`).toBeLessThanOrEqual(80);
    expect(layout.role, `${width}px whole-row interaction`).toBe("button");
    expect(layout.dateFontSize, `${width}px subordinate date size`).toBeLessThanOrEqual(11);
    expect(layout.dateBackground, `${width}px date background`).toBe("rgba(0, 0, 0, 0)");
    expect(layout.dateBorderWidth, `${width}px date border`).toBe(0);
    expect(layout.nestedButtons, `${width}px duplicate edit actions`).toBe(0);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`dashboard-transactions-${width}.png`),
    });
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "编辑服饰电商" }).click();
  await expect(page.getByRole("dialog", { name: "编辑流水" })).toBeVisible();
});

test("keeps the dashboard budget progress readable at every card width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 510, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const panel = page.locator(".budget-panel");
    const progress = panel.getByRole("progressbar", { name: "本月预算使用进度" });
    await expect(panel).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "20");
    await page.waitForTimeout(250);

    const layout = await panel.evaluate((element) => {
      const footer = element.querySelector(".budget-footer");
      const [used, remaining] = footer.children;
      const pill = element.querySelector(".status-pill");
      const progressTrack = element.querySelector(".budget-track");
      const panelBox = element.getBoundingClientRect();
      const usedBox = used.getBoundingClientRect();
      const remainingBox = remaining.getBoundingClientRect();
      const pillBox = pill.getBoundingClientRect();
      const progressBox = progressTrack.getBoundingClientRect();
      const footerStyle = getComputedStyle(footer);
      return {
        contained: panelBox.left >= -1 && panelBox.right <= window.innerWidth + 1,
        footerDisplay: footerStyle.display,
        footerFontSize: Number.parseFloat(footerStyle.fontSize),
        footerSeparated: usedBox.right <= remainingBox.left + 0.5,
        pillHeight: pillBox.height,
        progressHeight: progressBox.height,
      };
    });

    expect(layout.contained, `${width}px budget card containment`).toBe(true);
    expect(layout.footerDisplay, `${width}px budget footer layout`).toBe("grid");
    expect(layout.footerFontSize, `${width}px budget footer hierarchy`).toBeLessThanOrEqual(11);
    expect(layout.footerSeparated, `${width}px budget footer separation`).toBe(true);
    expect(layout.pillHeight, `${width}px passive status height`).toBeLessThanOrEqual(32);
    expect(layout.progressHeight, `${width}px budget progress height`).toBe(8);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`dashboard-budget-${width}.png`),
    });
  }
});

test("keeps ledger commands consistent without duplicating the primary record action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 520, 744, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "账本", exact: true }).click();
    const actions = page.getByRole("group", { name: "账本操作" });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button")).toHaveText([
      "账本诊断", "转账", "导入账单", "导出流水",
    ]);
    for (const name of ["账本诊断", "导出流水", "导入账单", "转账"]) {
      await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "记一笔", exact: true })).toHaveCount(1);
    const placeholderFits = await page.getByPlaceholder("搜索流水").evaluate((input) => {
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d");
      context.font = style.font;
      const textWidth = context.measureText(input.placeholder).width;
      const available = input.clientWidth
        - Number.parseFloat(style.paddingLeft)
        - Number.parseFloat(style.paddingRight);
      return textWidth <= available + 0.5;
    });
    expect(placeholderFits, `${width}px search placeholder`).toBe(true);

    const layout = await actions.evaluate((group) => {
      const groupBox = group.getBoundingClientRect();
      const buttons = [...group.querySelectorAll("button")];
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      return {
        display: getComputedStyle(group).display,
        documentContained: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        groupContained: groupBox.left >= -1 && groupBox.right <= window.innerWidth + 1,
        equalWidths: Math.max(...boxes.map((box) => box.width))
          - Math.min(...boxes.map((box) => box.width)),
        equalHeights: Math.max(...boxes.map((box) => box.height))
          - Math.min(...boxes.map((box) => box.height)),
        rowCount: new Set(boxes.map((box) => Math.round(box.top))).size,
        labelFits: buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
      };
    });
    expect(layout.documentContained, `${width}px document overflow`).toBe(true);
    expect(layout.groupContained, `${width}px action containment`).toBe(true);
    expect(layout.equalHeights, `${width}px action heights`).toBeLessThanOrEqual(0.5);
    expect(layout.labelFits, `${width}px action text overflow`).toBe(true);
    if (width <= 760) {
      expect(layout.display, `${width}px action layout`).toBe("grid");
      expect(layout.equalWidths, `${width}px action widths`).toBeLessThanOrEqual(0.5);
      expect(layout.rowCount, `${width}px action rows`).toBe(width <= 520 ? 2 : 1);
    }
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`ledger-actions-${width}.png`),
    });
  }
});

test("keeps ledger summaries and rows information-dense", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 520, 559, 560, 600, 744, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "账本", exact: true }).click();
    const panel = page.locator(".ledger-panel");
    const row = panel.locator(".ledger-row").first();
    await expect(row).toBeVisible();

    const layout = await panel.evaluate((element) => {
      const summary = element.querySelector(".ledger-filter-summary");
      const firstRow = element.querySelector(".ledger-row");
      const metricCards = [...document.querySelectorAll(".ledger-summary > .metric-card")];
      const metricBoxes = metricCards.map((card) => card.getBoundingClientRect());
      const summaryBox = summary.getBoundingClientRect();
      const rowBox = firstRow.getBoundingClientRect();
      return {
        documentContained: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        metricRowCount: new Set(metricBoxes.map((box) => Math.round(box.top))).size,
        metricWidthSpread: Math.max(...metricBoxes.map((box) => box.width))
          - Math.min(...metricBoxes.map((box) => box.width)),
        metricValuesContained: metricCards.every((card) => {
          const value = card.querySelector(".metric-value");
          return value.scrollWidth <= value.clientWidth + 1;
        }),
        summaryHeight: summaryBox.height,
        rowHeight: rowBox.height,
        summaryContained: summaryBox.left >= -1 && summaryBox.right <= window.innerWidth + 1,
        rowContained: rowBox.left >= -1 && rowBox.right <= window.innerWidth + 1,
      };
    });

    expect(layout.documentContained, `${width}px ledger document containment`).toBe(true);
    expect(layout.metricWidthSpread, `${width}px ledger metric widths`).toBeLessThanOrEqual(1);
    expect(layout.metricValuesContained, `${width}px ledger metric value containment`).toBe(true);
    expect(layout.metricRowCount, `${width}px ledger metric rows`).toBe(width < 560 ? 3 : 1);
    expect(layout.summaryContained, `${width}px ledger summary containment`).toBe(true);
    expect(layout.rowContained, `${width}px ledger row containment`).toBe(true);
    expect(layout.summaryHeight, `${width}px ledger summary density`).toBeLessThanOrEqual(width <= 760 ? 120 : 80);
    expect(layout.rowHeight, `${width}px ledger row density`).toBeLessThanOrEqual(width <= 760 ? 80 : 64);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`ledger-density-${width}.png`),
    });
  }
});

test("keeps the monthly ledger overview contained across mobile tablet and desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "账本" }).click();
    await page.getByRole("tab", { name: "月度概览" }).click();
    const overview = page.locator(".ledger-overview");
    await expect(overview.getByRole("heading", { name: /2026年10月/ })).toBeVisible();
    await expect(overview.getByText("10月17日")).toBeVisible();
    await expect(overview.getByRole("button", { name: /查看餐饮支出流水/ })).toBeVisible();
    const layout = await overview.evaluate((element) => {
      const elementBox = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll("button, select")];
      const panels = [...element.querySelectorAll(".panel")];
      const rankingRows = [...element.querySelectorAll(".ledger-overview-ranking-list > button")];
      const lineSvg = element.querySelector(".ledger-overview-line svg")?.getBoundingClientRect();
      const donutSvg = element.querySelector(".ledger-overview-donut svg")?.getBoundingClientRect();
      const linePath = element.querySelector(".ledger-overview-line .recharts-line-curve")
        ?.getBoundingClientRect();
      const pieSectors = [...element.querySelectorAll(".ledger-overview-donut .recharts-sector")]
        .map((sector) => sector.getBoundingClientRect());
      const gridColumns = getComputedStyle(
        element.querySelector(".ledger-overview-grid"),
      ).gridTemplateColumns.split(" ").length;
      const topbarTitle = document.querySelector(".topbar h1");
      const titleRange = document.createRange();
      titleRange.selectNodeContents(topbarTitle);
      const topbarTitleBox = topbarTitle.getBoundingClientRect();
      const topActionsBox = document.querySelector(".top-actions").getBoundingClientRect();
      const modeControl = element.querySelector(".ledger-overview-mode");
      const modeControlBox = modeControl.getBoundingClientRect();
      const modeButtons = [...modeControl.querySelectorAll("button")];
      const modeButtonBoxes = modeButtons.map((button) => button.getBoundingClientRect());
      return {
        documentContained: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        overviewContained: elementBox.left >= -0.5
          && elementBox.right <= document.documentElement.clientWidth + 0.5,
        controlsContained: controls.every((control) => {
          const box = control.getBoundingClientRect();
          return box.left >= elementBox.left - 0.5 && box.right <= elementBox.right + 0.5;
        }),
        panelsContained: panels.every((panel) => {
          const box = panel.getBoundingClientRect();
          return box.left >= elementBox.left - 0.5 && box.right <= elementBox.right + 0.5;
        }),
        rankingContained: rankingRows.every((row) => {
          const rowBox = row.getBoundingClientRect();
          const amountBox = row.querySelector(":scope > b").getBoundingClientRect();
          return amountBox.left >= rowBox.left && amountBox.right <= rowBox.right + 0.5;
        }),
        chartsVisible: lineSvg?.width > 100 && lineSvg?.height > 100
          && donutSvg?.width > 100 && donutSvg?.height > 100,
        chartMarksVisible: linePath?.width > 100 && linePath?.height > 5
          && pieSectors.length === 6
          && pieSectors.every((sector) => sector.width > 5 && sector.height > 5),
        topbarTitleLines: new Set(
          [...titleRange.getClientRects()].map((rect) => Math.round(rect.top)),
        ).size,
        actionsAfterTitle: topActionsBox.top >= topbarTitleBox.bottom - 0.5,
        modeColumns: getComputedStyle(modeControl).gridTemplateColumns.split(" ").length,
        modeEqualWidths: Math.abs(modeButtonBoxes[0].width - modeButtonBoxes[1].width),
        modeCoverage: modeButtonBoxes.reduce((sum, box) => sum + box.width, 0)
          / modeControlBox.width,
        modeActiveDistinct: getComputedStyle(modeButtons[0]).backgroundColor
          !== getComputedStyle(modeButtons[1]).backgroundColor,
        gridColumns,
      };
    });
    expect(layout.documentContained, `${width}px document containment`).toBe(true);
    expect(layout.overviewContained, `${width}px overview containment`).toBe(true);
    expect(layout.controlsContained, `${width}px control containment`).toBe(true);
    expect(layout.panelsContained, `${width}px panel containment`).toBe(true);
    expect(layout.rankingContained, `${width}px ranking containment`).toBe(true);
    expect(layout.chartsVisible, `${width}px chart rendering`).toBe(true);
    expect(layout.chartMarksVisible, `${width}px chart marks`).toBe(true);
    expect(layout.topbarTitleLines, `${width}px topbar title lines`).toBe(1);
    expect(layout.modeColumns, `${width}px overview mode columns`).toBe(2);
    expect(layout.modeEqualWidths, `${width}px overview mode widths`).toBeLessThanOrEqual(0.5);
    expect(layout.modeCoverage, `${width}px overview mode coverage`).toBeGreaterThan(0.9);
    expect(layout.modeActiveDistinct, `${width}px overview active mode`).toBe(true);
    if (width <= 900) {
      expect(layout.actionsAfterTitle, `${width}px topbar action row`).toBe(true);
    }
    expect(layout.gridColumns, `${width}px overview columns`).toBe(width > 980 ? 2 : 1);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`ledger-monthly-overview-${width}.png`),
    });
  }
});

test("keeps chart controls aligned within every chart card", async ({ page }) => {
  await page.goto("/");

  const expectAlignedHeader = async (selector) => {
    const header = page.locator(selector);
    const copy = header.locator(":scope > div").first();
    const actions = header.locator(":scope > .chart-title-actions");
    const range = actions.locator(".chart-range-switch");
    const legend = actions.locator(".chart-legend");
    await expect(range).toBeVisible();

    const [headerBox, copyBox, actionsBox, rangeBox] = await Promise.all([
      header.boundingBox(),
      copy.boundingBox(),
      actions.boundingBox(),
      range.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(copyBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(rangeBox).not.toBeNull();
    expect(rangeBox.x).toBeGreaterThanOrEqual(headerBox.x - 1);
    expect(rangeBox.x + rangeBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);

    if (headerBox.width <= 520) {
      expect(Math.abs(actionsBox.x - headerBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(actionsBox.width - headerBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(rangeBox.width - headerBox.width)).toBeLessThanOrEqual(1);
      expect(rangeBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height + 8);
      if (await legend.count()) {
        const legendBox = await legend.boundingBox();
        expect(legendBox.y).toBeGreaterThanOrEqual(rangeBox.y + rangeBox.height + 8);
      }
    }
  };

  await expectAlignedHeader(".chart-panel .chart-panel-title");

  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByRole("tab", { name: "投资持仓", exact: true }).click();
  await expectAlignedHeader(".investment-chart-panel .chart-panel-title");

  await page.getByRole("button", { name: "计划", exact: true }).click();
  await page.getByRole("tab", { name: "储蓄目标", exact: true }).click();
  await expectAlignedHeader(".goal-plan-panel .chart-panel-title");
});

test("keeps all goal status tabs on one balanced row", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Runs the explicit viewport matrix once.");
  const widths = [320, 390, 530, 834, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "计划", exact: true }).click();
    await page.getByRole("tab", { name: "储蓄目标", exact: true }).click();
    const tabs = page.locator(".goal-status-tabs");
    await expect(tabs).toBeVisible();
    const layout = await tabs.evaluate((element) => {
      const container = element.getBoundingClientRect();
      const boxes = [...element.children].map((child) => child.getBoundingClientRect());
      return {
        contained: container.left >= -1 && container.right <= window.innerWidth + 1,
        sameRow: Math.max(...boxes.map((box) => box.top))
          - Math.min(...boxes.map((box) => box.top)),
        equalWidths: Math.max(...boxes.map((box) => box.width))
          - Math.min(...boxes.map((box) => box.width)),
        height: container.height,
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      };
    });

    expect(layout.contained, `${width}px goal tab containment`).toBe(true);
    expect(layout.columns, `${width}px goal tab columns`).toBe(3);
    expect(layout.sameRow, `${width}px goal tab row`).toBeLessThanOrEqual(0.5);
    expect(layout.equalWidths, `${width}px goal tab widths`).toBeLessThanOrEqual(0.5);
    expect(layout.height, `${width}px goal tab density`).toBeLessThanOrEqual(52);
    await tabs.screenshot({ path: testInfo.outputPath(`goal-tabs-${width}.png`) });
  }
});

test("matches ledger record visuals to their available actions", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "账本", exact: true }).click();

  const editExpense = page.getByRole("button", { name: "编辑咖啡" });
  await expect(editExpense).toBeVisible();
  await expect(page.getByText(/筛选结果 · 收支 \d+ 笔 · 划转 1 笔/)).toBeVisible();
  await expect(page.locator(".ledger-row.is-system")).toHaveCount(0);
  await expect(page.locator(".ledger-row.is-voided")).toHaveCount(0);
  const typeFilter = page.getByLabel("流水类型");
  if (!await typeFilter.isVisible()) await page.locator(".compact-filter-toggle:visible").click();
  await typeFilter.selectOption("all_records");

  await expect(page.locator(".ledger-source.tone-system", { hasText: "余额调整" })).toBeVisible();
  await expect(page.getByLabel("余额调整为系统留痕；如需修正，请再次核对余额")).toBeVisible();
  const transferDetail = page.getByRole("button", {
    name: "查看转账详情：储蓄卡 → 投资账户",
  });
  await expect(transferDetail).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await expect(transferDetail.locator(".ledger-transfer-meta-compact"))
      .toHaveText("小宝 · 定投准备");
    await expect(transferDetail.locator(".ledger-transfer-meta-full")).toBeHidden();
  } else {
    await expect(transferDetail.locator(".ledger-transfer-meta-full"))
      .toContainText("小宝 · 储蓄卡 → 小宝 · 投资账户 · 定投准备");
    await expect(transferDetail.locator(".ledger-transfer-meta-compact")).toBeHidden();
  }
  await expect(page.getByRole("button", { name: "撤销储蓄卡 → 投资账户" })).toHaveCount(0);
  await expect(editExpense).toBeVisible();
  await expect(page.getByText("撤销原因：测试转账撤销")).toBeVisible();

  const voidedAmount = page.getByLabel("原金额，已撤销且不计入统计：¥500");
  await expect(voidedAmount).toBeVisible();
  expect(await voidedAmount.evaluate(
    (element) => getComputedStyle(element).textDecorationLine,
  )).toContain("line-through");
  await expect(page.getByRole("button", { name: "撤销工资卡 → 支付宝" })).toHaveCount(0);

  await transferDetail.click();
  const detailDialog = page.getByRole("dialog", { name: "转账详情" });
  await expect(detailDialog.getByText("小宝 · 储蓄卡")).toBeVisible();
  await expect(detailDialog.getByText("小宝 · 投资账户")).toBeVisible();
  await expect(detailDialog.getByText("不计入收入、支出与结余")).toBeVisible();
  await detailDialog.getByRole("button", { name: "撤销转账" }).click();
  const reversalDialog = page.getByRole("dialog", { name: "撤销转账" });
  await expect(reversalDialog).toBeVisible();
  await reversalDialog.getByRole("button", { name: "取消" }).click();

  await editExpense.click();
  await expect(page.getByRole("dialog", { name: "编辑流水" })).toBeVisible();
});


test("keeps the family dialog close button visible after scrolling long content", async ({ page }) => {
  await page.goto("/");
  await page.locator(
    'button[aria-label="打开用户菜单"]:visible, button[aria-label="打开移动端用户菜单"]:visible',
  ).click();
  await page.getByRole("menuitem").filter({ hasText: "家庭与成员" }).click();

  const dialog = page.getByRole("dialog", { name: "家庭与成员" });
  const body = dialog.locator(".dialog-panel-body");
  const close = dialog.getByRole("button", { name: "关闭" });
  await expect(dialog).toBeVisible();
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  expect(await body.evaluate((element) => element.scrollTop > 0)).toBe(true);
  await expect(close).toBeVisible();
  const closeBox = await close.boundingBox();
  const viewport = page.viewportSize();
  expect(closeBox.y).toBeGreaterThanOrEqual(0);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(viewport.height);
  await close.click();
  await expect(dialog).toBeHidden();
});

test("traps and restores focus across nested dialogs", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator(".record-button:visible").first();
  await trigger.click();

  const mainDialog = page.getByRole("dialog", { name: "记一笔" });
  const amount = mainDialog.getByRole("textbox", { name: "金额" });
  await expect(amount).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(mainDialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(mainDialog.getByRole("button", { name: "取消" })).toBeFocused();

  const dateTrigger = mainDialog.getByLabel("选择日期");
  await dateTrigger.click();
  const dateDialog = page.getByRole("dialog", { name: "日期" });
  await expect(dateDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dateDialog).toBeHidden();
  await expect(mainDialog).toBeVisible();
  await expect(dateTrigger).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(mainDialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("uses the App category-first transaction composer and numeric keypad", async ({ page }, testInfo) => {
  await page.route("**/api/family", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...responses["/family"],
        members: [
          {
            id: 1, display_name: "大宝", role: "owner",
            login_enabled: true, is_current: true,
          },
          {
            id: 2, display_name: "小宝", role: "member",
            login_enabled: true, is_current: false,
          },
        ],
      }),
    });
  });
  await page.route("**/api/accounts/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asset_total: 3000,
        liability_total: 0,
        net_worth: 3000,
        distribution: [],
        accounts: [
          {
            id: 11, owner: "大宝", name: "工资卡", type: "debit_card",
            currency: "CNY", balance: 2000, can_edit: true,
          },
          {
            id: 12, owner: "小宝", name: "支付宝", type: "wallet",
            currency: "CNY", balance: 1000, can_edit: true,
          },
        ],
      }),
    });
  });
  await page.route("**/api/categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#176b4d" },
        { id: 2, name: "服饰", type: "expense", icon: "👕", color: "#b77a22" },
        { id: 3, name: "日用", type: "expense", icon: "🧻", color: "#5f927c" },
        { id: 4, name: "交通", type: "expense", icon: "🚇", color: "#4f7ea3" },
        { id: 5, name: "娱乐", type: "expense", icon: "🎬", color: "#c45d52" },
        { id: 6, name: "通讯", type: "expense", icon: "📱", color: "#38879a" },
        { id: 7, name: "服饰", type: "expense", icon: "👕", color: "#7a6ca8" },
        { id: 8, name: "医疗", type: "expense", icon: "💊", color: "#d8a54c" },
        { id: 9, name: "工资", type: "income", icon: "💼", color: "#176b4d" },
      ]),
    });
  });

  await page.goto("/?appPreview=1");
  await page.locator(".record-button:visible").first().click();

  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "支出" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByLabel("记账用户")).toHaveValue("大宝");
  await expect(dialog.getByLabel("记账账户")).toHaveValue("11");
  await dialog.getByRole("button", { name: "餐饮" }).click();
  await expect(dialog.getByRole("button", { name: "餐饮" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "更多信息" }).click();
  await dialog.getByLabel("选择日期").click();
  const dateDialog = page.getByRole("dialog", { name: "日期" });
  await dateDialog.locator(".day-grid button").filter({ hasText: /^7$/ }).click();
  await dateDialog.getByRole("button", { name: "确认选择" }).click();
  await expect(dateDialog).toBeHidden();
  await expect(dialog.getByLabel("选择日期")).toHaveValue("2026年10月7日");
  await expect(dialog.getByRole("button", { name: "将日期设为今天" }))
    .toContainText("今天");
  await dialog.getByRole("button", { name: "将日期设为今天" }).click();

  for (const key of ["1", "2", ".", "3", "4"]) {
    await dialog.getByRole("button", {
      name: key === "." ? "小数点" : `数字 ${key}`,
    }).click();
  }
  await dialog.getByRole("button", { name: "加" }).click();
  await dialog.getByRole("button", { name: "数字 5" }).click();
  await dialog.getByLabel("备注").fill("午餐");
  await dialog.getByLabel("备注").press("Enter");

  const layout = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const categories = getComputedStyle(
      element.querySelector(".app-transaction-category-grid"),
    ).gridTemplateColumns.split(" ").length;
    return {
      top: bounds.top,
      left: bounds.left,
      right: bounds.right,
      bottom: bounds.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      categoryColumns: categories,
      keypadButtons: element.querySelectorAll(".app-transaction-keypad > button").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(layout.top).toBeCloseTo(0, 0);
  expect(layout.left).toBeCloseTo(0, 0);
  expect(layout.right).toBeCloseTo(layout.viewportWidth, 0);
  expect(layout.bottom).toBeCloseTo(layout.viewportHeight, 0);
  expect(layout.categoryColumns).toBe(4);
  expect(layout.keypadButtons).toBe(16);
  expect(layout.overflow).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath(`app-transaction-${testInfo.project.name}.png`),
  });

  const transactionRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/transactions"
      && request.method() === "POST"
  ));
  await dialog.getByRole("button", { name: "完成" }).click();
  const payload = (await transactionRequest).postDataJSON();
  expect(payload).toMatchObject({
    account_id: 11,
    amount: 17.34,
    category_name: "餐饮",
    direction: "expense",
    note: "午餐",
  });
  await expect(dialog).toBeHidden();
});

test("uses App quick transfer entry and full-screen complex forms", async ({ page }, testInfo) => {
  await page.route("**/api/family", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...responses["/family"],
        members: [{
          id: 1, display_name: "大宝", role: "owner",
          login_enabled: true, is_current: true,
        }],
      }),
    });
  });
  await page.route("**/api/accounts/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asset_total: 3000,
        liability_total: 0,
        net_worth: 3000,
        distribution: [],
        accounts: [
          {
            id: 11, owner: "大宝", name: "工资卡", type: "debit_card",
            currency: "CNY", balance: 2000, can_edit: true,
          },
          {
            id: 12, owner: "大宝", name: "支付宝", type: "wallet",
            currency: "CNY", balance: 1000, can_edit: true,
          },
        ],
      }),
    });
  });
  await page.route("**/api/categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#176b4d" },
      ]),
    });
  });
  await page.route("**/api/budgets/monthly*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 701,
        family_total_budget: 500,
        total_budget: 500,
        items: [{
          id: 1,
          category_id: 1,
          name: "餐饮",
          family_budget: 500,
          budget: 500,
          used: 0,
          member_allocations: [{
            member_id: 1,
            member_name: "大宝",
            amount: 500,
          }],
        }],
        allocations: [{
          member_id: 1,
          member_name: "大宝",
          amount: 500,
          used: 0,
          left: 500,
          percent: 100,
        }],
      }),
    });
  });
  await page.route(/\/api\/goals(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        target_total: 20000,
        current_total: 5000,
        monthly_saving: 1000,
        progress: 25,
        plan: [],
        goals: [{
          id: 601,
          name: "应急储备",
          icon: "◎",
          target_amount: 20000,
          current_amount: 5000,
          monthly_saving: 1000,
          status: "active",
          can_contribute: true,
          can_edit: true,
          allocations: [{
            member_id: 1,
            member_name: "大宝",
            target_amount: 20000,
            current_amount: 5000,
            monthly_saving: 1000,
          }],
        }],
      }),
    });
  });

  await page.goto("/?appPreview=1");
  await page.getByRole("button", { name: "账本", exact: true }).click();
  await page.getByRole("button", { name: "转账", exact: true }).click();

  const transferDialog = page.getByRole("dialog", { name: "资金划转" });
  await expect(transferDialog).toBeVisible();
  await expect(transferDialog.getByLabel("转出账户")).toHaveValue("11");
  await expect(transferDialog.getByLabel("转入账户")).toHaveValue("12");
  await expect(transferDialog.getByRole("button", { name: "将日期设为今天" }))
    .toContainText("今天");
  await transferDialog.getByRole("button", { name: "数字 2" }).click();
  await transferDialog.getByRole("button", { name: "数字 5" }).click();

  const transferRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/accounts/transfer"
      && request.method() === "POST"
  ));
  await transferDialog.getByRole("button", { name: "完成" }).click();
  expect((await transferRequest).postDataJSON()).toMatchObject({
    from_account_id: 11,
    to_account_id: 12,
    amount: 25,
    to_amount: 25,
  });
  await expect(transferDialog).toBeHidden();

  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByRole("button", { name: "新增账户" }).click();
  const accountDialog = page.getByRole("dialog", { name: "新增账户" });
  await expect(accountDialog).toBeVisible();
  const layout = await accountDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const footer = element.querySelector(".dialog-panel-footer").getBoundingClientRect();
    return {
      top: bounds.top,
      left: bounds.left,
      right: bounds.right,
      bottom: bounds.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      footerVisible: footer.bottom <= window.innerHeight && footer.top >= 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(layout.top).toBeCloseTo(0, 0);
  expect(layout.left).toBeCloseTo(0, 0);
  expect(layout.right).toBeCloseTo(layout.viewportWidth, 0);
  expect(layout.bottom).toBeCloseTo(layout.viewportHeight, 0);
  expect(layout.footerVisible).toBe(true);
  expect(layout.overflow).toBe(0);
  await expect(accountDialog.getByLabel("当前余额（CNY）")).toHaveAttribute("readonly", "");
  await expect(accountDialog.getByLabel("当前余额（CNY）")).toHaveAttribute("inputmode", "none");
  await accountDialog.getByLabel("账户名称").fill("App 测试账户");
  await accountDialog.getByLabel("当前余额（CNY）").click();
  await accountDialog.getByRole("button", { name: "数字 4" }).click();
  await accountDialog.getByRole("button", { name: "数字 2" }).click();
  await page.screenshot({
    path: testInfo.outputPath(`app-complex-form-${testInfo.project.name}.png`),
  });
  const accountRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/accounts"
      && request.method() === "POST"
  ));
  await accountDialog.getByRole("button", { name: "创建账户" }).click();
  expect((await accountRequest).postDataJSON()).toMatchObject({
    name: "App 测试账户",
    member_id: 1,
    balance: 42,
  });
  await expect(accountDialog).toBeHidden();

  await page.getByRole("button", { name: "计划", exact: true }).click();
  await page.getByRole("button", { name: "设置预算", exact: true }).click();
  const budgetDialog = page.getByRole("dialog", { name: "调整家庭预算" });
  await expect(budgetDialog).toBeVisible();
  await expect(budgetDialog.getByLabel("月度总预算", { exact: true }))
    .toHaveAttribute("readonly", "");
  await expect(budgetDialog.getByText("成员预算已核对", { exact: true }).last()).toBeVisible();
  const budgetLayout = await budgetDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const footer = element.querySelector(".dialog-panel-footer").getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      footerBottom: footer.bottom,
      viewportHeight: window.innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(budgetLayout.top).toBeCloseTo(0, 0);
  expect(budgetLayout.bottom).toBeCloseTo(budgetLayout.viewportHeight, 0);
  expect(budgetLayout.footerBottom).toBeLessThanOrEqual(budgetLayout.viewportHeight);
  expect(budgetLayout.overflow).toBe(0);
  const memberAmount = budgetDialog.getByLabel("大宝月度总预算");
  await memberAmount.click();
  await expect.poll(async () => memberAmount.evaluate((input) => {
    const inputBounds = input.getBoundingClientRect();
    const bodyBounds = input.closest(".dialog-panel-body").getBoundingClientRect();
    return Math.min(
      inputBounds.top - bodyBounds.top,
      bodyBounds.bottom - inputBounds.bottom,
    );
  })).toBeGreaterThanOrEqual(12);
  const scrollReserve = await budgetDialog.evaluate((element) => {
    const body = element.querySelector(".dialog-panel-body");
    const footer = element.querySelector(".dialog-panel-footer");
    return {
      footerHeight: footer.getBoundingClientRect().height,
      measuredFooterHeight: Number.parseFloat(
        element.style.getPropertyValue("--dialog-footer-height"),
      ),
      bodyFits: body.scrollHeight >= body.clientHeight,
    };
  });
  expect(scrollReserve.measuredFooterHeight).toBeCloseTo(scrollReserve.footerHeight, 0);
  expect(scrollReserve.bodyFits).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`app-budget-plan-${testInfo.project.name}.png`),
  });
  const budgetRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/budgets"
      && request.method() === "POST"
  ));
  await budgetDialog.getByRole("button", { name: "保存预算" }).click();
  expect((await budgetRequest).postDataJSON()).toMatchObject({
    total_amount: 500,
    categories: [],
    member_allocations: [{ member_id: 1, amount: 500 }],
  });
  await expect(budgetDialog).toBeHidden();

  await page.getByRole("tab", { name: "储蓄目标" }).click();
  await page.getByRole("button", { name: "创建目标", exact: true }).click();
  const goalPlanDialog = page.getByRole("dialog", { name: "创建家庭目标" });
  await goalPlanDialog.getByLabel("目标名称").fill("App 家庭目标");
  await goalPlanDialog.getByLabel("家庭目标总额").click();
  for (const key of ["1", "0", "0", "0"]) {
    await goalPlanDialog.getByRole("button", { name: `数字 ${key}` }).click();
  }
  await goalPlanDialog.getByLabel("家庭每月计划").click();
  for (const key of ["1", "0", "0"]) {
    await goalPlanDialog.getByRole("button", { name: `数字 ${key}` }).click();
  }
  await goalPlanDialog.getByRole("button", { name: "平均分配目标额" }).click();
  await goalPlanDialog.getByRole("button", { name: "平均分配每月计划" }).click();
  await expect(goalPlanDialog.getByText("分配已核对，可以创建目标", { exact: true }).last())
    .toBeVisible();
  const createGoalRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/goals"
      && request.method() === "POST"
  ));
  await goalPlanDialog.getByRole("button", { name: "创建目标" }).click();
  expect((await createGoalRequest).postDataJSON()).toMatchObject({
    name: "App 家庭目标",
    target_amount: 1000,
    monthly_saving: 100,
    allocations: [{
      member_id: 1,
      target_amount: 1000,
      monthly_saving: 100,
    }],
  });
  await expect(goalPlanDialog).toBeHidden();

  await page.getByRole("button", { name: "存入", exact: true }).first().click();
  const goalDialog = page.getByRole("dialog", { name: "存入目标" });
  await expect(goalDialog).toBeVisible();
  await expect(goalDialog.getByRole("button", { name: "将日期设为今天" }))
    .toContainText("今天");
  await goalDialog.getByRole("button", { name: "数字 3" }).click();
  const goalRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/goals/601/records"
      && request.method() === "POST"
  ));
  await goalDialog.getByRole("button", { name: "存入" }).click();
  expect((await goalRequest).postDataJSON()).toMatchObject({
    amount: 3,
    member_id: 1,
  });
  await expect(goalDialog).toBeHidden();
});

test("keeps two member budget totals clear and editable without category controls", async ({ page }, testInfo) => {
  await page.route("**/api/family", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...responses["/family"],
        members: [
          {
            id: 1, display_name: "大宝", role: "owner",
            login_enabled: true, is_current: true,
          },
          {
            id: 2, display_name: "小宝", role: "member",
            login_enabled: true, is_current: false,
          },
        ],
      }),
    });
  });
  await page.route("**/api/categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 4, name: "交通", type: "expense", icon: "🚇", color: "#4f7ea3" },
      ]),
    });
  });
  await page.route("**/api/budgets/monthly*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 702,
        family_total_budget: 500,
        total_budget: 500,
        items: [{
          id: 4,
          category_id: 4,
          name: "交通",
          family_budget: 500,
          budget: 500,
          used: 0,
          member_allocations: [
            { member_id: 1, member_name: "大宝", amount: 250 },
            { member_id: 2, member_name: "小宝", amount: 250 },
          ],
        }],
        allocations: [],
      }),
    });
  });

  await page.goto("/?appPreview=1");
  await page.getByRole("button", { name: "计划", exact: true }).click();
  await page.getByRole("button", { name: "设置预算", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "调整家庭预算" });
  const firstMember = dialog.getByLabel("大宝月度总预算");
  const secondMember = dialog.getByLabel("小宝月度总预算");
  await expect(firstMember).toHaveValue("250");
  await expect(secondMember).toHaveValue("250");
  await expect(dialog.getByText("成员月度预算", { exact: true })).toBeVisible();
  await expect(dialog.getByText("分类与成员责任", { exact: true })).toHaveCount(0);

  const layout = await firstMember.evaluate((element, secondInput) => {
    const firstBounds = element.closest(".budget-member-allocation-row").getBoundingClientRect();
    const secondBounds = secondInput.closest(".budget-member-allocation-row").getBoundingClientRect();
    return {
      gap: secondBounds.top - firstBounds.bottom,
      contained: firstBounds.left >= 0
        && secondBounds.right <= document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, await secondMember.elementHandle());
  expect(layout.contained).toBe(true);
  expect(layout.gap).toBeGreaterThanOrEqual(8);
  expect(layout.overflow).toBe(0);
  await dialog.screenshot({
    path: testInfo.outputPath(`app-budget-two-members-${testInfo.project.name}.png`),
  });
});

test("keeps the complex entry workspace stable on iPhone 15, SE, and landscape", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "exact viewport matrix runs once");
  const viewports = [
    { name: "iphone-15", width: 393, height: 852 },
    { name: "iphone-se", width: 375, height: 667 },
    { name: "iphone-15-landscape", width: 852, height: 393 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?appPreview=1");
    await page.getByRole("button", { name: "资产", exact: true }).click();
    await page.getByRole("button", { name: "新增账户" }).click();
    const dialog = page.getByRole("dialog", { name: "新增账户" });
    await expect(dialog).toBeVisible();
    const layout = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const body = element.querySelector(".dialog-panel-body").getBoundingClientRect();
      const footer = element.querySelector(".dialog-panel-footer").getBoundingClientRect();
      const keypad = element.querySelector(".app-field-number-keypad").getBoundingClientRect();
      const buttonsFit = [...element.querySelectorAll(".app-field-number-keypad button")]
        .every((button) => button.scrollWidth <= button.clientWidth + 1);
      return {
        bounds: {
          top: bounds.top,
          left: bounds.left,
          right: bounds.right,
          bottom: bounds.bottom,
        },
        bodyHeight: body.height,
        bodyFooterGap: footer.top - body.bottom,
        bodyFooterHorizontalGap: footer.left - body.right,
        footerBottom: footer.bottom,
        keypadHeight: keypad.height,
        buttonsFit,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.bounds.top).toBeCloseTo(0, 0);
    expect(layout.bounds.left).toBeCloseTo(0, 0);
    expect(layout.bounds.right).toBeCloseTo(layout.viewportWidth, 0);
    expect(layout.bounds.bottom).toBeCloseTo(layout.viewportHeight, 0);
    expect(layout.bodyHeight).toBeGreaterThan(70);
    if (viewport.width > viewport.height) {
      expect(layout.bodyFooterHorizontalGap).toBeGreaterThanOrEqual(-1);
    } else {
      expect(layout.bodyFooterGap).toBeGreaterThanOrEqual(-1);
    }
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.keypadHeight).toBeGreaterThan(150);
    expect(layout.buttonsFit).toBe(true);
    expect(layout.overflow).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`app-complex-${viewport.name}.png`),
    });
    await dialog.getByRole("button", { name: "关闭" }).click();
  }
});

test("keeps the category picker compact and dismisses back to the transaction draft", async ({ page }, testInfo) => {
  await page.route("**/api/categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#176b4d" },
        { id: 2, name: "交通", type: "expense", icon: "🚇", color: "#b77a22" },
        { id: 3, name: "工资", type: "income", icon: "💼", color: "#4f7ea3" },
      ]),
    });
  });
  await page.goto("/");
  await page.locator(".record-button:visible").first().click();

  const mainDialog = page.getByRole("dialog", { name: "记一笔" });
  const amount = mainDialog.getByRole("textbox", { name: "金额" });
  await amount.fill("88");
  await mainDialog.getByRole("button", { name: "选择分类" }).click();

  const picker = page.getByRole("dialog", { name: "选择分类" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option", { name: "餐饮" })).toBeVisible();
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector(".category-picker-dialog");
    const backdrop = document.querySelector(".category-picker-layer");
    const dialogBox = dialog.getBoundingClientRect();
    const backdropBox = backdrop.getBoundingClientRect();
    return {
      dialogBottom: dialogBox.bottom,
      dialogHeight: dialogBox.height,
      dialogLeft: dialogBox.left,
      dialogRight: dialogBox.right,
      dialogTop: dialogBox.top,
      backdropHeight: backdropBox.height,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentContained: document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
    };
  });
  expect(layout.documentContained).toBe(true);
  expect(layout.dialogHeight).toBeLessThan(layout.viewportHeight * 0.75);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(23);
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.backdropHeight).toBeCloseTo(layout.viewportHeight, 0);
  if (layout.viewportWidth <= 640) {
    expect(layout.dialogBottom).toBeGreaterThan(layout.viewportHeight - 24);
  }
  await page.screenshot({
    path: testInfo.outputPath(`category-picker-${testInfo.project.name}.png`),
  });

  await page.locator(".category-picker-layer").click({ position: { x: 5, y: 5 } });
  await expect(picker).toBeHidden();
  await expect(mainDialog).toBeVisible();
  await expect(amount).toHaveValue("88");

  await mainDialog.getByRole("button", { name: "选择分类" }).click();
  await picker.getByRole("option", { name: "餐饮" }).click();
  await expect(picker).toBeHidden();
  await expect(mainDialog.getByRole("button", { name: "分类：餐饮" })).toBeVisible();
  await expect(amount).toHaveValue("88");
});


test("uses the date range dialog and sends exact ledger boundaries", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "账本", exact: true }).click();
  const trigger = page.locator(".date-range-filter-trigger");
  await trigger.waitFor({ state: "attached" });
  if (!await trigger.isVisible()) await page.locator(".compact-filter-toggle:visible").click();
  const ordinaryControl = page.locator(".compact-filter-controls select:visible").first();
  expect(await trigger.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(await ordinaryControl.evaluate((element) => getComputedStyle(element).backgroundColor));
  await trigger.click();
  expect(await trigger.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(await ordinaryControl.evaluate((element) => getComputedStyle(element).backgroundColor));

  const dialog = page.getByRole("dialog", { name: "筛选流水日期" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".date-range-presets").getByRole("button", { name: /上个月/ }).click();
  const expected = await dialog.locator(".date-range-current strong").textContent();
  const ledgerRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/ledger"
      && Boolean(url.searchParams.get("date_from"))
      && Boolean(url.searchParams.get("date_to"));
  });
  await dialog.getByRole("button", { name: "应用日期" }).click();

  const url = new URL((await ledgerRequest).url());
  expect(url.searchParams.get("month")).toBeNull();
  expect(url.searchParams.get("date_from").slice(0, 7)).toBe(
    url.searchParams.get("date_to").slice(0, 7),
  );
  await expect(page.getByRole("button", { name: `移除筛选：日期 · ${expected}` })).toBeVisible();
});
