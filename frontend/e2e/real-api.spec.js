import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";


const apiBase = process.env.INVEST_E2E_API_URL;
if (process.env.INVEST_REAL_E2E !== "1" || !apiBase) {
  throw new Error("Run npm run test:e2e:real to start an isolated backend");
}


async function api(page, path, { body, key, method = "GET" } = {}) {
  return page.evaluate(async ({ apiBase, body, key, method, path }) => {
    const token = localStorage.getItem("investAuthToken");
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Data-Scope": localStorage.getItem("investDataScope") || "personal",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }, { apiBase, body, key, method, path });
}


async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "登录账号" });
  await dialog.getByLabel("登录账号").fill("admin");
  await dialog.getByLabel("登录密码").fill("123456");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  const personalScope = page.getByRole("button", { name: "个人", exact: true });
  await expect(personalScope).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "家庭", exact: true }).click();
  await expect(page.getByRole("heading", { name: /财务总览/ })).toBeVisible();
}

const recordButton = (page) => page.getByRole("button", { name: "记一笔", exact: true }).first();

test("monthly overview validates months and matches scoped ledger totals", async ({ page }) => {
  await login(page);
  const month = "2026-09";
  const monthly = await api(page, `/ledger/monthly-overview?month=${month}`);
  const ledger = await api(page, `/ledger?month=${month}&source=manual&page=1&page_size=30`);
  expect(monthly.summary.income).toBe(ledger.summary.income);
  expect(monthly.summary.expense).toBe(ledger.summary.expense);
  expect(monthly.summary.balance).toBeCloseTo(ledger.summary.income - ledger.summary.expense, 2);
  for (const direction of ["income", "expense"]) {
    expect(monthly.directions[direction].daily).toHaveLength(30);
    const categoryTotal = monthly.directions[direction].categories
      .reduce((sum, category) => sum + category.amount, 0);
    expect(categoryTotal).toBeCloseTo(monthly.summary[direction], 2);
  }
  const invalidStatus = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/ledger/monthly-overview?month=2026-13`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("investAuthToken")}` },
    });
    return response.status;
  }, apiBase);
  expect(invalidStatus).toBe(422);
  await page.getByRole("button", { name: "账本", exact: true }).click();
  await page.getByRole("tab", { name: "月度概览" }).click();
  await expect(page.locator(".ledger-overview-balance")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("real browser financial workflow", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await login(page);

  const prefix = `e2e-${testInfo.project.name}-${Date.now()}`;
  let operation = 0;
  const post = (path, body) => api(page, path, {
    body,
    key: `${prefix}-${operation += 1}`,
    method: "POST",
  });
  const cashA = await post("/accounts", {
    name: `${prefix}-现金A`,
    type: "debit_card",
    balance: 2000,
    opening_date: "2026-09-01",
  });
  const cashB = await post("/accounts", {
    name: `${prefix}-现金B`,
    type: "debit_card",
    balance: 0,
    opening_date: "2026-09-01",
  });
  const investment = await post("/accounts", {
    name: `${prefix}-投资`,
    type: "investment",
    balance: 1000,
    opening_date: "2026-09-01",
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: /财务总览/ })).toBeVisible();

  await recordButton(page).click();
  const transactionDialog = page.getByRole("dialog", { name: "记一笔" });
  await transactionDialog.getByLabel("金额").fill("100");
  await transactionDialog.getByLabel("类型").selectOption("expense");
  await transactionDialog.getByLabel("账户").selectOption(String(cashA.id));
  await transactionDialog.getByRole("button", { name: "完成" }).click();
  await expect(transactionDialog).toBeHidden();

  await page.getByRole("button", { name: "账本" }).click();
  await page.getByRole("button", { name: "转账" }).click();
  const transferDialog = page.getByRole("dialog", { name: "资金划转" });
  await transferDialog.locator('select[name="from_account_id"]').selectOption(
    String(cashA.id),
  );
  await transferDialog.locator('select[name="to_account_id"]').selectOption(
    String(cashB.id),
  );
  await transferDialog.getByLabel(/付款金额/).fill("250");
  await transferDialog.getByRole("button", { name: "完成" }).click();
  await expect(transferDialog).toBeHidden();

  const buy = await post("/investments/trades", {
    new_holding: {
      account_id: investment.id,
      name: `${prefix}-标的`,
      code: `E2E${Date.now()}`,
      buy_price: 100,
      current_price: 100,
      quantity: 2,
      asset_type: "stock",
      currency: "CNY",
      exchange_rate_to_base: 1,
    },
    trade_type: "buy",
    quantity: 2,
    price: 100,
    fee: 0,
    occurred_at: "2026-09-29",
  });
  const sell = await post("/investments/trades", {
    holding_id: buy.holding_id,
    trade_type: "sell",
    quantity: 1,
    price: 120,
    fee: 0,
    occurred_at: "2026-09-29",
  });
  await post(
    `/investments/trades/${sell.id}/reverse`,
    { reason: "E2E 撤销卖出" },
  );
  await post(
    `/investments/trades/${buy.id}/reverse`,
    { reason: "E2E 撤销买入" },
  );

  await page.getByRole("button", { name: "个人" }).click();
  await expect(page.getByRole("button", { name: "个人" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "家庭" }).click();
  await expect(page.getByRole("button", { name: "家庭" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const backup = await api(page, "/warehouse/backup");
  const restoredMemberName = `恢复成员-${testInfo.project.name}`;
  const sourceMemberId = 900000 + testInfo.project.name.length;
  backup.members.push({
    source_id: sourceMemberId, member_key: `${prefix}-restored-member`,
    display_name: restoredMemberName, role: "member",
  });
  backup.data.accounts.find((account) => account.id === cashB.id).member_id = sourceMemberId;
  const snapshotId = Math.max(...backup.data.snapshots.map((row) => row.id)) + 1;
  const sourceSnapshot = backup.data.snapshots.find((row) => row.member_id == null);
  backup.data.snapshots = backup.data.snapshots.filter((row) => row.snapshot_date !== "2026-08-01");
  backup.data.snapshots.push(
    { ...sourceSnapshot, id: snapshotId, snapshot_date: "20260801", created_at: "2026-08-01T09:00:00" },
    { ...sourceSnapshot, id: snapshotId + 1, snapshot_date: "2026-08-01", created_at: "2026-08-01T10:00:00" },
  );
  await post("/transactions", {
    account_id: cashA.id,
    amount: 33,
    direction: "expense",
    occurred_at: "2026-09-29",
    merchant: `${prefix}-restore-marker`,
  });
  await page.getByRole("button", { name: /^打开(移动端)?用户菜单$/ }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: /数据与备份/ }).click();
  const backupDialog = page.getByRole("dialog", { name: "备份与恢复" });
  await backupDialog.locator('input[type="file"]').setInputFiles({
    name: "e2e-restore.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(backupDialog.getByText(restoredMemberName, { exact: true }).first()).toBeVisible();
  const compatibility = backupDialog.getByRole("region", { name: "旧快照兼容处理" });
  await expect(compatibility.getByText(new RegExp(`保留 #${snapshotId + 1}`))).toBeVisible();
  await expect(compatibility.getByText(new RegExp(`舍弃 #${snapshotId}（`))).toBeVisible();
  await compatibility.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("snapshot-compatibility.png") });
  await backupDialog.getByRole("checkbox").check();
  const restoreResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/warehouse/restore" && response.request().method() === "POST",
  );
  await backupDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  const response = await restoreResponse;
  expect(response.status()).toBe(200);
  const restored = await response.json();
  const restoreBody = response.request().postDataJSON();
  const restoreKey = response.request().headers()["idempotency-key"];
  expect(restoreKey).toBeTruthy();
  await expect(backupDialog.getByText("备份已恢复", { exact: true })).toBeVisible();
  await expect(backupDialog.getByRole("status")).toHaveCount(0);
  await backupDialog.getByRole("button", { name: "关闭", exact: true }).click();

  // The restore must refresh family identity and remapped account options.
  await page.getByRole("button", { name: "转账", exact: true }).click();
  const newDraft = page.getByRole("dialog", { name: "资金划转" });
  await newDraft.locator('select[name="to_account_owner"]').selectOption(restoredMemberName);
  await newDraft.locator('select[name="to_account_id"]').selectOption(String(restored.id_mapping.accounts[cashB.id]));
  await expect(newDraft.locator('select[name="to_account_id"]')).toHaveValue(String(restored.id_mapping.accounts[cashB.id]));
  await newDraft.getByRole("button", { name: "关闭", exact: true }).click();
  const replayed = await api(page, "/warehouse/restore", {
    body: restoreBody,
    key: restoreKey,
    method: "POST",
  });
  expect(replayed).toEqual(restored);
  const restoredLedger = await api(
    page,
    `/ledger?search=${encodeURIComponent(`${prefix}-restore-marker`)}&page=1&page_size=30`,
  );
  expect(restoredLedger.total).toBe(0);

  const overview = await api(page, "/accounts/overview");
  const accountA = overview.accounts.find((item) => item.id === restored.id_mapping.accounts[cashA.id]);
  const accountB = overview.accounts.find((item) => item.id === restored.id_mapping.accounts[cashB.id]);
  const investmentAccount = overview.accounts.find(
    (item) => item.id === restored.id_mapping.accounts[investment.id],
  );
  expect(accountA.balance).toBe(1650);
  expect(accountB.balance).toBe(250);
  expect(investmentAccount.cash_available).toBe(1000);
});

test("a committed write followed by failed reads cannot submit twice", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const marker = `refresh-failure-${testInfo.project.name}-${Date.now()}`;
  const account = await api(page, "/accounts", {
    method: "POST", key: `${marker}-account`,
    body: { name: marker, type: "debit_card", balance: 1000, opening_date: "2026-09-01" },
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: /财务总览/ })).toBeVisible();
  const messages = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.message());
    await dialog.accept();
  });
  let failReads = false;
  const writes = [];
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).pathname === "/transactions") {
      writes.push(request.headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      failReads = writes.length === 1;
      await route.fulfill({ response });
    } else if (request.method() === "GET" && failReads) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"injected read failure"}' });
    } else {
      await route.continue();
    }
  });

  async function recordExpense() {
    await recordButton(page).click();
    const dialog = page.getByRole("dialog", { name: "记一笔" });
    await dialog.getByLabel("金额").fill("100");
    await dialog.getByLabel("账户").selectOption(String(account.id));
    await dialog.getByText("商户与备注", { exact: true }).click();
    await dialog.locator('input[name="merchant"]').fill(marker);
    await dialog.getByRole("button", { name: "完成" }).click();
    await expect(dialog).toBeHidden();
  }
  await recordExpense();
  await expect.poll(() => messages.some((message) => message.includes("已保存，数据刷新失败"))).toBe(true);
  expect(writes).toHaveLength(1);
  failReads = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeHidden();
  expect(writes).toHaveLength(1);
  let overview = await api(page, "/accounts/overview");
  expect(overview.accounts.find((item) => item.id === account.id).balance).toBe(900);
  let ledger = await api(page, `/ledger?search=${encodeURIComponent(marker)}&source=manual&page=1`);
  expect(ledger.total).toBe(1);

  // A deliberate new intent with identical contents must remain available.
  await recordExpense();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toBeTruthy();
  expect(writes[0]).not.toBe(writes[1]);
  overview = await api(page, "/accounts/overview");
  expect(overview.accounts.find((item) => item.id === account.id).balance).toBe(800);
  ledger = await api(page, `/ledger?search=${encodeURIComponent(marker)}&source=manual&page=1`);
  expect(ledger.total).toBe(2);
});

