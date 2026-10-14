import { getGuestSessionId, GUEST_DISPLAY_NAME } from "./mode";

const CURRENT_MEMBER_ID = 9001;
const CURRENT_MEMBER_NAME = GUEST_DISPLAY_NAME;

const clone = (value) => JSON.parse(JSON.stringify(value));
const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const pad = (value) => String(value).padStart(2, "0");

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function monthDate(day) {
  const now = new Date();
  const safeDay = Math.min(day, Math.max(now.getDate(), 1));
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(safeDay)}`;
}

function monthSequence(length) {
  const now = new Date();
  return Array.from({ length }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - length + index + 1, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  });
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

const categories = [
  { id: 1, name: "餐饮", type: "expense", icon: "🍜", color: "#176b4d" },
  { id: 2, name: "交通", type: "expense", icon: "🚇", color: "#b77a22" },
  { id: 3, name: "居住", type: "expense", icon: "🏡", color: "#5f927c" },
  { id: 4, name: "服饰", type: "expense", icon: "👕", color: "#d8a54c" },
  { id: 5, name: "娱乐", type: "expense", icon: "🎬", color: "#c45d52" },
  { id: 6, name: "医疗健康", type: "expense", icon: "💊", color: "#4f7ea3" },
  { id: 7, name: "教育学习", type: "expense", icon: "📚", color: "#7a6ca8" },
  { id: 8, name: "旅行出游", type: "expense", icon: "✈️", color: "#38879a" },
  { id: 9, name: "工资", type: "income", icon: "💼", color: "#176b4d" },
  { id: 10, name: "奖金", type: "income", icon: "🎁", color: "#b77a22" },
  { id: 11, name: "投资收益", type: "income", icon: "📈", color: "#4f7ea3" },
  { id: 12, name: "其他收入", type: "income", icon: "💰", color: "#5f927c" },
];

function categoryByName(name) {
  return categories.find((category) => category.name === name);
}

function createGuestState() {
  const month = currentMonth();
  return {
    nextId: 1000,
    accounts: [
      {
        id: 101, member_id: CURRENT_MEMBER_ID, owner: CURRENT_MEMBER_NAME,
        name: "工资卡", type: "debit_card", currency: "CNY",
        exchange_rate_to_base: 1, balance: 28620, original_balance: 28620,
        last4: "6688", opened_at: `${month}-01`, can_edit: true, is_liability: false,
      },
      {
        id: 102, member_id: CURRENT_MEMBER_ID, owner: CURRENT_MEMBER_NAME,
        name: "支付宝", type: "wallet", currency: "CNY",
        exchange_rate_to_base: 1, balance: 3680, original_balance: 3680,
        opened_at: `${month}-01`, can_edit: true, is_liability: false,
      },
      {
        id: 103, member_id: CURRENT_MEMBER_ID, owner: CURRENT_MEMBER_NAME,
        name: "投资账户", type: "investment", currency: "CNY",
        exchange_rate_to_base: 1, cash_available: 12000,
        cash_available_original: 12000, balance: 0, original_balance: 12000,
        opened_at: `${month}-01`, can_edit: true, is_liability: false,
      },
      {
        id: 104, member_id: 9002, owner: "小禾",
        name: "家庭储蓄", type: "deposit", currency: "CNY",
        exchange_rate_to_base: 1, balance: 42000, original_balance: 42000,
        last4: "2036", opened_at: `${month}-01`, can_edit: true, is_liability: false,
      },
      {
        id: 105, member_id: CURRENT_MEMBER_ID, owner: CURRENT_MEMBER_NAME,
        name: "招商信用卡", type: "credit_card", currency: "CNY",
        exchange_rate_to_base: 1, balance: 3260, original_balance: 3260,
        last4: "8899", credit_limit: 50000, statement_day: 8, repayment_day: 26,
        opened_at: `${month}-01`, can_edit: true, is_liability: true,
      },
    ],
    archivedAccounts: [],
    transactions: [
      transactionFixture(201, 101, "income", 18600, "工资", "本月工资", 3),
      transactionFixture(202, 102, "expense", 168, "餐饮", "周末聚餐", 5),
      transactionFixture(203, 105, "expense", 1280, "服饰", "秋季外套", 7),
      transactionFixture(204, 101, "expense", 320, "交通", "通勤月卡", 8),
      transactionFixture(205, 102, "expense", 86, "娱乐", "电影票", 9),
      transactionFixture(206, 101, "income", 2200, "奖金", "项目奖金", 10),
      transactionFixture(207, 105, "expense", 420, "餐饮", "家庭聚餐", 11),
      transactionFixture(208, 101, "expense", 680, "旅行出游", "周边短途", 12),
      {
        id: "transfer-209",
        reference_id: "guest-transfer-209",
        source: "transfer",
        direction: "transfer",
        from_account_id: 101,
        from_account_owner: CURRENT_MEMBER_NAME,
        from_account_name: "工资卡",
        to_account_id: 103,
        to_account_owner: CURRENT_MEMBER_NAME,
        to_account_name: "投资账户",
        amount: 5000,
        to_amount: 5000,
        base_amount: 5000,
        occurred_at: monthDate(12),
        note: "月度定投准备",
        can_edit: true,
      },
    ],
    holdings: [
      {
        id: 301, account_id: 103, account_owner: CURRENT_MEMBER_NAME,
        account_name: "投资账户", name: "沪深300ETF", code: "510300",
        asset_type: "fund", market: "sh", currency: "CNY",
        exchange_rate_to_base: 1, buy_price: 3.82, current_price: 4.16,
        quantity: 8000, included_in_totals: 1, can_edit: true,
      },
      {
        id: 302, account_id: 103, account_owner: CURRENT_MEMBER_NAME,
        account_name: "投资账户", name: "红利低波ETF", code: "512890",
        asset_type: "fund", market: "sh", currency: "CNY",
        exchange_rate_to_base: 1, buy_price: 1.12, current_price: 1.28,
        quantity: 12000, included_in_totals: 1, can_edit: true,
      },
    ],
    trades: [
      {
        id: 401, holding_id: 301, holding_name: "沪深300ETF",
        account_id: 103, account_owner: CURRENT_MEMBER_NAME,
        account_name: "投资账户", trade_type: "buy", quantity: 8000,
        price: 3.82, fee: 5, base_amount: 30565,
        occurred_at: monthDate(2), note: "游客示例交易",
      },
      {
        id: 402, holding_id: 302, holding_name: "红利低波ETF",
        account_id: 103, account_owner: CURRENT_MEMBER_NAME,
        account_name: "投资账户", trade_type: "buy", quantity: 12000,
        price: 1.12, fee: 5, base_amount: 13445,
        occurred_at: monthDate(4), note: "游客示例交易",
      },
    ],
    budget: {
      id: 501,
      month,
      total_amount: 8000,
      categories: [],
      member_allocations: [
        { member_id: 9001, amount: 4900 },
        { member_id: 9002, amount: 3100 },
      ],
    },
    goals: [
      {
        id: 601, name: "应急储备", icon: "🛟", target_amount: 50000,
        current_amount: 32000, monthly_saving: 3000, due_date: "",
        status: "active", note: "覆盖家庭 6 个月基本支出",
        allocations: [
          { member_id: 9001, member_name: CURRENT_MEMBER_NAME, target_amount: 30000, current_amount: 20000, monthly_saving: 1800 },
          { member_id: 9002, member_name: "小禾", target_amount: 20000, current_amount: 12000, monthly_saving: 1200 },
        ],
      },
      {
        id: 602, name: "北海道旅行", icon: "✈️", target_amount: 30000,
        current_amount: 12600, monthly_saving: 2500, due_date: `${new Date().getFullYear() + 1}-06-01`,
        status: "active", note: "机票与住宿",
        allocations: [
          { member_id: 9001, member_name: CURRENT_MEMBER_NAME, target_amount: 18000, current_amount: 7600, monthly_saving: 1500 },
          { member_id: 9002, member_name: "小禾", target_amount: 12000, current_amount: 5000, monthly_saving: 1000 },
        ],
      },
    ],
    goalRecords: {
      601: [
        { id: 701, member_id: 9001, amount: 3000, recorded_at: monthDate(3), note: "月度储蓄" },
        { id: 702, member_id: 9002, amount: 1200, recorded_at: monthDate(5), note: "月度储蓄" },
      ],
      602: [
        { id: 703, member_id: 9001, amount: 1500, recorded_at: monthDate(6), note: "旅行基金" },
      ],
    },
  };
}

function transactionFixture(id, accountId, direction, amount, categoryName, merchant, day) {
  const category = categoryByName(categoryName);
  return {
    id,
    source: "manual",
    direction,
    account_id: accountId,
    category_id: category?.id,
    category_name: categoryName,
    amount,
    base_amount: amount,
    occurred_at: monthDate(day),
    merchant,
    note: "",
    icon: category?.icon,
    color: category?.color,
    can_edit: true,
  };
}

let activeGuestSessionId = getGuestSessionId();
let guestState = createGuestState();

export function resetGuestData() {
  activeGuestSessionId = getGuestSessionId();
  guestState = createGuestState();
}

function ensureCurrentGuestSession() {
  const sessionId = getGuestSessionId();
  if (sessionId !== activeGuestSessionId) {
    activeGuestSessionId = sessionId;
    guestState = createGuestState();
  }
}

function nextId() {
  guestState.nextId += 1;
  return guestState.nextId;
}

function parsePath(path) {
  const url = new URL(path, "https://guest.local");
  return { pathname: url.pathname, params: url.searchParams };
}

function visibleAccounts(scope) {
  const accounts = guestState.accounts.map((account) => {
    if (account.type !== "investment") return account;
    const holdingsValue = guestState.holdings
      .filter((holding) => holding.account_id === account.id)
      .reduce((sum, holding) => (
        sum + Number(holding.current_price || 0)
          * Number(holding.quantity || 0)
          * Number(holding.exchange_rate_to_base || 1)
      ), 0);
    const cash = Number(account.cash_available_original ?? account.cash_available ?? 0)
      * Number(account.exchange_rate_to_base || 1);
    return {
      ...account,
      holdings_value: roundMoney(holdingsValue),
      cash_available: roundMoney(cash),
      balance: roundMoney(holdingsValue + cash),
      original_balance: Number(account.cash_available_original ?? 0),
    };
  });
  return scope === "personal"
    ? accounts.filter((account) => account.member_id === CURRENT_MEMBER_ID)
    : accounts;
}

function accountOverview(scope) {
  const accounts = visibleAccounts(scope);
  const assetTotal = roundMoney(accounts
    .filter((account) => !account.is_liability)
    .reduce((sum, account) => sum + Number(account.balance || 0), 0));
  const liabilityTotal = roundMoney(accounts
    .filter((account) => account.is_liability)
    .reduce((sum, account) => sum + Number(account.balance || 0), 0));
  const assets = accounts.filter((account) => !account.is_liability);
  return {
    asset_total: assetTotal,
    liability_total: liabilityTotal,
    net_worth: roundMoney(assetTotal - liabilityTotal),
    accounts,
    distribution: assets.map((account) => ({
      name: `${account.owner} · ${account.name}`,
      value: account.balance,
      percent: assetTotal ? Math.round(account.balance / assetTotal * 1000) / 10 : 0,
    })),
  };
}

function accountForRecord(record, id) {
  if (record.source === "transfer") {
    return [record.from_account_id, record.to_account_id].map(String).includes(String(id));
  }
  return String(record.account_id) === String(id);
}

function visibleRecords(scope) {
  const ids = new Set(visibleAccounts(scope).map((account) => String(account.id)));
  return guestState.transactions.filter((record) => {
    if (record.source === "transfer") {
      return ids.has(String(record.from_account_id)) || ids.has(String(record.to_account_id));
    }
    return ids.has(String(record.account_id));
  });
}

function accountName(accountId) {
  return guestState.accounts.find((account) => account.id === Number(accountId));
}

function hydrateRecord(record) {
  if (record.source === "transfer") return record;
  const account = accountName(record.account_id);
  const category = categories.find((item) => item.id === record.category_id)
    || categoryByName(record.category_name);
  return {
    ...record,
    account_owner: record.account_owner || account?.owner || "",
    account_name: record.account_name || account?.name || "",
    category_id: record.category_id || category?.id,
    icon: record.icon || category?.icon,
    color: record.color || category?.color,
    can_edit: account?.can_edit !== false,
  };
}

function recordsForMonth(scope, month) {
  return visibleRecords(scope)
    .filter((record) => !month || record.occurred_at?.startsWith(month))
    .map(hydrateRecord);
}

function cashflowTotals(records) {
  return records.reduce((totals, record) => {
    if (record.voided_at) {
      totals.voided += 1;
    } else if (record.source === "manual" && ["income", "expense"].includes(record.direction)) {
      totals[record.direction] += Number(record.base_amount ?? record.amount ?? 0);
    } else {
      totals.other += 1;
    }
    return totals;
  }, { income: 0, expense: 0, other: 0, voided: 0 });
}

function analysis(scope, month, direction) {
  const records = recordsForMonth(scope, month)
    .filter((record) => record.source === "manual" && record.direction === direction && !record.voided_at);
  const total = roundMoney(records.reduce((sum, record) => sum + Number(record.base_amount ?? record.amount), 0));
  const grouped = new Map();
  records.forEach((record) => {
    const key = record.category_id || 0;
    const current = grouped.get(key) || {
      id: key,
      category_id: key,
      name: record.category_name || "未分类",
      icon: record.icon || (direction === "income" ? "💰" : "🧾"),
      color: record.color || "#8b9892",
      amount: 0,
    };
    current.amount += Number(record.base_amount ?? record.amount);
    grouped.set(key, current);
  });
  const categoryRows = [...grouped.values()]
    .map((item) => ({
      ...item,
      amount: roundMoney(item.amount),
      percent: total ? Math.round(item.amount / total * 1000) / 10 : 0,
    }))
    .sort((left, right) => right.amount - left.amount);
  if (direction === "expense") {
    return {
      total_expense: total,
      daily_average: roundMoney(total / Math.max(new Date().getDate(), 1)),
      largest_category: categoryRows[0] || null,
      categories: categoryRows,
      cashflow: [],
    };
  }
  return {
    total_income: total,
    daily_average: roundMoney(total / Math.max(new Date().getDate(), 1)),
    largest_category: categoryRows[0] || null,
    categories: categoryRows,
    trend: [],
  };
}

function dashboardSummary(scope, month) {
  const overview = accountOverview(scope);
  const records = recordsForMonth(scope, month);
  const totals = cashflowTotals(records);
  const budget = budgetSummary(scope, month);
  const trendMonths = monthSequence(8);
  const trendStart = overview.net_worth - 18000;
  return {
    net_worth: overview.net_worth,
    monthly_income: roundMoney(totals.income),
    monthly_expense: roundMoney(totals.expense),
    monthly_balance: roundMoney(totals.income - totals.expense),
    savings_rate: totals.income
      ? Math.round((totals.income - totals.expense) / totals.income * 1000) / 10
      : 0,
    asset_allocation: overview.distribution,
    trend: trendMonths.map((date, index) => ({
      date,
      value: roundMoney(trendStart + index * 2600 + (index % 2 ? 900 : 0)),
    })),
    recent_transactions: records
      .filter((record) => record.source === "manual" && !record.voided_at)
      .toSorted((left, right) => (
        right.occurred_at.localeCompare(left.occurred_at) || Number(right.id) - Number(left.id)
      ))
      .slice(0, 7),
    budget: {
      total: budget.total_budget,
      used: budget.total_used,
      left: budget.left,
      used_percent: budget.used_percent,
    },
  };
}

function investmentSummary(scope) {
  const visibleIds = new Set(visibleAccounts(scope).map((account) => account.id));
  const holdings = guestState.holdings
    .filter((holding) => visibleIds.has(holding.account_id))
    .map((holding) => {
      const marketValue = roundMoney(
        holding.current_price * holding.quantity * (holding.exchange_rate_to_base || 1),
      );
      const cost = holding.buy_price * holding.quantity * (holding.exchange_rate_to_base || 1);
      const profit = roundMoney(marketValue - cost);
      return {
        ...holding,
        market_value: marketValue,
        profit,
        profit_rate: cost ? Math.round(profit / cost * 1000) / 10 : 0,
      };
    });
  const investmentAccounts = visibleAccounts(scope)
    .filter((account) => account.type === "investment");
  const cashAvailable = roundMoney(investmentAccounts.reduce(
    (sum, account) => sum + Number(account.cash_available || 0),
    0,
  ));
  const holdingsValue = roundMoney(holdings.reduce((sum, holding) => sum + holding.market_value, 0));
  const totalProfit = roundMoney(holdings.reduce((sum, holding) => sum + holding.profit, 0));
  const totalValue = roundMoney(holdingsValue + cashAvailable);
  const allocationMap = new Map();
  holdings.forEach((holding) => {
    allocationMap.set(
      holding.asset_type,
      (allocationMap.get(holding.asset_type) || 0) + holding.market_value,
    );
  });
  if (cashAvailable) allocationMap.set("现金", cashAvailable);
  const trendMonths = monthSequence(8);
  return {
    total_value: totalValue,
    total_profit: totalProfit,
    profit_rate: holdingsValue - totalProfit
      ? Math.round(totalProfit / (holdingsValue - totalProfit) * 1000) / 10
      : 0,
    cash_available: cashAvailable,
    cash_accounts: investmentAccounts.map((account) => ({
      id: account.id,
      owner: account.owner,
      name: account.name,
      currency: account.currency,
      exchange_rate_to_base: account.exchange_rate_to_base,
      cash_available: account.cash_available,
      cash_available_original: account.cash_available_original,
      can_edit: true,
    })),
    allocation: [...allocationMap.entries()].map(([name, value]) => ({
      name,
      value: roundMoney(value),
      percent: totalValue ? Math.round(value / totalValue * 1000) / 10 : 0,
    })),
    holdings,
    trend: trendMonths.map((date, index) => ({
      date,
      value: roundMoney(totalValue - (trendMonths.length - index - 1) * 1700),
    })),
  };
}

function memberName(memberId) {
  return Number(memberId) === CURRENT_MEMBER_ID ? CURRENT_MEMBER_NAME : "小禾";
}

function budgetSummary(scope, month) {
  const budget = guestState.budget;
  const expenseRows = recordsForMonth(scope, month)
    .filter((record) => record.source === "manual" && record.direction === "expense" && !record.voided_at);
  const usedByCategory = expenseRows.reduce((values, record) => {
    values.set(record.category_id, (values.get(record.category_id) || 0) + Number(record.base_amount ?? record.amount));
    return values;
  }, new Map());
  const rows = budget.categories.map((row) => {
    const category = categories.find((item) => item.id === row.category_id);
    const familyAmount = Number(row.amount || 0);
    const personalAmount = Number(
      row.member_allocations.find((allocation) => allocation.member_id === CURRENT_MEMBER_ID)?.amount || 0,
    );
    const amount = scope === "personal" ? personalAmount : familyAmount;
    return {
      id: `${budget.id}-${row.category_id}`,
      category_id: row.category_id,
      member_id: scope === "personal" ? CURRENT_MEMBER_ID : null,
      member_name: scope === "personal" ? CURRENT_MEMBER_NAME : "",
      can_edit: true,
      name: category?.name || "未分类",
      icon: category?.icon,
      color: category?.color,
      budget: amount,
      family_budget: familyAmount,
      used: roundMoney(usedByCategory.get(row.category_id) || 0),
      member_allocations: row.member_allocations.map((allocation) => ({
        ...allocation,
        member_name: memberName(allocation.member_id),
      })),
    };
  });
  const directAllocations = budget.member_allocations?.length
    ? budget.member_allocations
    : [9001, 9002].map((memberId) => ({
      member_id: memberId,
      amount: budget.categories.reduce((sum, row) => (
        sum + Number(row.member_allocations.find(
          (allocation) => allocation.member_id === memberId,
        )?.amount || 0)
      ), 0),
    }));
  const totalBudget = roundMoney(scope === "family"
    ? budget.total_amount
    : directAllocations.find(
      (allocation) => allocation.member_id === CURRENT_MEMBER_ID,
    )?.amount || 0);
  const totalUsed = roundMoney(expenseRows.reduce((sum, record) => sum + Number(record.base_amount ?? record.amount), 0));
  const allocatedUsed = roundMoney(rows.reduce((sum, row) => sum + row.used, 0));
  const memberAllocations = [9001, 9002].map((memberId) => {
    const amount = Number(directAllocations.find(
      (allocation) => allocation.member_id === memberId,
    )?.amount || 0);
    const used = memberId === CURRENT_MEMBER_ID ? totalUsed : 0;
    return {
      id: memberId,
      member_id: memberId,
      member_name: memberName(memberId),
      amount,
      used,
      left: roundMoney(amount - used),
      percent: budget.total_amount ? Math.round(amount / budget.total_amount * 1000) / 10 : 0,
      categories: budget.categories
        .filter((row) => row.member_allocations.some(
          (allocation) => allocation.member_id === memberId && allocation.amount > 0,
        ))
        .map((row) => ({
          name: categories.find((category) => category.id === row.category_id)?.name,
          amount: row.member_allocations.find((allocation) => allocation.member_id === memberId)?.amount,
        })),
    };
  });
  return {
    id: budget.id,
    month,
    family_total_budget: budget.total_amount,
    total_budget: totalBudget,
    total_used: totalUsed,
    left: roundMoney(totalBudget - totalUsed),
    used_percent: totalBudget ? Math.round(totalUsed / totalBudget * 1000) / 10 : 0,
    unbudgeted_expense: rows.length ? roundMoney(totalUsed - allocatedUsed) : 0,
    items: rows,
    allocations: scope === "family" ? memberAllocations : memberAllocations.filter(
      (allocation) => allocation.member_id === CURRENT_MEMBER_ID,
    ),
    member_count: scope === "family" ? 2 : 1,
    category_count: rows.length,
  };
}

function goalsSummary(scope) {
  const goals = guestState.goals.map((goal) => {
    const personal = goal.allocations.find((allocation) => allocation.member_id === CURRENT_MEMBER_ID);
    const scoped = scope === "personal" ? personal : null;
    return {
      ...goal,
      target_amount: scoped?.target_amount ?? goal.target_amount,
      current_amount: scoped?.current_amount ?? goal.current_amount,
      monthly_saving: scoped?.monthly_saving ?? goal.monthly_saving,
      member_id: scoped?.member_id,
      member_name: scoped?.member_name,
      family_target_amount: goal.target_amount,
      family_current_amount: goal.current_amount,
      family_monthly_saving: goal.monthly_saving,
      can_edit: true,
      can_contribute: true,
    };
  });
  const active = goals.filter((goal) => goal.status !== "archived");
  const targetTotal = roundMoney(active.reduce((sum, goal) => sum + Number(goal.target_amount || 0), 0));
  const currentTotal = roundMoney(active.reduce((sum, goal) => sum + Number(goal.current_amount || 0), 0));
  const monthlySaving = roundMoney(active.reduce((sum, goal) => sum + Number(goal.monthly_saving || 0), 0));
  const months = monthSequence(8);
  return {
    target_total: targetTotal,
    current_total: currentTotal,
    monthly_saving: monthlySaving,
    progress: targetTotal ? Math.round(currentTotal / targetTotal * 1000) / 10 : 0,
    goals,
    plan: months.map((month, index) => ({
      period: month,
      actual: roundMoney(Math.max(0, currentTotal - (months.length - index - 1) * monthlySaving * 0.72)),
      plan: roundMoney(Math.max(0, currentTotal - (months.length - index - 1) * monthlySaving)),
    })),
  };
}

function ledgerPage(scope, params) {
  let records = visibleRecords(scope).map(hydrateRecord);
  const recordScope = params.get("record_scope") || "effective";
  const source = params.get("source");
  const direction = params.get("direction");
  const accountId = params.get("account_id");
  const owner = params.get("owner");
  const categoryId = params.get("category_id");
  const dateFrom = params.get("date_from");
  const dateTo = params.get("date_to");
  const search = params.get("search")?.toLowerCase();
  records = records.filter((record) => {
    if (source && record.source !== source) return false;
    if (direction && record.direction !== direction) return false;
    if (accountId && !accountForRecord(record, accountId)) return false;
    if (owner && ![
      record.account_owner,
      record.from_account_owner,
      record.to_account_owner,
    ].includes(owner)) return false;
    if (categoryId && String(record.category_id) !== categoryId) return false;
    if (dateFrom && record.occurred_at < dateFrom) return false;
    if (dateTo && record.occurred_at > dateTo) return false;
    if (recordScope === "voided" && !record.voided_at) return false;
    if (recordScope === "effective" && record.voided_at) return false;
    if (recordScope === "effective" && !source && ["opening", "adjustment"].includes(record.source)) return false;
    if (search && ![
      record.merchant, record.note, record.category_name,
      record.account_name, record.from_account_name, record.to_account_name,
    ].some((value) => String(value || "").toLowerCase().includes(search))) return false;
    return true;
  });
  records.sort((left, right) => (
    right.occurred_at.localeCompare(left.occurred_at)
      || String(right.id).localeCompare(String(left.id))
  ));
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("page_size") || 30);
  const start = (page - 1) * pageSize;
  return {
    items: records.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total: records.length,
    summary: cashflowTotals(records),
  };
}

function ledgerMonthlyOverview(scope, params) {
  const month = params.get("month") || currentMonth();
  const previousMonth = shiftMonth(month, -1);
  const accountId = params.get("account_id");
  const owner = params.get("owner");
  const filterRecords = (targetMonth) => visibleRecords(scope)
    .map(hydrateRecord)
    .filter((record) => (
      record.occurred_at?.startsWith(targetMonth)
      && record.source === "manual"
      && ["income", "expense"].includes(record.direction)
      && !record.voided_at
      && (!accountId || String(record.account_id) === accountId)
      && (!owner || record.account_owner === owner)
    ));
  const currentRecords = filterRecords(month);
  const previousRecords = filterRecords(previousMonth);
  const totalFor = (records, direction) => roundMoney(records
    .filter((record) => record.direction === direction)
    .reduce((sum, record) => sum + Number(record.base_amount ?? record.amount), 0));
  const monthDayCount = daysInMonth(month);
  const directions = {};

  ["expense", "income"].forEach((direction) => {
    const records = currentRecords.filter((record) => record.direction === direction);
    const total = totalFor(records, direction);
    const byDate = new Map();
    const byCategory = new Map();
    records.forEach((record) => {
      const dateValue = record.occurred_at.slice(0, 10);
      const amount = Number(record.base_amount ?? record.amount);
      const day = byDate.get(dateValue) || { amount: 0, count: 0 };
      day.amount += amount;
      day.count += 1;
      byDate.set(dateValue, day);

      const key = record.category_id || 0;
      const category = byCategory.get(key) || {
        id: record.category_id || null,
        category_id: record.category_id || null,
        name: record.category_name || "未分类",
        icon: record.icon || (direction === "income" ? "💰" : "🧾"),
        color: record.color || "#827f77",
        amount: 0,
        count: 0,
      };
      category.amount += amount;
      category.count += 1;
      byCategory.set(key, category);
    });
    const daily = Array.from({ length: monthDayCount }, (_, index) => {
      const dateValue = `${month}-${pad(index + 1)}`;
      const value = byDate.get(dateValue) || { amount: 0, count: 0 };
      return { date: dateValue, amount: roundMoney(value.amount), count: value.count };
    });
    const highestDay = daily
      .filter((item) => item.count)
      .toSorted((left, right) => right.amount - left.amount || left.date.localeCompare(right.date))[0]
      || null;
    const categoryRows = [...byCategory.values()]
      .map((item) => ({
        ...item,
        amount: roundMoney(item.amount),
        percent: total ? Math.round(item.amount / total * 1000) / 10 : 0,
      }))
      .toSorted((left, right) => right.amount - left.amount || left.name.localeCompare(right.name));
    directions[direction] = {
      total,
      daily_average: roundMoney(total / Math.max(monthDayCount, 1)),
      count: records.length,
      highest_day: highestDay,
      daily,
      categories: categoryRows,
    };
  });

  const income = totalFor(currentRecords, "income");
  const expense = totalFor(currentRecords, "expense");
  return {
    month,
    previous_month: previousMonth,
    base_currency: "CNY",
    summary: {
      income,
      expense,
      balance: roundMoney(income - expense),
      previous_balance: roundMoney(
        totalFor(previousRecords, "income") - totalFor(previousRecords, "expense"),
      ),
    },
    directions,
  };
}

function familyData() {
  return {
    id: 9001,
    name: "游客示例家庭",
    role: "owner",
    current_member_id: CURRENT_MEMBER_ID,
    can_manage: true,
    members: [
      {
        id: CURRENT_MEMBER_ID, user_id: CURRENT_MEMBER_ID,
        display_name: CURRENT_MEMBER_NAME, role: "owner",
        username: "guest", login_enabled: true, is_current: true, account_count: 4,
      },
      {
        id: 9002, user_id: 9002, display_name: "小禾",
        role: "member", username: "demo-member", login_enabled: true,
        is_current: false, account_count: 1,
      },
    ],
    recent_activity: [],
  };
}

function accountDetail(accountId) {
  const account = [...guestState.accounts, ...guestState.archivedAccounts]
    .find((item) => item.id === Number(accountId));
  if (!account) throw new Error("示例账户不存在");
  const overviewAccount = visibleAccounts("family").find((item) => item.id === account.id) || account;
  return {
    account: { ...overviewAccount, is_active: !account.archived, can_restore: Boolean(account.archived) },
    transactions: visibleRecords("family").filter((record) => accountForRecord(record, account.id)).map(hydrateRecord),
    holdings: guestState.holdings.filter((holding) => holding.account_id === account.id),
    trades: guestState.trades.filter((trade) => trade.account_id === account.id),
    activity: [],
  };
}

export async function guestFetchJson(path, options = {}) {
  ensureCurrentGuestSession();
  const { pathname, params } = parsePath(path);
  const scope = options.scope === "personal" ? "personal" : "family";
  if (pathname === "/auth/session") {
    return {
      user: { id: CURRENT_MEMBER_ID, username: "guest", display_name: CURRENT_MEMBER_NAME },
      family: { id: 9001, name: "游客示例家庭", role: "owner", member_id: CURRENT_MEMBER_ID },
      scope,
      business_timezone: "Asia/Shanghai",
      guest_mode: true,
    };
  }
  if (pathname === "/family") return clone(familyData());
  if (pathname === "/accounts/overview") return clone(accountOverview(scope));
  if (pathname === "/accounts/archived") return clone(guestState.archivedAccounts);
  if (/^\/accounts\/\d+$/.test(pathname)) return clone(accountDetail(pathname.split("/").at(-1)));
  if (pathname === "/categories") return clone(categories);
  if (pathname === "/dashboard/summary") {
    return clone(dashboardSummary(scope, params.get("month") || currentMonth()));
  }
  if (pathname === "/investments/summary") return clone(investmentSummary(scope));
  if (pathname === "/income/analysis") {
    return clone(analysis(scope, params.get("month") || currentMonth(), "income"));
  }
  if (pathname === "/expenses/analysis") {
    return clone(analysis(scope, params.get("month") || currentMonth(), "expense"));
  }
  if (pathname === "/budgets/monthly") {
    return clone(budgetSummary(scope, params.get("month") || currentMonth()));
  }
  if (pathname === "/goals") return clone(goalsSummary(scope));
  if (/^\/goals\/\d+\/records$/.test(pathname)) {
    const id = pathname.split("/")[2];
    return clone(guestState.goalRecords[id] || []);
  }
  if (pathname === "/ledger/monthly-overview") {
    return clone(ledgerMonthlyOverview(scope, params));
  }
  if (pathname === "/ledger") return clone(ledgerPage(scope, params));
  if (pathname === "/investments/trades") {
    const visibleIds = new Set(visibleAccounts(scope).map((account) => account.id));
    const rows = guestState.trades.filter((trade) => visibleIds.has(trade.account_id));
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("page_size") || 50);
    return {
      items: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
      page,
      page_size: pageSize,
      total: rows.length,
    };
  }
  throw new Error(`游客模式暂不支持读取 ${pathname}`);
}

function applyTransactionBalance(record, multiplier) {
  const account = accountName(record.account_id);
  if (!account || account.type === "investment") return;
  const amount = Number(record.base_amount ?? record.amount ?? 0) * multiplier;
  const direction = record.direction === "expense" ? -1 : 1;
  const balanceChange = account.is_liability ? -direction * amount : direction * amount;
  account.balance = roundMoney(Number(account.balance || 0) + balanceChange);
  account.original_balance = account.balance;
}

function writeTransaction(payload, id = nextId()) {
  const category = categoryByName(payload.category_name);
  const record = {
    id,
    source: "manual",
    direction: payload.direction,
    account_id: Number(payload.account_id),
    category_id: category?.id,
    category_name: payload.category_name || "",
    amount: roundMoney(payload.amount),
    base_amount: roundMoney(payload.amount),
    occurred_at: payload.occurred_at,
    merchant: payload.merchant || "",
    note: payload.note || "",
    icon: category?.icon,
    color: category?.color,
    can_edit: true,
  };
  guestState.transactions.push(record);
  applyTransactionBalance(record, 1);
  return record;
}

function writeTransfer(payload) {
  const source = accountName(payload.from_account_id);
  const target = accountName(payload.to_account_id);
  if (!source || !target || source.id === target.id) throw new Error("请选择两个不同的示例账户");
  const amount = Number(payload.amount || 0);
  const received = Number(payload.to_amount || amount);
  if (!Number.isFinite(amount) || !Number.isFinite(received) || amount <= 0 || received <= 0) {
    throw new Error("转账金额必须大于零");
  }
  const sourceDelta = source.is_liability ? amount : -amount;
  const targetDelta = target.is_liability ? -received : received;
  validateGuestCashChange(source, sourceDelta);
  validateGuestCashChange(target, targetDelta);
  applyGuestCashChange(source, sourceDelta);
  applyGuestCashChange(target, targetDelta);
  const referenceId = `guest-transfer-${nextId()}`;
  const record = {
    id: `transfer-${referenceId}`,
    reference_id: referenceId,
    source: "transfer",
    direction: "transfer",
    from_account_id: source.id,
    from_account_owner: source.owner,
    from_account_name: source.name,
    to_account_id: target.id,
    to_account_owner: target.owner,
    to_account_name: target.name,
    amount,
    to_amount: received,
    base_amount: amount,
    occurred_at: payload.occurred_at,
    note: payload.note || "",
    can_edit: true,
  };
  guestState.transactions.push(record);
  return record;
}

function validateGuestCashChange(account, delta) {
  if (account.type === "investment"
      && roundMoney(Number(account.cash_available_original || 0) + delta) < 0) {
    throw new Error("投资账户现金可投不足");
  }
}

function applyGuestCashChange(account, delta) {
  if (account.type === "investment") {
    account.cash_available_original = roundMoney(Number(account.cash_available_original || 0) + delta);
    account.cash_available = account.cash_available_original;
  } else {
    account.balance = roundMoney(Number(account.balance || 0) + delta);
    account.original_balance = account.balance;
  }
}

function reverseGuestTransfer(referenceId, payload) {
  const record = guestState.transactions.find((item) => (
    item.source === "transfer" && item.reference_id === referenceId
  ));
  if (!record) throw new Error("示例转账不存在");
  if (record.voided_at) throw new Error("示例转账已撤销");
  const source = accountName(record.from_account_id);
  const target = accountName(record.to_account_id);
  if (!source || !target) throw new Error("示例转账账户不存在");
  const sourceDelta = source.is_liability ? -record.amount : record.amount;
  const targetDelta = target.is_liability ? record.to_amount : -record.to_amount;
  validateGuestCashChange(source, sourceDelta);
  validateGuestCashChange(target, targetDelta);
  applyGuestCashChange(source, sourceDelta);
  applyGuestCashChange(target, targetDelta);
  record.voided_at = new Date().toISOString();
  record.void_reason = payload.reason || "";
  return { message: "游客转账已撤销" };
}

function writeAccount(payload) {
  const account = {
    id: nextId(),
    ...payload,
    member_id: Number(payload.member_id),
    owner: payload.owner || memberName(payload.member_id),
    balance: roundMoney(payload.balance || 0),
    original_balance: roundMoney(payload.balance || 0),
    opened_at: payload.opening_date || monthDate(1),
    can_edit: true,
    is_liability: Boolean(payload.is_liability),
    cash_available: payload.type === "investment" ? roundMoney(payload.balance || 0) : undefined,
    cash_available_original: payload.type === "investment" ? roundMoney(payload.balance || 0) : undefined,
  };
  guestState.accounts.push(account);
  return account;
}

function writeBudget(payload) {
  guestState.budget = {
    id: guestState.budget.id || nextId(),
    month: payload.month,
    total_amount: Number(payload.total_amount || 0),
    categories: (payload.categories || []).map((row) => ({
      category_id: Number(row.category_id),
      amount: Number(row.amount || 0),
      member_allocations: (row.member_allocations || []).map((allocation) => ({
        member_id: Number(allocation.member_id),
        amount: Number(allocation.amount || 0),
      })),
    })),
    member_allocations: (payload.member_allocations || []).map((allocation) => ({
      member_id: Number(allocation.member_id),
      amount: Number(allocation.amount || 0),
    })),
  };
  return { message: "游客预算已更新" };
}

function writeGoal(payload) {
  const allocations = (payload.allocations || []).map((allocation) => ({
    member_id: Number(allocation.member_id),
    member_name: memberName(allocation.member_id),
    target_amount: Number(allocation.target_amount || 0),
    current_amount: 0,
    monthly_saving: Number(allocation.monthly_saving || 0),
  }));
  const goal = {
    id: nextId(),
    name: payload.name,
    icon: payload.icon || "🎯",
    target_amount: Number(payload.target_amount || allocations.reduce((sum, item) => sum + item.target_amount, 0)),
    current_amount: 0,
    monthly_saving: Number(payload.monthly_saving || allocations.reduce((sum, item) => sum + item.monthly_saving, 0)),
    due_date: payload.due_date || "",
    status: "active",
    note: payload.note || "",
    allocations,
  };
  guestState.goals.push(goal);
  guestState.goalRecords[goal.id] = [];
  return goal;
}

function writeGoalRecord(goalId, payload) {
  const goal = guestState.goals.find((item) => item.id === Number(goalId));
  if (!goal) throw new Error("示例目标不存在");
  const amount = Number(payload.amount || 0);
  const memberId = Number(payload.member_id || CURRENT_MEMBER_ID);
  const allocation = goal.allocations.find((item) => item.member_id === memberId);
  goal.current_amount = roundMoney(Math.max(0, goal.current_amount + amount));
  if (allocation) allocation.current_amount = roundMoney(Math.max(0, allocation.current_amount + amount));
  const record = {
    id: nextId(),
    member_id: memberId,
    amount,
    recorded_at: payload.recorded_at,
    note: payload.note || "",
  };
  guestState.goalRecords[goal.id] = [...(guestState.goalRecords[goal.id] || []), record];
  return record;
}

export async function guestWriteJson(method, path, payload) {
  ensureCurrentGuestSession();
  const { pathname } = parsePath(path);
  if (method === "POST" && pathname === "/transactions") {
    return clone(writeTransaction(payload));
  }
  if (method === "PATCH" && /^\/transactions\/\d+$/.test(pathname)) {
    const id = Number(pathname.split("/").at(-1));
    const index = guestState.transactions.findIndex((record) => record.id === id);
    if (index < 0) throw new Error("示例流水不存在");
    applyTransactionBalance(guestState.transactions[index], -1);
    const updated = writeTransaction(payload, id);
    guestState.transactions.splice(index, 1);
    return clone(updated);
  }
  if (method === "DELETE" && /^\/transactions\/\d+$/.test(pathname)) {
    const id = Number(pathname.split("/").at(-1));
    const record = guestState.transactions.find((item) => item.id === id);
    if (record) applyTransactionBalance(record, -1);
    guestState.transactions = guestState.transactions.filter((item) => item.id !== id);
    return { message: "游客流水已删除" };
  }
  if (method === "POST" && pathname === "/accounts/transfer") {
    return clone(writeTransfer(payload));
  }
  if (method === "POST" && pathname === "/accounts") return clone(writeAccount(payload));
  if (method === "PATCH" && /^\/accounts\/\d+$/.test(pathname)) {
    const account = accountName(pathname.split("/").at(-1));
    if (!account) throw new Error("示例账户不存在");
    Object.assign(account, payload, {
      id: account.id,
      balance: account.balance,
      original_balance: account.original_balance,
      opened_at: account.opened_at,
    });
    return clone(account);
  }
  if (method === "POST" && /^\/accounts\/\d+\/adjustments$/.test(pathname)) {
    const accountId = Number(pathname.split("/")[2]);
    const account = accountName(accountId);
    if (!account) throw new Error("示例账户不存在");
    const before = Number(account.balance || 0);
    account.balance = roundMoney(payload.actual_balance);
    account.original_balance = account.balance;
    guestState.transactions.push({
      id: nextId(),
      source: "adjustment",
      direction: account.balance >= before ? "income" : "expense",
      account_id: account.id,
      account_owner: account.owner,
      account_name: account.name,
      amount: roundMoney(Math.abs(account.balance - before)),
      base_amount: roundMoney(Math.abs(account.balance - before)),
      occurred_at: payload.occurred_at,
      note: payload.reason,
      can_edit: false,
    });
    return { message: "游客余额已核对" };
  }
  if (method === "POST" && pathname === "/budgets") return writeBudget(payload);
  if (method === "POST" && pathname === "/budgets/copy") return { message: "游客预算已沿用", copied: 4, skipped: 0 };
  if (method === "POST" && pathname === "/goals") return clone(writeGoal(payload));
  if (method === "PATCH" && /^\/goals\/\d+$/.test(pathname)) {
    const goal = guestState.goals.find((item) => item.id === Number(pathname.split("/").at(-1)));
    if (!goal) throw new Error("示例目标不存在");
    Object.assign(goal, payload);
    return clone(goal);
  }
  if (method === "PATCH" && /^\/goals\/\d+\/status$/.test(pathname)) {
    const goal = guestState.goals.find((item) => item.id === Number(pathname.split("/")[2]));
    if (!goal) throw new Error("示例目标不存在");
    goal.status = payload.status;
    return { status: goal.status };
  }
  if (method === "POST" && /^\/goals\/\d+\/records$/.test(pathname)) {
    return clone(writeGoalRecord(pathname.split("/")[2], payload));
  }
  if (method === "DELETE" && /^\/goals\/\d+$/.test(pathname)) {
    const id = Number(pathname.split("/").at(-1));
    guestState.goals = guestState.goals.filter((goal) => goal.id !== id);
    delete guestState.goalRecords[id];
    return { message: "游客目标已删除" };
  }
  if (method === "POST" && pathname === "/holdings") {
    const account = accountName(payload.account_id);
    const holding = {
      id: nextId(),
      ...payload,
      account_owner: account?.owner,
      account_name: account?.name,
      included_in_totals: account ? 1 : 0,
      can_edit: true,
    };
    guestState.holdings.push(holding);
    return clone(holding);
  }
  if (method === "PATCH" && /^\/holdings\/\d+$/.test(pathname)) {
    const holding = guestState.holdings.find((item) => item.id === Number(pathname.split("/").at(-1)));
    if (!holding) throw new Error("示例持仓不存在");
    Object.assign(holding, payload);
    return clone(holding);
  }
  if (method === "DELETE" && /^\/holdings\/\d+$/.test(pathname)) {
    const id = Number(pathname.split("/").at(-1));
    guestState.holdings = guestState.holdings.filter((holding) => holding.id !== id);
    return { message: "游客持仓已删除" };
  }
  if (method === "POST" && pathname === "/investments/trades") {
    let holding;
    if (payload.new_holding) {
      holding = {
        id: nextId(),
        ...payload.new_holding,
        account_owner: accountName(payload.new_holding.account_id)?.owner,
        account_name: accountName(payload.new_holding.account_id)?.name,
        included_in_totals: 1,
        can_edit: true,
      };
      guestState.holdings.push(holding);
    } else {
      holding = guestState.holdings.find((item) => item.id === Number(payload.holding_id));
      if (!holding) throw new Error("示例持仓不存在");
      const quantity = Number(payload.quantity || 0);
      holding.quantity = roundMoney(
        Number(holding.quantity || 0) + (payload.trade_type === "sell" ? -quantity : quantity),
      );
    }
    const trade = {
      id: nextId(),
      holding_id: holding.id,
      holding_name: holding.name,
      account_id: holding.account_id,
      account_owner: holding.account_owner,
      account_name: holding.account_name,
      trade_type: payload.trade_type,
      quantity: Number(payload.quantity),
      price: Number(payload.price),
      fee: Number(payload.fee || 0),
      base_amount: roundMoney(Number(payload.quantity) * Number(payload.price) + Number(payload.fee || 0)),
      occurred_at: payload.occurred_at,
      note: payload.note || "",
    };
    guestState.trades.push(trade);
    return clone(trade);
  }
  if (method === "PATCH" && pathname === "/investments/cash-available") {
    const account = accountName(payload.account_id);
    if (!account) throw new Error("示例投资账户不存在");
    account.cash_available_original = roundMoney(payload.cash_available);
    return { message: "游客现金可投已更新" };
  }
  if (method === "POST" && pathname === "/investments/refresh") {
    guestState.holdings.forEach((holding, index) => {
      holding.current_price = roundMoney(holding.current_price * (1 + (index % 2 ? -0.002 : 0.003)));
    });
    return {
      message: "游客行情已刷新",
      sources: ["游客示例行情"],
      details: [],
      summary: clone(investmentSummary("family")),
    };
  }
  if (method === "POST" && /^\/accounts\/transfers\/.+\/reverse$/.test(pathname)) {
    return reverseGuestTransfer(decodeURIComponent(pathname.split("/")[3]), payload);
  }
  if (method === "POST" && /^\/investments\/trades\/\d+\/reverse$/.test(pathname)) {
    return { message: "游客投资交易已撤销" };
  }
  throw new Error(`游客模式暂不支持 ${method} ${pathname}`);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function downloadGuestFile(path, fallbackName, options = {}) {
  ensureCurrentGuestSession();
  const { pathname } = parsePath(path);
  let blob;
  if (pathname === "/ledger/export") {
    const rows = visibleRecords(options.scope === "personal" ? "personal" : "family")
      .map(hydrateRecord);
    const header = ["日期", "方向", "分类", "账户", "金额", "备注"];
    const lines = rows.map((row) => [
      row.occurred_at,
      row.direction,
      row.category_name || row.source,
      row.account_name || `${row.from_account_name} → ${row.to_account_name}`,
      row.amount,
      row.note,
    ].map(csvCell).join(","));
    blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  } else {
    blob = new Blob([JSON.stringify({
      format: "invest-guest-demo",
      generated_at: new Date().toISOString(),
      data: guestState,
    }, null, 2)], { type: "application/json" });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}

export function getGuestSnapshotForTest() {
  ensureCurrentGuestSession();
  return clone(guestState);
}