test("goal complete → switch month after read failure → restore → complete stays actionable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const marker = `goal-cycle-${testInfo.project.name}-${Date.now()}`;
  const family = await api(page, "/family");
  const goal = await api(page, "/goals", {
    method: "POST", key: `${marker}-create`,
    body: {
      name: marker, target_amount: 1000,
      allocations: [{ member_id: family.current_member_id, target_amount: 1000 }],
    },
  });
  await page.getByRole("button", { name: "计划", exact: true }).click();
  await page.getByRole("tab", { name: "储蓄目标", exact: true }).click();
  const card = page.locator(".financial-goal-card").filter({ hasText: marker });
  await expect(card).toBeVisible();
  const messages = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.message());
    await dialog.accept();
  });
  let failReads = false;
  const keys = [];
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && new URL(request.url()).pathname === `/goals/${goal.id}/status`) {
      keys.push(request.headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      failReads = keys.length === 1;
      await route.fulfill({ response });
    } else if (request.method() === "GET" && failReads) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"injected GET failure"}' });
    } else {
      await route.continue();
    }
  });
  async function complete() {
    await card.getByRole("button", { name: `${marker}更多操作` }).click();
    await card.getByRole("menuitem", { name: "标记完成", exact: true }).click();
  }
  await complete();
  await expect.poll(() => messages.some((message) => message.includes("已保存，数据刷新失败"))).toBe(true);
  expect(keys).toHaveLength(1);
  failReads = false;
  const selectedMonthLabel = await page.locator("button.month-pill").innerText();
  const selectedMonthNumber = Number(selectedMonthLabel.match(/(\d+)月/)?.[1]);
  await page.locator("button.month-pill").click();
  const monthDialog = page.getByRole("dialog", { name: "数据月份" });
  if (selectedMonthNumber === 12) {
    await monthDialog.getByRole("button", { name: "下一年" }).click();
  }
  await monthDialog.getByRole("button", {
    name: `${selectedMonthNumber === 12 ? 1 : selectedMonthNumber + 1}月`,
    exact: true,
  }).click();
  await monthDialog.getByRole("button", { name: "确认选择", exact: true }).click();
  await page.getByRole("tab", { name: /^已完成/ }).click();
  await card.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(card).toBeHidden();
  await page.getByRole("tab", { name: /^进行中/ }).click();
  await expect(card).toBeVisible();
  await complete();
  await expect(card).toBeHidden();
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(3);
  const goals = await api(page, "/goals");
  expect(goals.goals.find((item) => item.id === goal.id).status).toBe("completed");
});

test("a delayed old-month goal refresh cannot retain a superseded state intent", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const marker = `goal-delay-${testInfo.project.name}-${Date.now()}`;
  const family = await api(page, "/family");
  const goal = await api(page, "/goals", {
    method: "POST",
    key: `${marker}-create`,
    body: {
      name: marker,
      target_amount: 1000,
      allocations: [{
        member_id: family.current_member_id,
        target_amount: 1000,
      }],
    },
  });
  await page.getByRole("button", { name: "计划", exact: true }).click();
  await page.getByRole("tab", { name: "储蓄目标", exact: true }).click();
  const card = page.locator(".financial-goal-card").filter({ hasText: marker });
  await expect(card).toBeVisible();

  let releaseOldRefresh;
  const oldRefreshGate = new Promise((resolve) => {
    releaseOldRefresh = resolve;
  });
  let oldRefreshHeld = false;
  let releaseUnrelatedRefresh;
  const unrelatedRefreshGate = new Promise((resolve) => { releaseUnrelatedRefresh = resolve; });
  let unrelatedRefreshHeld = false;
  const keys = [];
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "PATCH"
      && url.pathname === `/goals/${goal.id}/status`
    ) {
      keys.push(request.headers()["idempotency-key"]);
      await route.continue();
      return;
    }
    if (
      request.method() === "GET"
      && url.pathname === "/accounts/overview"
      && keys.length === 2
      && !unrelatedRefreshHeld
    ) {
      unrelatedRefreshHeld = true;
      const response = await route.fetch();
      await unrelatedRefreshGate;
      await route.fulfill({ response });
      return;
    }
    if (
      request.method() === "GET"
      && url.pathname === "/goals"
      && keys.length === 1
      && !oldRefreshHeld
    ) {
      oldRefreshHeld = true;
      const response = await route.fetch();
      await oldRefreshGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  async function complete() {
    await card.getByRole("button", { name: `${marker}更多操作` }).click();
    await card.getByRole("menuitem", { name: "标记完成", exact: true }).click();
  }
  await complete();
  await expect.poll(() => oldRefreshHeld).toBe(true);
  expect(keys).toHaveLength(1);

  const selectedMonthLabel = await page.locator("button.month-pill").innerText();
  const selectedMonthNumber = Number(selectedMonthLabel.match(/(\d+)月/)?.[1]);
  await page.locator("button.month-pill").click();
  const monthDialog = page.getByRole("dialog", { name: "数据月份" });
  if (selectedMonthNumber === 12) {
    await monthDialog.getByRole("button", { name: "下一年" }).click();
  }
  await monthDialog.getByRole("button", {
    name: `${selectedMonthNumber === 12 ? 1 : selectedMonthNumber + 1}月`,
    exact: true,
  }).click();
  await monthDialog.getByRole("button", { name: "确认选择", exact: true }).click();

  await page.getByRole("tab", { name: /^已完成/ }).click();
  await card.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("tab", { name: /^进行中/ }).click();
  await expect(card).toBeVisible();
  await expect.poll(() => unrelatedRefreshHeld).toBe(true);
  releaseOldRefresh();
  await complete();
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(3);

  releaseUnrelatedRefresh();
  await expect(card).toBeHidden();
  await page.waitForTimeout(100);
  expect(keys).toHaveLength(3);
  const goals = await api(page, "/goals");
  expect(goals.goals.find((item) => item.id === goal.id).status).toBe("completed");
});

test("legacy application diagnosis requires explicit correction and preserves audit details", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const marker = `legacy-application-${testInfo.project.name}-${Date.now()}`;
  const account = await api(page, "/accounts", {
    method: "POST", key: `${marker}-account`,
    body: { name: marker, type: "debit_card", balance: 100, opening_date: "2026-09-01" },
  });
  const transaction = await api(page, "/transactions", {
    method: "POST", key: `${marker}-expense`,
    body: { account_id: account.id, direction: "expense", amount: 10, occurred_at: "2026-09-28", merchant: marker },
  });
  execFileSync(process.env.INVEST_BACKEND_PYTHON, [
    path.resolve(import.meta.dirname, "../../backend/fixtures/e2e_legacy_application.py"),
    String(account.id), String(transaction.id),
  ], { env: process.env });
  await page.getByRole("button", { name: "账本", exact: true }).click();
  await page.getByRole("button", { name: "账本诊断", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "账本诊断", exact: true });
  const section = dialog.locator(".reconciliation-account").filter({ hasText: marker });
  await expect(section.getByText("需要核对", { exact: true })).toBeVisible();
  await expect(section.getByText("一致", { exact: true })).toBeVisible();
  let overview = await api(page, "/accounts/overview");
  expect(overview.accounts.find((row) => row.id === account.id).balance).toBe(100);
  await section.getByRole("button", { name: `核对并更正流水 #${transaction.id}`, exact: true }).click();
  const confirm = dialog.getByRole("region", { name: "确认余额应用更正" });
  await expect(confirm.getByRole("button", { name: "确认更正", exact: true })).toBeDisabled();
  await confirm.getByLabel("更正原因", { exact: true }).fill("已核对原始银行账单");
  await confirm.getByRole("checkbox").check();
  await confirm.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("application-correction.png") });
  const keys = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(`/transactions/${transaction.id}/application`)) {
      keys.push(request.headers()["idempotency-key"]);
    }
  });
  await confirm.getByRole("button", { name: "确认更正", exact: true }).dblclick();
  await expect(section.getByText("核对正常", { exact: true })).toBeVisible();
  expect(keys).toHaveLength(1);
  overview = await api(page, "/accounts/overview");
  expect(overview.accounts.find((row) => row.id === account.id).balance).toBe(90);
  const bounds = await dialog.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /^打开(移动端)?用户菜单$/ }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: /家庭与成员/ }).click();
  const familyDialog = page.getByRole("dialog", { name: "家庭与成员" });
  const audit = familyDialog.locator(".family-activity-row").filter({ hasText: "更正流水余额应用" }).first();
  await audit.getByText("查看变更详情", { exact: true }).click();
  await expect(audit.getByRole("row", { name: "余额应用（原流水） 未应用 已应用" })).toBeVisible();
  await expect(audit.getByRole("row", { name: "账户余额（关联账户） 100 90" })).toBeVisible();
});

test("nested audit details stay readable inside the family dialog", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const marker = `audit-layout-${testInfo.project.name}-${Date.now()}`;
  const family = await api(page, "/family");
  await api(page, "/goals", {
    method: "POST", key: `${marker}-create`,
    body: {
      name: marker, target_amount: 1000,
      allocations: [{
        member_id: family.current_member_id,
        target_amount: 1000,
      }],
    },
  });
  await page.getByRole("button", { name: /^打开(移动端)?用户菜单$/ })
    .filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: /家庭与成员/ }).click();
  const dialog = page.getByRole("dialog", { name: "家庭与成员" });
  const activity = dialog.locator(".family-activity-row").filter({ hasText: marker });
  await activity.getByText("查看变更详情", { exact: true }).click();
  const table = activity.getByRole("table", { name: "操作变更字段" });
  await expect(table.getByRole("row", { name: "目标金额 — 1000" })).toBeVisible();
  const bounds = await table.evaluate((node) => {
    const tableRect = node.getBoundingClientRect();
    const dialogRect = node.closest('[role="dialog"]').getBoundingClientRect();
    return {
      contained: tableRect.left >= dialogRect.left - 1
        && tableRect.right <= dialogRect.right + 1,
      noHorizontalOverflow: node.scrollWidth <= node.clientWidth + 1,
    };
  });
  expect(bounds).toEqual({ contained: true, noHorizontalOverflow: true });
});
