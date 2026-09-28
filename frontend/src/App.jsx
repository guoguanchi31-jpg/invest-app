import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarRange, DatabaseBackup, LayoutDashboard, Plus, WalletCards } from "lucide-react";
import StatementImportDialog from "./components/StatementImportDialog";
import BackupDialog from "./components/BackupDialog";
import ReversalDialog from "./components/ReversalDialog";
import { clearSavedBudgetDrafts } from "./budgetDrafts";
import { accountCurrency, originalBalance, originalMoney, repaymentDraft, tradePreview } from "./settlement";
import {
  apiUrl,
  AUTH_TOKEN_KEY,
  deleteJson,
  downloadFile,
  ensureResponse,
  fetchJson,
  patchJson,
  postJson,
  requestHeaders,
} from "./api";

const pageComponents = {
  dashboard: lazy(() => import("./pages/DashboardPage")),
  ledger: lazy(() => import("./pages/LedgerPage")),
  assets: lazy(() => import("./pages/AssetsPage")),
  plan: lazy(() => import("./pages/PlanPage")),
};

const USER_DISPLAY_NAME = import.meta.env.VITE_USER_NAME || "冠池";
const USER_BADGE = import.meta.env.VITE_USER_BADGE || "个人理财空间";
const DEFAULT_ACCOUNT_OWNER = USER_DISPLAY_NAME || "冠池";
const RECENT_ACCOUNT_KEY = "investRecentAccountId";

const navGroups = [
  {
    title: "日常理财",
    items: [
      { key: "dashboard", label: "总览", icon: <LayoutDashboard size={20} /> },
      { key: "ledger", label: "账本", icon: <BookOpen size={20} /> },
      { key: "assets", label: "资产", icon: <WalletCards size={20} /> },
      { key: "plan", label: "计划", icon: <CalendarRange size={20} /> },
    ],
  },
];

const pageTitles = {
  dashboard: "总览",
  ledger: "账本",
  assets: "资产",
  plan: "计划",
};

const colors = ["#214f3b", "#c8914b", "#78a88a", "#e3c183", "#6e8f7a", "#b46b4d"];
const accountCardPalette = ["forest", "sunset", "indigo", "teal", "plum", "coral", "ocean", "copper"];

const assetTypeLabels = {
  stock: "股票",
  fund: "基金",
  bond: "债券",
  cash: "现金",
  gold: "黄金 / 商品",
};

const quoteSourceLabels = {
  sina: "新浪",
  tencent: "腾讯",
  stooq: "Stooq",
  eastmoney_fund: "天天基金",
  multi: "多行情源",
};

const categoryIconMap = {
  居住: "🏡",
  餐饮: "🍜",
  购物: "🛍️",
  交通: "🚇",
  娱乐: "🎬",
  医疗健康: "💊",
  日用百货: "🧴",
  通讯网络: "📱",
  教育学习: "📚",
  人情礼物: "🎁",
  旅行出游: "✈️",
  运动健身: "🏃",
  宠物: "🐾",
  家庭育儿: "🧸",
  美容护理: "✨",
  保险税费: "🛡️",
  物业水电: "💡",
  车险油费: "⛽",
  数码家电: "💻",
  公益捐赠: "🤝",
  其他支出: "🧾",
  工资: "💼",
  奖金: "🏆",
  投资收益: "📈",
  副业收入: "🧩",
  报销退款: "↩️",
  租金收入: "🔑",
  红包礼金: "🧧",
  其他收入: "💰",
};

const accountTypeIcons = {
  debit_card: "💳",
  wallet: "👛",
  investment: "📈",
  deposit: "🏛️",
  credit_card: "💎",
};

const accountTypeLabels = {
  debit_card: "储蓄卡",
  wallet: "电子钱包",
  investment: "投资账户",
  deposit: "定期存款",
  credit_card: "信用卡",
};

const timeRangeLabels = {
  month: "本月",
  quarter: "本季",
  year: "今年",
  "6m": "近6月",
  "12m": "近12月",
};

const chartRangeOptions = {
  trend: [
    { value: "12m", label: "近12月" },
    { value: "6m", label: "近6月" },
    { value: "quarter", label: "本季" },
    { value: "month", label: "本月" },
  ],
  expense: [
    { value: "month", label: "本月" },
    { value: "quarter", label: "本季" },
    { value: "year", label: "今年" },
  ],
  cashflow: [
    { value: "month", label: "本月" },
    { value: "6m", label: "近6月" },
    { value: "12m", label: "近12月" },
  ],
  goal: [
    { value: "12m", label: "近12月" },
    { value: "6m", label: "近6月" },
    { value: "year", label: "今年" },
  ],
};

const transactions = [];
const investmentHoldings = [];
const assetAccounts = [];
const creditAccounts = [];
const accountDistribution = [];

const fallbackDashboard = {
  net_worth: 0,
  monthly_income: 0,
  monthly_expense: 0,
  monthly_balance: 0,
  savings_rate: 0,
  asset_allocation: [],
  trend: [],
  recent_transactions: [],
  budget: {
    total: 0,
    used: 0,
    left: 0,
    used_percent: 0,
  },
};

const fallbackInvestment = {
  total_value: 0,
  total_profit: 0,
  profit_rate: 0,
  cash_available: 0,
  cash_accounts: [],
  allocation: [],
  holdings: [],
  trend: [],
};

const fallbackExpense = {
  total_expense: 0,
  daily_average: 0,
  largest_category: null,
  categories: [],
  cashflow: [],
};

const fallbackIncome = {
  total_income: 0,
  daily_average: 0,
  largest_category: null,
  categories: [],
  trend: [],
};

const fallbackBudget = {
  total_budget: 0,
  total_used: 0,
  left: 0,
  used_percent: 0,
  items: [],
};

const fallbackGoals = {
  target_total: 0,
  current_total: 0,
  monthly_saving: 0,
  progress: 0,
  goals: [],
  plan: [],
};

function formatMoney(value) {
  return `¥${Math.round(value || 0).toLocaleString("zh-CN")}`;
}

function normalizeAccountOwner(owner) {
  return (owner || "").trim() || DEFAULT_ACCOUNT_OWNER;
}

function formatAccountLabel(account) {
  if (!account) return "未知账户";
  const owner = normalizeAccountOwner(account.owner || account.account_owner || account.institution);
  const name = account.name || account.account_name || "未知账户";
  return `${owner} · ${name}`;
}

function formatQuoteSources(result) {
  const sources = result?.sources?.length
    ? result.sources
    : (result?.details || [])
      .filter((item) => item.status === "updated" && item.source)
      .map((item) => item.source);
  const uniqueSources = Array.from(new Set(sources));
  if (!uniqueSources.length) return "多行情源";
  return uniqueSources.map((source) => quoteSourceLabels[source] || source).join("、");
}

function getCategoryIcon(name, icon, type = "expense") {
  if (icon && icon !== "•") return icon;
  if (categoryIconMap[name]) return categoryIconMap[name];
  if (name?.includes("餐") || name?.includes("饭")) return "🍜";
  if (name?.includes("咖啡")) return "☕";
  if (name?.includes("房") || name?.includes("租")) return "🏡";
  if (name?.includes("购") || name?.includes("买")) return "🛍️";
  if (name?.includes("车")) return "🚗";
  if (name?.includes("交通")) return "🚇";
  if (name?.includes("医") || name?.includes("药")) return "💊";
  if (name?.includes("学") || name?.includes("课")) return "📚";
  if (name?.includes("礼")) return "🎁";
  if (name?.includes("工资")) return "💼";
  if (name?.includes("投资")) return "📈";
  if (name?.includes("红包")) return "🧧";
  return type === "income" ? "💰" : "🧾";
}

function getGoalIcon(name, icon) {
  if (icon && !["◎", "目标"].includes(icon)) {
    const aliases = { 家: "🏡", 房: "🏡", 车: "🚗", 旅行: "✈️", 学习: "📚" };
    return aliases[icon] || icon;
  }
  if (name?.includes("旅行") || name?.includes("旅游")) return "✈️";
  if (name?.includes("车")) return "🚗";
  if (name?.includes("房") || name?.includes("家")) return "🏡";
  if (name?.includes("教育") || name?.includes("学习")) return "📚";
  if (name?.includes("养老") || name?.includes("退休")) return "🌿";
  if (name?.includes("应急") || name?.includes("备用")) return "🛟";
  if (name?.includes("婚")) return "💍";
  return "🎯";
}

function IconBadge({ icon, name, color, type = "expense", className = "" }) {
  return (
    <span className={`icon-badge ${className}`} style={{ "--icon-color": color || "#214f3b" }}>
      {getCategoryIcon(name, icon, type)}
    </span>
  );
}

function ChartRangeSwitch({ options, value, onChange }) {
  return (
    <div className="chart-range-switch">
      {options.map((option) => (
        <button type="button" className={value === option.value ? "active" : ""} key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getRangeLabel(options, value) {
  return options.find((option) => option.value === value)?.label || timeRangeLabels[value] || value;
}

function FormField({ label, help, children, wide = false }) {
  return (
    <label className={`form-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}

function ChartTooltip({ active, payload, label, title, labelFormatter, valueFormatter, names = {} }) {
  const rows = (payload || []).filter((item) => item.value !== undefined && item.value !== null && item.name !== "全部" && item.payload?.name !== "全部");
  if (!active || !rows.length) return null;
  const heading = labelFormatter ? labelFormatter(label, rows) : label;
  return (
    <div className="chart-tooltip-card">
      {(title || heading) && (
        <div className="chart-tooltip-title">
          {title && <span>{title}</span>}
          {heading && <strong>{heading}</strong>}
        </div>
      )}
      <div className="chart-tooltip-list">
        {rows.map((item) => {
          const rowName = names[item.dataKey] || item.payload?.name || item.name || item.dataKey;
          const displayValue = valueFormatter ? valueFormatter(item.value, item) : item.value;
          return (
            <div className="chart-tooltip-row" key={`${rowName}-${item.dataKey || item.name}`}>
              <span>
                <i style={{ background: item.color || item.payload?.color || "#214f3b" }} />
                {rowName}
              </span>
              <strong>{displayValue}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function formatDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatGoalDue(value) {
  if (!value) return "暂未设置期限";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月达成`;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function parsePickerValue(value, mode = "date") {
  const fallback = mode === "month" ? currentMonthValue() : todayInputValue();
  const normalized = value || fallback;
  return {
    year: Number(normalized.slice(0, 4)),
    month: Number(normalized.slice(5, 7)),
    day: mode === "month" ? 1 : Number(normalized.slice(8, 10) || 1),
  };
}

function formatDateButtonLabel(value, mode = "date") {
  if (!value) return mode === "month" ? "选择月份" : "选择日期";
  if (mode === "month") return formatMonthLabel(value);
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function buildPickerValue(parts, mode = "date") {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  if (mode === "month") return `${year}-${month}`;
  const maxDay = new Date(parts.year, parts.month, 0).getDate();
  const day = String(Math.min(parts.day || 1, maxDay)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addPickerMonths(parts, offset) {
  const date = new Date(parts.year, parts.month - 1 + offset, 1);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const maxDay = new Date(year, month, 0).getDate();
  return { year, month, day: Math.min(parts.day || 1, maxDay) };
}

function addMonthsValue(monthValue, offset) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRangeMonths(anchorMonth, rangeKey) {
  if (rangeKey === "quarter") {
    const [year, month] = anchorMonth.split("-").map(Number);
    const start = Math.floor((month - 1) / 3) * 3 + 1;
    return Array.from({ length: 3 }, (_, index) => `${year}-${String(start + index).padStart(2, "0")}`);
  }
  if (rangeKey === "year") {
    const year = anchorMonth.slice(0, 4);
    return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  }
  if (rangeKey === "6m") {
    return Array.from({ length: 6 }, (_, index) => addMonthsValue(anchorMonth, index - 5));
  }
  if (rangeKey === "12m") {
    return Array.from({ length: 12 }, (_, index) => addMonthsValue(anchorMonth, index - 11));
  }
  return [anchorMonth];
}

function isDateInRange(dateValue, anchorMonth, rangeKey) {
  if (!dateValue) return false;
  return getRangeMonths(anchorMonth, rangeKey).includes(dateValue.slice(0, 7));
}

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  return [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}

function formatMonthLabel(value) {
  if (!value) return "选择月份";
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function formatTrendLabel(value, index) {
  if (!value) return `M${index + 1}`;
  if (value.length === 10) return `${Number(value.slice(8, 10))}日`;
  if (value.length === 7) return `${Number(value.slice(5, 7))}月`;
  return value;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function createDefaultForm(selectedMonthValue = currentMonthValue(), overrides = {}) {
  return {
    name: "",
    code: "",
    buy_price: "",
    price: "",
    quantity: "",
    current_price: "",
    asset_type: "stock",
    market: "",
    currency: "CNY",
    exchange_rate_to_base: "1",
    account_owner: DEFAULT_ACCOUNT_OWNER,
    account_id: "",
    category_name: "",
    amount: "",
    direction: "expense",
    occurred_at: todayInputValue(),
    merchant: "",
    note: "",
    type: "debit_card",
    owner: DEFAULT_ACCOUNT_OWNER,
    balance: "",
    opening_date: todayInputValue(),
    last4: "",
    credit_limit: "",
    statement_day: "",
    repayment_day: "",
    is_liability: "false",
    from_account_owner: DEFAULT_ACCOUNT_OWNER,
    from_account_id: "",
    to_account_owner: DEFAULT_ACCOUNT_OWNER,
    to_account_id: "",
    month: selectedMonthValue,
    target_amount: "",
    current_amount: "",
    monthly_saving: "",
    due_date: "",
    status: "active",
    actual_balance: "",
    expected_balance: "",
    to_amount: "",
    repayment_account_id: "",
    settlement_rate: "",
    reason: "",
    trade_type: "buy",
    fee: "0",
    holding_id: "",
    goal_id: "",
    goal_record_type: "deposit",
    icon: "",
    color: "#214f3b",
    ...overrides,
  };
}

function App() {
  const [holdings, setHoldings] = useState([]);
  const [dashboardData, setDashboardData] = useState(fallbackDashboard);
  const [accountsData, setAccountsData] = useState({
    asset_total: 0,
    liability_total: 0,
    net_worth: 0,
    accounts: [],
    distribution: [],
  });
  const [investmentData, setInvestmentData] = useState(fallbackInvestment);
  const [incomeData, setIncomeData] = useState(fallbackIncome);
  const [expenseData, setExpenseData] = useState(fallbackExpense);
  const [budgetData, setBudgetData] = useState(fallbackBudget);
  const [goalsData, setGoalsData] = useState(fallbackGoals);
  const [categoriesData, setCategoriesData] = useState([]);
  const [transactionData, setTransactionData] = useState([]);
  const [ledgerData, setLedgerData] = useState([]);
  const [investmentTrades, setInvestmentTrades] = useState([]);
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState("all");
  const [tradeAccountFilter, setTradeAccountFilter] = useState("all");
  const [importPreview, setImportPreview] = useState(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [reversalTarget, setReversalTarget] = useState(null);
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem(AUTH_TOKEN_KEY)));
  const [password, setPassword] = useState("");
  const [activePage, setActivePage] = useState("dashboard");
  const [assetSection, setAssetSection] = useState("accounts");
  const [planSection, setPlanSection] = useState("budget");
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cashDrafts, setCashDrafts] = useState({});
  const [isCashEditorOpen, setIsCashEditorOpen] = useState(false);
  const [savingCashAccountId, setSavingCashAccountId] = useState(null);
  const [dataLoadError, setDataLoadError] = useState("");
  const [quoteRefreshResult, setQuoteRefreshResult] = useState(null);
  const [accountDetail, setAccountDetail] = useState(null);
  const [goalRecords, setGoalRecords] = useState(null);
  const [budgetDrafts, setBudgetDrafts] = useState({});
  const [isSavingBudgets, setIsSavingBudgets] = useState(false);
  const [actionMode, setActionMode] = useState("transaction");
  const [editTarget, setEditTarget] = useState(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState(null);
  const [datePickerDraftParts, setDatePickerDraftParts] = useState(() => parsePickerValue(currentMonthValue(), "month"));
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue());
  const [dashboardTrendRange, setDashboardTrendRange] = useState("12m");
  const [investmentTrendRange, setInvestmentTrendRange] = useState("12m");
  const [incomeChartRange, setIncomeChartRange] = useState("month");
  const [incomeTrendRange, setIncomeTrendRange] = useState("month");
  const [expenseChartRange, setExpenseChartRange] = useState("month");
  const [cashflowRange, setCashflowRange] = useState("month");
  const [goalPlanRange, setGoalPlanRange] = useState("12m");
  const [holdingFilter, setHoldingFilter] = useState("全部");
  const [selectedIncomeCategory, setSelectedIncomeCategory] = useState(null);
  const [incomeOrderSearch, setIncomeOrderSearch] = useState("");
  const [incomeAccountFilter, setIncomeAccountFilter] = useState("all");
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState(null);
  const [paymentOrderSearch, setPaymentOrderSearch] = useState("");
  const [paymentAccountFilter, setPaymentAccountFilter] = useState("all");
  const autoQuoteRefreshRef = useRef({ app: false, invest: false });
  const cashDirtyAccountIdsRef = useRef(new Set());
  const loadVersionRef = useRef(0);

  const [form, setForm] = useState(() => createDefaultForm());

  const loadData = useCallback(async (options = {}) => {
    const loadVersion = ++loadVersionRef.current;
    const monthQuery = `?month=${selectedMonth}`;
    const dashboardQuery = `?month=${selectedMonth}&trend_range=${dashboardTrendRange}`;
    const investmentQuery = `?month=${selectedMonth}&trend_range=${investmentTrendRange}`;
    const incomeQuery = `?month=${selectedMonth}&income_range=${incomeChartRange}&trend_range=${incomeTrendRange}`;
    const expenseQuery = `?month=${selectedMonth}&expense_range=${expenseChartRange}&cashflow_range=${cashflowRange}`;
    const goalsQuery = `?month=${selectedMonth}&plan_range=${goalPlanRange}`;
    const transactionQuery = `?month=${selectedMonth}&range_key=year`;
    const [
      holdingsResult,
      dashboardResult,
      accountsResult,
      investmentResult,
      incomeResult,
      expenseResult,
      budgetResult,
      goalsResult,
      categoriesResult,
      transactionsResult,
      ledgerResult,
      tradesResult,
    ] = await Promise.allSettled([
      fetchJson("/holdings"),
      fetchJson(`/dashboard/summary${dashboardQuery}`),
      fetchJson("/accounts/overview"),
      fetchJson(`/investments/summary${investmentQuery}`),
      fetchJson(`/income/analysis${incomeQuery}`),
      fetchJson(`/expenses/analysis${expenseQuery}`),
      fetchJson(`/budgets/monthly${monthQuery}`),
      fetchJson(`/goals${goalsQuery}`),
      fetchJson("/categories"),
      fetchJson(`/transactions${transactionQuery}`),
      !options.background || activePage === "ledger" ? fetchJson("/ledger") : Promise.resolve(null),
      !options.background || (activePage === "assets" && assetSection === "investments") ? fetchJson("/investments/trades") : Promise.resolve(null),
    ]);
    if (loadVersion !== loadVersionRef.current) return;
    if (holdingsResult.status === "fulfilled") {
      setHoldings(holdingsResult.value);
    }
    if (dashboardResult.status === "fulfilled") {
      setDashboardData({ ...fallbackDashboard, ...dashboardResult.value });
    }
    if (accountsResult.status === "fulfilled") {
      setAccountsData(accountsResult.value);
    }
    if (investmentResult.status === "fulfilled") {
      setInvestmentData({ ...fallbackInvestment, ...investmentResult.value });
      setCashDrafts((current) => Object.fromEntries(
        (investmentResult.value.cash_accounts || []).map((account) => [
          account.id,
          cashDirtyAccountIdsRef.current.has(account.id)
            ? (current[account.id] ?? "")
            : String(account.cash_available_original ?? account.cash_available ?? 0),
        ]),
      ));
      if (investmentResult.value.holdings?.length) {
        setHoldings(investmentResult.value.holdings);
      }
    }
    if (incomeResult.status === "fulfilled") {
      setIncomeData({ ...fallbackIncome, ...incomeResult.value });
    }
    if (expenseResult.status === "fulfilled") {
      setExpenseData({ ...fallbackExpense, ...expenseResult.value });
    }
    if (budgetResult.status === "fulfilled") {
      setBudgetData({ ...fallbackBudget, ...budgetResult.value });
    }
    if (goalsResult.status === "fulfilled") {
      setGoalsData({ ...fallbackGoals, ...goalsResult.value });
    }
    if (categoriesResult.status === "fulfilled") {
      setCategoriesData(categoriesResult.value);
    }
    if (transactionsResult.status === "fulfilled") {
      setTransactionData(transactionsResult.value);
    }
    if (ledgerResult.status === "fulfilled" && ledgerResult.value !== null) {
      setLedgerData(ledgerResult.value);
    }
    if (tradesResult.status === "fulfilled" && tradesResult.value !== null) {
      setInvestmentTrades(tradesResult.value);
    }
    const requestNames = ["持仓", "看板", "账户", "投资", "收入分析", "支出分析", "预算", "目标", "分类", "收支流水", "完整账本", "投资交易"];
    const failures = [
      holdingsResult,
      dashboardResult,
      accountsResult,
      investmentResult,
      incomeResult,
      expenseResult,
      budgetResult,
      goalsResult,
      categoriesResult,
      transactionsResult,
      ledgerResult,
      tradesResult,
    ].flatMap((result, index) => (
      result.status === "rejected" ? [`${requestNames[index]}：${result.reason?.message || "加载失败"}`] : []
    ));
    setDataLoadError(failures.join("；"));
  }, [activePage, assetSection, cashflowRange, dashboardTrendRange, expenseChartRange, goalPlanRange, incomeChartRange, incomeTrendRange, investmentTrendRange, selectedMonth]);

  useEffect(() => {
    if (loggedIn) loadData();
  }, [loadData, loggedIn]);

  useEffect(() => {
    if (!loggedIn) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        loadData({ background: true });
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 30000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData, loggedIn]);

  const handleLogin = async () => {
    try {
      const res = await fetch(apiUrl("/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error(`登录失败 ${res.status}`);
      const data = await res.json();
      if (data.ok && data.access_token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
        setLoggedIn(true);
      } else {
        alert("密码错误");
      }
    } catch (error) {
      alert(error.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setLoggedIn(false);
    setPassword("");
  };

  const accountOwnerOptions = useMemo(() => {
    const owners = (accountsData?.accounts || []).map((account) => normalizeAccountOwner(account.owner || account.institution));
    return Array.from(new Set(owners.length ? owners : [DEFAULT_ACCOUNT_OWNER]));
  }, [accountsData?.accounts]);

  const getAccountById = useCallback((accountId) => (
    (accountsData?.accounts || []).find((account) => String(account.id) === String(accountId))
  ), [accountsData?.accounts]);

  const getFirstAccountIdByOwner = useCallback((owner, predicate = () => true) => {
    const normalizedOwner = normalizeAccountOwner(owner);
    const account = (accountsData?.accounts || []).find(
      (item) => normalizeAccountOwner(item.owner || item.institution) === normalizedOwner && predicate(item),
    );
    return account?.id ? String(account.id) : "";
  }, [accountsData?.accounts]);

  const accountBelongsToOwner = useCallback((accountId, owner) => {
    const account = getAccountById(accountId);
    return account && normalizeAccountOwner(account.owner || account.institution) === normalizeAccountOwner(owner);
  }, [getAccountById]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((current) => {
      const next = {
        ...current,
        [name]: value,
        ...(name === "direction" ? { category_name: "" } : {}),
      };
      if (name === "account_owner" && !accountBelongsToOwner(current.account_id, value)) {
        next.account_id = getFirstAccountIdByOwner(
          value,
          ["holding", "new_trade"].includes(actionMode) ? (account) => !account.is_liability && account.type === "investment" : undefined,
        );
      }
      if (name === "from_account_owner" && !accountBelongsToOwner(current.from_account_id, value)) {
        next.from_account_id = getFirstAccountIdByOwner(value);
      }
      if (name === "to_account_owner" && !accountBelongsToOwner(current.to_account_id, value)) {
        next.to_account_id = getFirstAccountIdByOwner(value);
      }
      if (name === "account_id") {
        const account = getAccountById(value);
        if (account) {
          next.account_owner = normalizeAccountOwner(account.owner || account.institution);
          if (actionMode === "adjustment") {
            next.actual_balance = String(
              account.type === "investment"
                ? (account.cash_available_original ?? 0)
                : (account.original_balance ?? account.balance ?? 0),
            );
            next.expected_balance = next.actual_balance;
          }
        }
      }
      if (name === "from_account_id") {
        const account = getAccountById(value);
        if (account) next.from_account_owner = normalizeAccountOwner(account.owner || account.institution);
      }
      if (name === "to_account_id") {
        const account = getAccountById(value);
        if (account) next.to_account_owner = normalizeAccountOwner(account.owner || account.institution);
      }
      if (name === "type") {
        next.is_liability = value === "credit_card" ? "true" : "false";
      }
      if (name === "currency" && value.trim().toUpperCase() === "CNY") {
        next.exchange_rate_to_base = "1";
      }
      if (actionMode === "transfer" && ["from_account_id", "from_account_owner", "to_account_id", "to_account_owner"].includes(name)) {
        const source = getAccountById(next.from_account_id);
        const target = getAccountById(next.to_account_id);
        if (next.repayment_account_id && String(target?.id) === next.repayment_account_id) {
          Object.assign(next, repaymentDraft(source, target));
        } else {
          next.amount = "";
          next.to_amount = "";
          next.repayment_account_id = "";
        }
      }
      if (["account_id", "account_owner", "currency"].includes(name)) next.settlement_rate = "";
      return next;
    });
  };

  const openAction = (mode, overrides = {}) => {
    if (submitLock.current) return;
    const activeAccounts = accountsData?.accounts || [];
    const recentAccountId = localStorage.getItem(RECENT_ACCOUNT_KEY);
    const recentAccount = activeAccounts.find((account) => String(account.id) === recentAccountId);
    const cashAccount = recentAccount
      || activeAccounts.find((account) => !account.is_liability && ["debit_card", "wallet"].includes(account.type))
      || activeAccounts.find((account) => !account.is_liability)
      || activeAccounts[0];
    const investmentAccount = activeAccounts.find((account) => !account.is_liability && account.type === "investment")
      || cashAccount;
    const transferTarget = activeAccounts.find((account) => account.id !== cashAccount?.id);
    const defaults = {
      transaction: {
        account_owner: normalizeAccountOwner(cashAccount?.owner || cashAccount?.institution),
        account_id: cashAccount?.id ? String(cashAccount.id) : "",
        direction: "expense",
      },
      holding: {
        account_owner: normalizeAccountOwner(investmentAccount?.owner || investmentAccount?.institution),
        account_id: investmentAccount?.id ? String(investmentAccount.id) : "",
        asset_type: "stock",
      },
      new_trade: {
        account_owner: normalizeAccountOwner(investmentAccount?.owner),
        account_id: investmentAccount?.type === "investment" ? String(investmentAccount.id) : "",
        currency: investmentAccount?.currency || "CNY",
        exchange_rate_to_base: String(investmentAccount?.exchange_rate_to_base || 1),
      },
      transfer: {
        from_account_owner: normalizeAccountOwner(cashAccount?.owner || cashAccount?.institution),
        from_account_id: cashAccount?.id ? String(cashAccount.id) : "",
        to_account_owner: normalizeAccountOwner(transferTarget?.owner || transferTarget?.institution),
        to_account_id: transferTarget?.id ? String(transferTarget.id) : "",
      },
      adjustment: {
        account_id: cashAccount?.id ? String(cashAccount.id) : "",
        actual_balance: cashAccount?.type === "investment"
          ? String(cashAccount.cash_available_original ?? 0)
          : String(cashAccount?.original_balance ?? cashAccount?.balance ?? 0),
        expected_balance: String(originalBalance(cashAccount)),
      },
    };
    if (mode === "transfer" && activeAccounts.length < 2) {
      alert("至少需要两个账户，才能进行资金划转。");
      return;
    }
    setActionMode(mode);
    setEditTarget(null);
    setForm(createDefaultForm(selectedMonth, { ...(defaults[mode] || {}), ...overrides }));
    setIsAdding(true);
  };

  const closeActionPanel = (force = false) => {
    if (submitLock.current && force !== true) return;
    setIsAdding(false);
    setEditTarget(null);
  };

  const openEditAction = (type, item) => {
    if (!item?.id || submitLock.current) return;
    setActionMode(type);
    setEditTarget({ type, id: item.id });
    setForm(createDefaultForm(selectedMonth, {
      name: item.name || "",
      code: item.rawCode || item.code || "",
      buy_price: item.buy_price ?? "",
      quantity: item.quantity ?? "",
      current_price: item.current_price ?? "",
      asset_type: item.asset_type || "stock",
      market: item.market || "",
      currency: item.currency || "CNY",
      exchange_rate_to_base: item.exchange_rate_to_base ?? 1,
      account_owner: normalizeAccountOwner(item.account_owner || getAccountById(item.account_id)?.owner || getAccountById(item.account_id)?.institution),
      account_id: item.account_id ? String(item.account_id) : "",
      category_name: item.category_name || item.name || "",
      amount: item.rawAmount ?? item.amount ?? item.budget ?? "",
      direction: item.direction || "expense",
      occurred_at: item.occurred_at?.slice(0, 10) || todayInputValue(),
      merchant: item.merchant || "",
      note: item.note || "",
      type: item.type || "debit_card",
      owner: normalizeAccountOwner(item.owner || item.institution),
      balance: item.balance ?? "",
      last4: item.last4 || "",
      credit_limit: item.credit_limit ?? "",
      statement_day: item.statement_day ?? "",
      repayment_day: item.repayment_day ?? "",
      is_liability: item.is_liability ? "true" : "false",
      month: item.month || selectedMonth,
      target_amount: item.target_amount ?? "",
      current_amount: item.current_amount ?? "",
      monthly_saving: item.monthly_saving ?? "",
      due_date: item.due_date || "",
      status: item.status || "active",
      icon: item.icon || "",
      color: item.color || "#214f3b",
      opening_date: item.opened_at || todayInputValue(),
    }));
    setIsAdding(true);
  };

  const openAccountDetail = async (account) => {
    try {
      const detail = await fetchJson(`/accounts/${account.id}`);
      setAccountDetail(detail);
    } catch (error) {
      alert(`加载账户详情失败：${error.message}`);
    }
  };

  const openAdjustment = (account) => {
    const currentBalance = account.type === "investment"
      ? (account.cash_available_original ?? 0)
      : (account.original_balance ?? account.balance ?? 0);
    setAccountDetail(null);
    openAction("adjustment", {
      account_id: String(account.id),
      actual_balance: String(currentBalance),
      expected_balance: String(currentBalance),
    });
  };

  const openRepayment = (creditAccount) => {
    const source = (accountsData.accounts || []).find(
      (account) => !account.is_liability && account.type !== "investment",
    ) || (accountsData.accounts || []).find((account) => !account.is_liability);
    openAction("transfer", {
      from_account_owner: normalizeAccountOwner(source?.owner || source?.institution),
      from_account_id: source?.id ? String(source.id) : "",
      to_account_owner: normalizeAccountOwner(creditAccount.owner || creditAccount.institution),
      to_account_id: String(creditAccount.id),
      ...repaymentDraft(source, creditAccount),
      repayment_account_id: String(creditAccount.id),
      note: `${creditAccount.name}还款`,
    });
  };

  const openTradeAction = (holding, tradeType) => {
    openAction("trade", {
      holding_id: String(holding.id),
      account_id: String(holding.account_id || ""),
      currency: holding.currency || "CNY",
      exchange_rate_to_base: String(holding.exchange_rate_to_base || 1),
      name: holding.name,
      code: holding.rawCode || holding.code,
      trade_type: tradeType,
      price: String(holding.current_price || ""),
      quantity: "",
      fee: "0",
    });
  };

  const openGoalRecord = (goal, recordType) => {
    openAction("goal_record", {
      goal_id: String(goal.id),
      name: goal.name,
      goal_record_type: recordType,
      amount: "",
    });
  };

  const openGoalRecords = async (goal) => {
    try {
      const records = await fetchJson(`/goals/${goal.id}/records`);
      setGoalRecords({ goal, records });
    } catch (error) {
      alert(`加载目标记录失败：${error.message}`);
    }
  };

  const handleGoalStatus = async (goal, status) => {
    if (status === "archived" && !window.confirm(`归档“${goal.name}”后将不能继续存取，确认归档吗？`)) return;
    try {
      await patchJson(`/goals/${goal.id}/status`, { status });
      await loadData();
    } catch (error) {
      alert(`更新目标状态失败：${error.message}`);
    }
  };

  const setBudgetDraft = (id, value) => {
    setBudgetDrafts((current) => ({ ...current, [id]: value }));
  };

  const handleSaveBudgetBatch = async () => {
    const submitted = Object.fromEntries(budgetCategoriesView
      .filter((item) => Object.hasOwn(budgetDrafts, item.id))
      .map((item) => [item.id, budgetDrafts[item.id]]));
    const items = Object.entries(submitted).map(([id, value]) => ({ id: Number(id), amount: value.trim() === "" ? NaN : Number(value) }));
    if (!items.length) return;
    if (items.some((item) => !Number.isFinite(item.amount) || item.amount < 0)) {
      alert("预算金额必须是大于或等于零的数字");
      return;
    }
    try {
      setIsSavingBudgets(true);
      await patchJson("/budgets/batch", { items });
      await loadData();
      setBudgetDrafts((current) => clearSavedBudgetDrafts(current, submitted));
    } catch (error) {
      alert(`批量调整失败：${error.message}`);
    } finally {
      setIsSavingBudgets(false);
    }
  };

  const cancelBudgetDrafts = () => {
    setBudgetDrafts((current) => {
      const next = { ...current };
      budgetCategoriesView.forEach((item) => delete next[item.id]);
      return next;
    });
  };

  const handleCopyPreviousBudget = async () => {
    try {
      const result = await postJson("/budgets/copy", {
        source_month: addMonthsValue(selectedMonth, -1),
        target_month: selectedMonth,
        overwrite: false,
      });
      await loadData();
      alert(result.skipped ? `已沿用 ${result.copied} 项，跳过 ${result.skipped} 项已有预算。` : result.message);
    } catch (error) {
      alert(`沿用上月预算失败：${error.message}`);
    }
  };

  const handleDownloadLedger = () => downloadFile("/ledger/export", "invest-ledger.csv")
    .catch((error) => alert(`导出流水失败：${error.message}`));

  const handleDownloadBackup = () => downloadFile("/warehouse/backup", `invest-backup-${todayInputValue()}.json`)
    .catch((error) => alert(`下载备份失败：${error.message}`));

  const handleStatementImport = async (rows, skipped = 0) => {
    if (!rows.length) {
      alert(`账单中没有可导入的收支流水${skipped ? `，已排除 ${skipped} 条转账、期初、调整或已撤销记录。完整迁移请使用 JSON 备份恢复` : ""}`);
      return;
    }
    try {
      const preview = await postJson("/transactions/import/preview", {
        rows,
        skip_duplicates: true,
      });
      setImportPreview({ ...preview, skipped });
    } catch (error) {
      alert(`导入账单失败：${error.message}`);
    }
  };

  const openDatePicker = () => {
    openDateSelector({
      field: "selectedMonth",
      mode: "month",
      value: selectedMonth,
      label: "数据月份",
      help: "会同步筛选基本看板、收入分析、支出分析和预算管理中按月份统计的数据。",
      scope: "filter",
    });
  };

  const openDateSelector = ({ field, mode = "date", value, label, help, allowClear = false, scope = "form" }) => {
    setDatePickerTarget({ field, mode, label, help, allowClear, scope });
    setDatePickerDraftParts(parsePickerValue(value, mode));
    setSelectedIncomeCategory(null);
    setSelectedExpenseCategory(null);
    setIsDatePickerOpen(true);
  };

  const handleApplyDatePicker = () => {
    if (!datePickerTarget) return;
    const nextValue = buildPickerValue(datePickerDraftParts, datePickerTarget.mode);
    if (datePickerTarget.scope === "filter") {
      setSelectedMonth(nextValue);
      setForm((value) => ({ ...value, month: nextValue }));
      setSelectedIncomeCategory(null);
      setSelectedExpenseCategory(null);
    } else {
      setForm((value) => ({ ...value, [datePickerTarget.field]: nextValue }));
    }
    setIsDatePickerOpen(false);
  };

  const handleUseTodayInPicker = () => {
    const value = datePickerTarget?.mode === "month" ? currentMonthValue() : todayInputValue();
    setDatePickerDraftParts(parsePickerValue(value, datePickerTarget?.mode || "date"));
  };

  const handleClearDatePicker = () => {
    if (!datePickerTarget?.allowClear) return;
    setForm((value) => ({ ...value, [datePickerTarget.field]: "" }));
    setIsDatePickerOpen(false);
  };

  const handleExportExpense = () => {
    const rows = visibleExpenseCategories.map((item) => `${item.name},${item.value},${item.percent}%`).join("\n");
    const blob = new Blob([`分类,金额,占比\n${rows}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expense-report-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportIncome = () => {
    const rows = visibleIncomeCategories.map((item) => `${item.name},${item.value},${item.percent}%`).join("\n");
    const blob = new Blob([`分类,金额,占比\n${rows}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `income-report-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveInvestmentCash = async (accountId) => {
    const rawValue = cashDrafts[accountId] ?? "0";
    const nextValue = Number(rawValue || 0);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      alert("现金可投金额不能为负数");
      return;
    }
    try {
      setSavingCashAccountId(accountId);
      await patchJson("/investments/cash-available", {
        account_id: Number(accountId),
        cash_available: nextValue,
      });
      cashDirtyAccountIdsRef.current.delete(accountId);
      await loadData();
    } catch (error) {
      alert(`保存现金可投失败：${error.message}`);
    } finally {
      setSavingCashAccountId(null);
    }
  };

  const handleDelete = async (type, id) => {
    if (!id) return;
    const labelMap = {
      account: "账户",
      transaction: "流水",
      holding: "持仓",
      budget: "预算",
      goal: "目标",
    };
    if (!window.confirm(type === "account" ? "确定归档这个账户吗？需要先清空余额和持仓，历史记录会保留。" : `确定删除这条${labelMap[type] || "数据"}吗？`)) return;
    const pathMap = {
      account: `/accounts/${id}`,
      transaction: `/transactions/${id}`,
      holding: `/holdings/${id}`,
      budget: `/budgets/${id}`,
      goal: `/goals/${id}`,
    };
    try {
      await deleteJson(pathMap[type]);
      closeActionPanel();
      await loadData();
    } catch (error) {
      alert(`删除失败：${error.message}`);
    }
  };

  const resetActionForm = () => {
    setForm(createDefaultForm(selectedMonth));
  };

  const handleSubmitAction = async (options = {}) => {
    if (submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const keepOpen = options?.keepOpen === true;
      const isEditing = Boolean(editTarget);
      const shouldRefreshQuotesAfterSave = actionMode === "holding" && ["stock", "fund"].includes(form.asset_type);
      if (actionMode === "transaction") {
        if (!form.account_id || !form.amount) {
          alert("请先选择账户并填写金额");
          return;
        }
        const payload = {
          account_id: Number(form.account_id),
          category_name: form.category_name || null,
          amount: Number(form.amount),
          direction: form.direction,
          occurred_at: form.occurred_at,
          merchant: form.merchant,
          note: form.note,
        };
        await (isEditing ? patchJson(`/transactions/${editTarget.id}`, payload) : postJson("/transactions", payload));
        localStorage.setItem(RECENT_ACCOUNT_KEY, String(form.account_id));
      }
      if (actionMode === "holding") {
        if (!form.name || !form.code) {
          alert("请至少填写名称和代码");
          return;
        }
        const payload = {
          name: form.name,
          code: form.code,
          buy_price: Number(form.buy_price),
          quantity: Number(form.quantity),
          current_price: ["stock", "fund"].includes(form.asset_type)
            ? Number(form.current_price || form.buy_price || 0)
            : Number(form.current_price || 0),
          account_id: form.account_id ? Number(form.account_id) : null,
          asset_type: form.asset_type,
          market: form.market || null,
          currency: form.currency,
          exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
        };
        await (isEditing ? patchJson(`/holdings/${editTarget.id}`, payload) : postJson("/holdings", payload));
      }
      if (actionMode === "account") {
        if (!form.name) {
          alert("请填写账户名称");
          return;
        }
        const payload = {
          name: form.name,
          type: form.type,
          owner: normalizeAccountOwner(form.owner),
          currency: form.currency,
          exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
          last4: form.last4,
          credit_limit: Number(form.credit_limit || 0),
          statement_day: form.statement_day ? Number(form.statement_day) : null,
          repayment_day: form.repayment_day ? Number(form.repayment_day) : null,
          is_liability: form.type === "credit_card" || form.is_liability === "true",
          balance: isEditing ? 0 : Number(form.balance || 0),
          opening_date: form.opening_date,
        };
        await (isEditing ? patchJson(`/accounts/${editTarget.id}`, payload) : postJson("/accounts", payload));
      }
      if (actionMode === "adjustment") {
        if (!form.account_id || form.actual_balance === "" || !form.reason.trim()) {
          alert("请填写核对后余额和调整原因");
          return;
        }
        await postJson(`/accounts/${form.account_id}/adjustments`, {
          actual_balance: Number(form.actual_balance),
          expected_balance: form.expected_balance === "" ? null : Number(form.expected_balance),
          occurred_at: form.occurred_at,
          reason: form.reason.trim(),
        });
      }
      if (actionMode === "transfer") {
        if (!form.from_account_id || !form.to_account_id || !form.amount) {
          alert("请选择转出/转入账户并填写金额");
          return;
        }
        const sameCurrency = accountCurrency(getAccountById(form.from_account_id)) === accountCurrency(getAccountById(form.to_account_id));
        if (!sameCurrency && !(Number(form.to_amount) > 0)) {
          alert("请填写转入账户实际到账金额");
          return;
        }
        await postJson("/accounts/transfer", {
          from_account_id: Number(form.from_account_id),
          to_account_id: Number(form.to_account_id),
          amount: Number(form.amount),
          to_amount: sameCurrency ? Number(form.amount) : Number(form.to_amount),
          occurred_at: form.occurred_at,
          note: form.note,
        });
      }
      if (["trade", "new_trade"].includes(actionMode)) {
        if ((actionMode === "trade" && !form.holding_id) || !form.quantity || !form.price) {
          alert("请填写交易数量和成交价格");
          return;
        }
        if (actionMode === "new_trade" && (!form.name.trim() || !form.code.trim() || !form.account_id)) {
          alert("请填写名称、代码并选择投资账户");
          return;
        }
        await postJson("/investments/trades", {
          ...(actionMode === "new_trade" ? {
            new_holding: {
              name: form.name.trim(), code: form.code.trim(), account_id: Number(form.account_id),
              asset_type: form.asset_type, market: form.market || null, currency: form.currency,
              exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
              buy_price: Number(form.price), current_price: Number(form.price), quantity: Number(form.quantity),
            },
          } : { holding_id: Number(form.holding_id) }),
          trade_type: actionMode === "new_trade" ? "buy" : form.trade_type,
          quantity: Number(form.quantity),
          price: Number(form.price),
          fee: Number(form.fee || 0),
          settlement_rate: accountCurrency(form) === accountCurrency(getAccountById(form.account_id))
            ? 1 : (form.settlement_rate ? Number(form.settlement_rate) : null),
          occurred_at: form.occurred_at,
          note: form.note,
        });
      }
      if (actionMode === "budget") {
        if (!form.category_name || !form.amount) {
          alert("请填写分类和预算金额");
          return;
        }
        const payload = {
          month: form.month,
          category_name: form.category_name,
          amount: Number(form.amount),
        };
        await (isEditing ? patchJson(`/budgets/${editTarget.id}`, payload) : postJson("/budgets", payload));
        if (isEditing) {
          setBudgetDrafts((current) => clearSavedBudgetDrafts(current, { [editTarget.id]: budgetDrafts[editTarget.id] }));
        }
      }
      if (actionMode === "goal") {
        if (!form.name || !form.target_amount) {
          alert("请填写目标名称和目标金额");
          return;
        }
        const payload = {
          name: form.name,
          target_amount: Number(form.target_amount),
          ...(!isEditing ? { current_amount: Number(form.current_amount || 0), status: "active" } : {}),
          monthly_saving: Number(form.monthly_saving || 0),
          due_date: form.due_date || null,
        };
        await (isEditing ? patchJson(`/goals/${editTarget.id}`, payload) : postJson("/goals", payload));
      }
      if (actionMode === "goal_record") {
        if (!form.goal_id || !form.amount) {
          alert("请填写存取金额");
          return;
        }
        const amount = Math.abs(Number(form.amount)) * (form.goal_record_type === "withdraw" ? -1 : 1);
        await postJson(`/goals/${form.goal_id}/records`, {
          amount,
          recorded_at: form.occurred_at,
          note: form.note,
        });
      }
      await loadData();
      if (keepOpen && actionMode === "transaction" && !isEditing) {
        setForm((current) => createDefaultForm(selectedMonth, {
          account_id: current.account_id,
          account_owner: current.account_owner,
          direction: current.direction,
          occurred_at: current.occurred_at,
        }));
      } else {
        resetActionForm();
        closeActionPanel(true);
      }
      if (shouldRefreshQuotesAfterSave) {
        await handleRefresh({ silent: true });
      }
    } catch (error) {
      alert(`保存失败：${error.message}`);
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  const totalCost = useMemo(
    () => holdings.filter((item) => item.included_in_totals !== 0).reduce(
      (sum, item) => sum + (
        item.cost
        ?? (item.buy_price || 0) * (item.quantity || 0) * (item.exchange_rate_to_base || 1)
      ),
      0,
    ),
    [holdings],
  );
  const totalProfit = useMemo(
    () => holdings.filter((item) => item.included_in_totals !== 0).reduce((sum, item) => sum + item.profit, 0),
    [holdings],
  );
  const profitRate = totalCost ? (totalProfit / totalCost) * 100 : 0;
  const monthlyIncome = dashboardData.monthly_income;
  const monthlyExpense = dashboardData.monthly_expense;
  const budgetTotal = dashboardData.budget?.total ?? 0;
  const budgetLeft = dashboardData.monthly_balance;
  const savingsRate = dashboardData.savings_rate;
  const netWorth = dashboardData.net_worth;
  const budgetPercent = budgetTotal ? monthlyExpense / budgetTotal * 100 : 0;
  const trendData = (dashboardData.trend || fallbackDashboard.trend).map((item, index) => ({
    month: formatTrendLabel(item.date, index),
    value: Math.round((item.value || 0) / 1000) / 10,
  }));
  const assetData = (dashboardData.asset_allocation || fallbackDashboard.asset_allocation).map((item) => ({
    name: item.name,
    value: item.percent,
    amount: item.value,
  }));
  const dashboardTransactionSource = transactionData.length
    ? transactionData.filter((item) => isDateInRange(item.occurred_at, selectedMonth, "month")).slice(0, 5)
    : dashboardData.recent_transactions;
  const dashboardTransactions = dashboardTransactionSource
    ? dashboardTransactionSource.map((item) => ({
      id: item.id,
      account_id: item.account_id,
      category_id: item.category_id,
      category_name: item.category_name || "",
      name: item.merchant || item.note || item.category_name || "未命名流水",
      account: `${item.category_name || "未分类"} · ${formatAccountLabel(item)}`,
      amount: item.direction === "expense"
        ? -(item.base_amount ?? item.amount)
        : (item.base_amount ?? item.amount),
      rawAmount: item.amount,
      direction: item.direction,
      occurred_at: item.occurred_at,
      merchant: item.merchant || "",
      note: item.note || "",
      date: formatDateLabel(item.occurred_at),
      icon: getCategoryIcon(item.category_name, item.icon, item.direction),
      color: item.color || (item.direction === "income" ? "#214f3b" : "#c8914b"),
    }))
    : transactions;
  const assetAccountsView = accountsData?.accounts?.filter((account) => !account.is_liability).map((account, index) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    owner: normalizeAccountOwner(account.owner || account.institution),
    currency: account.currency || "CNY",
    exchange_rate_to_base: account.exchange_rate_to_base ?? 1,
    cash_available: account.cash_available || 0,
    cash_available_original: account.cash_available_original ?? account.cash_available ?? 0,
    holdings_value: account.holdings_value || 0,
    bank: account.type === "investment"
      ? `持仓 ${formatMoney(account.holdings_value || 0)} · 现金可投 ${formatMoney(account.cash_available || 0)}`
      : `${accountTypeLabels[account.type] || "账户"}${account.last4 ? ` ···· ${account.last4}` : ""}`,
    balance: account.balance,
    original_balance: account.original_balance ?? account.balance,
    opened_at: account.opened_at,
    last4: account.last4,
    credit_limit: account.credit_limit,
    statement_day: account.statement_day,
    repayment_day: account.repayment_day,
    is_liability: account.is_liability,
    color: accountCardPalette[index % accountCardPalette.length],
    icon: accountTypeIcons[account.type] || "🏦",
  })) || assetAccounts;
  const creditAccountsView = accountsData?.accounts?.filter((account) => account.is_liability).map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    owner: normalizeAccountOwner(account.owner || account.institution),
    currency: account.currency || "CNY",
    exchange_rate_to_base: account.exchange_rate_to_base ?? 1,
    code: `··· ${account.last4 || "----"} · 额度${Math.round((account.credit_limit || 0) / 10000)}万`,
    bill: account.balance,
    balance: account.balance,
    original_balance: account.original_balance ?? account.balance,
    opened_at: account.opened_at,
    last4: account.last4,
    credit_limit: account.credit_limit,
    statement_day: account.statement_day,
    repayment_day: account.repayment_day,
    is_liability: account.is_liability,
    due: account.repayment_day ? `${account.repayment_day}日` : "待设置",
    status: "未接入账单状态",
    statusTone: "neutral",
  })) || creditAccounts;
  const accountOwnerGroups = assetAccountsView.reduce((groups, account) => {
    const owner = normalizeAccountOwner(account.owner);
    const group = groups.find((item) => item.owner === owner);
    if (group) {
      group.accounts.push(account);
      group.total += Number(account.balance || 0);
      return groups;
    }
    groups.push({
      owner,
      total: Number(account.balance || 0),
      accounts: [account],
    });
    return groups;
  }, []);
  const accountDistributionView = accountsData?.distribution?.map((item, index) => ({
    ...item,
    color: colors[index % colors.length],
  })) || accountDistribution;
  const investmentTotalValue = investmentData.total_value ?? fallbackInvestment.total_value;
  const investmentProfit = investmentData.total_profit ?? fallbackInvestment.total_profit;
  const investmentProfitRate = investmentData.profit_rate ?? fallbackInvestment.profit_rate;
  const investmentCashAvailable = investmentData.cash_available ?? fallbackInvestment.cash_available;
  const investmentCashAccountsView = (investmentData.cash_accounts ?? fallbackInvestment.cash_accounts).map((account) => ({
    ...account,
    owner: normalizeAccountOwner(account.owner),
    draft: cashDrafts[account.id] ?? String(account.cash_available_original ?? account.cash_available ?? 0),
  }));
  const investmentAllocationView = (investmentData.allocation ?? fallbackInvestment.allocation).map((item, index) => ({
    ...item,
    name: assetTypeLabels[item.name] || item.name,
    color: colors[index % colors.length],
  }));
  const investmentTrendView = (investmentData.trend ?? fallbackInvestment.trend).map((item, index) => ({
    month: formatTrendLabel(item.date, index),
    mine: Math.round((item.value || 0) / 1000) / 10,
  }));
  const investmentHoldingsView = investmentData.holdings
    ? investmentData.holdings.map((item) => {
      const marketValue = item.market_value || (item.current_price || 0) * (item.quantity || 0);
      return {
        id: item.id,
        name: item.name,
        code: `${item.code}${item.asset_type ? ` · ${assetTypeLabels[item.asset_type] || item.asset_type}` : ""}`,
        rawCode: item.code,
        buy_price: item.buy_price,
        quantity: item.quantity,
        current_price: item.current_price,
        account_id: item.account_id,
        included_in_totals: item.included_in_totals,
        account_name: item.account_name ? [item.account_owner, item.account_name].filter(Boolean).join(" · ") : "未关联账户 · 暂不计入汇总",
        asset_type: item.asset_type,
        market: item.market,
        currency: item.currency,
        exchange_rate_to_base: item.exchange_rate_to_base,
        cost: formatPrice(item.buy_price),
        price: formatPrice(item.current_price),
        value: marketValue,
        profit: item.profit || 0,
        returnRate: item.profit_rate || 0,
        percent: item.included_in_totals !== 0 && investmentTotalValue ? Math.round(marketValue / investmentTotalValue * 1000) / 10 : 0,
      };
    })
    : investmentHoldings;
  const filteredInvestmentHoldingsView = investmentHoldingsView.filter((item) => {
    if (holdingFilter === "基金") return item.code.includes("基金") || item.code.includes("fund");
    if (holdingFilter === "股票") return item.code.includes("股票") || item.code.includes("stock");
    return true;
  });
  const incomeCategoriesView = (incomeData.categories ?? fallbackIncome.categories).map((item, index) => ({
    id: item.id,
    category_id: item.category_id,
    name: item.name,
    value: item.amount ?? item.value ?? 0,
    percent: item.percent || 0,
    change: item.change || "实时",
    trend: item.trend || "flat",
    icon: getCategoryIcon(item.name, item.icon, "income"),
    color: item.color || colors[index % colors.length],
  }));
  const visibleIncomeCategories = incomeCategoriesView.filter((item) => item.value > 0);
  const chartIncomeCategories = visibleIncomeCategories;
  const detailIncomeCategories = selectedIncomeCategory
    ? visibleIncomeCategories.filter((item) => item.name === selectedIncomeCategory)
    : visibleIncomeCategories;
  const selectedIncomeItem = selectedIncomeCategory
    ? chartIncomeCategories.find((item) => item.name === selectedIncomeCategory)
    : null;
  const focusedIncomeValue = selectedIncomeItem?.value ?? incomeData.total_income;
  const focusedIncomeLabel = selectedIncomeItem
    ? `${selectedIncomeItem.percent}% · ${selectedIncomeItem.name}`
    : `${chartIncomeCategories.length} 个来源`;
  const toggleIncomeCategory = (name) => {
    if (!name) return;
    setSelectedIncomeCategory((value) => (value === name ? null : name));
  };
  const incomeTrendView = (incomeData.trend ?? fallbackIncome.trend).map((item) => ({
    month: formatTrendLabel(item.month),
    income: Math.round((item.income || 0) / 1000),
  }));
  const allIncomeOrderRows = transactionData
    .filter((item) => item.direction === "income")
    .filter((item) => isDateInRange(item.occurred_at, selectedMonth, incomeChartRange))
    .map((item) => ({
      id: item.id,
      account_id: item.account_id,
      category_id: item.category_id,
      category_name: item.category_name || "未分类",
      account_name: item.account_name || "未知账户",
      account_owner: item.account_owner || "",
      account_label: formatAccountLabel(item),
      name: item.merchant || item.note || item.category_name || "未命名收入",
      amount: item.base_amount ?? item.amount ?? 0,
      rawAmount: item.amount || 0,
      direction: item.direction,
      occurred_at: item.occurred_at,
      merchant: item.merchant || "",
      note: item.note || "",
      icon: getCategoryIcon(item.category_name, item.icon, item.direction),
      color: item.color || "#214f3b",
    }));
  const incomeAccountOptions = Array.from(new Map(
    allIncomeOrderRows
      .filter((item) => item.account_id)
      .map((item) => [item.account_id, item.account_label]),
  ).entries());
  const normalizedIncomeSearch = incomeOrderSearch.trim().toLowerCase();
  const incomeOrderRows = allIncomeOrderRows
    .filter((item) => !selectedIncomeCategory || item.category_name === selectedIncomeCategory)
    .filter((item) => incomeAccountFilter === "all" || String(item.account_id) === incomeAccountFilter)
    .filter((item) => {
      if (!normalizedIncomeSearch) return true;
      return [
        item.name,
        item.category_name,
        item.account_name,
        item.account_label,
        item.merchant,
        item.note,
        item.occurred_at,
        String(item.amount),
      ].some((value) => String(value || "").toLowerCase().includes(normalizedIncomeSearch));
    });
  const incomeOrderTotal = incomeOrderRows.reduce((sum, item) => sum + item.amount, 0);
  const resetIncomeFilters = () => {
    setSelectedIncomeCategory(null);
    setIncomeAccountFilter("all");
    setIncomeOrderSearch("");
  };
  const expenseCategoriesView = (expenseData.categories ?? fallbackExpense.categories).map((item, index) => ({
    id: item.id,
    month: budgetData.month || selectedMonth,
    category_id: item.category_id,
    name: item.name,
    value: item.amount ?? item.value ?? 0,
    percent: item.percent || 0,
    change: item.change || "实时",
    trend: item.trend || "flat",
    icon: getCategoryIcon(item.name, item.icon, "expense"),
    color: item.color || colors[index % colors.length],
  }));
  const visibleExpenseCategories = expenseCategoriesView.filter((item) => item.value > 0);
  const chartExpenseCategories = visibleExpenseCategories;
  const detailExpenseCategories = selectedExpenseCategory
    ? visibleExpenseCategories.filter((item) => item.name === selectedExpenseCategory)
    : visibleExpenseCategories;
  const selectedExpenseItem = selectedExpenseCategory
    ? chartExpenseCategories.find((item) => item.name === selectedExpenseCategory)
    : null;
  const focusedExpenseValue = selectedExpenseItem?.value ?? expenseData.total_expense;
  const focusedExpenseLabel = selectedExpenseItem
    ? `${selectedExpenseItem.percent}% · ${selectedExpenseItem.name}`
    : `${chartExpenseCategories.length} 个分类`;
  const toggleExpenseCategory = (name) => {
    if (!name) return;
    setSelectedExpenseCategory((value) => (value === name ? null : name));
  };
  const cashflowView = (expenseData.cashflow ?? fallbackExpense.cashflow).map((item) => ({
    month: formatTrendLabel(item.month),
    income: Math.round((item.income || 0) / 1000),
    expense: Math.round((item.expense || 0) / 1000),
  }));
  const allPaymentOrderRows = transactionData
    .filter((item) => item.direction === "expense")
    .filter((item) => isDateInRange(item.occurred_at, selectedMonth, expenseChartRange))
    .map((item) => ({
      id: item.id,
      account_id: item.account_id,
      category_id: item.category_id,
      category_name: item.category_name || "未分类",
      account_name: item.account_name || "未知账户",
      account_owner: item.account_owner || "",
      account_label: formatAccountLabel(item),
      name: item.merchant || item.note || item.category_name || "未命名订单",
      amount: item.base_amount ?? item.amount ?? 0,
      rawAmount: item.amount || 0,
      direction: item.direction,
      occurred_at: item.occurred_at,
      merchant: item.merchant || "",
      note: item.note || "",
      icon: getCategoryIcon(item.category_name, item.icon, item.direction),
      color: item.color || "#c8914b",
    }));
  const paymentAccountOptions = Array.from(new Map(
    allPaymentOrderRows
      .filter((item) => item.account_id)
      .map((item) => [item.account_id, item.account_label]),
  ).entries());
  const normalizedPaymentSearch = paymentOrderSearch.trim().toLowerCase();
  const paymentOrderRows = allPaymentOrderRows
    .filter((item) => !selectedExpenseCategory || item.category_name === selectedExpenseCategory)
    .filter((item) => paymentAccountFilter === "all" || String(item.account_id) === paymentAccountFilter)
    .filter((item) => {
      if (!normalizedPaymentSearch) return true;
      return [
        item.name,
        item.category_name,
        item.account_name,
        item.account_label,
        item.merchant,
        item.note,
        item.occurred_at,
        String(item.amount),
      ].some((value) => String(value || "").toLowerCase().includes(normalizedPaymentSearch));
    });
  const paymentOrderTotal = paymentOrderRows.reduce((sum, item) => sum + item.amount, 0);
  const resetPaymentFilters = () => {
    setSelectedExpenseCategory(null);
    setPaymentAccountFilter("all");
    setPaymentOrderSearch("");
  };
  const budgetCategoriesView = (budgetData.items ?? fallbackBudget.items).map((item, index) => ({
    id: item.id,
    name: item.name,
    icon: getCategoryIcon(item.name, item.icon, "expense"),
    budget: item.budget || 0,
    used: item.used || 0,
    status: item.status === "over" ? `超支 ${Math.max(item.used_percent - 100, 0).toFixed(0)}%` : `${Math.round(item.used_percent || 0)}%`,
    statusTone: item.status === "over" ? "danger" : "success",
    color: item.color || colors[index % colors.length],
  }));
  const goalCardsView = (goalsData.goals ?? fallbackGoals.goals).map((goal, index) => ({
    id: goal.id,
    name: goal.name,
    icon: getGoalIcon(goal.name, goal.icon),
    target_amount: goal.target_amount,
    current_amount: goal.current_amount,
    monthly_saving: goal.monthly_saving,
    due_date: goal.due_date,
    status: goal.status,
    target: goal.target_amount || 0,
    current: goal.current_amount || 0,
    saved: goal.current_amount || 0,
    monthly: goal.monthly_saving || 0,
    due: formatGoalDue(goal.due_date),
    note: goal.status === "paused" ? "已暂停" : goal.note,
    color: goal.color || colors[index % colors.length],
  }));
  const goalPlanView = (goalsData.plan ?? fallbackGoals.plan).map((item, index) => ({
    ...item,
    period: item.period || formatTrendLabel(item.month || item.year, index),
  }));
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - new Date().getDate(), 0);
  const budgetUsedPercent = budgetData.used_percent ?? fallbackBudget.used_percent;
  const budgetPacePercent = Math.round(new Date().getDate() / daysInMonth * 100);
  const budgetPaceText = budgetData.total_budget
    ? budgetUsedPercent > 100
      ? "已超出预算，请优先减少非必要支出"
      : budgetUsedPercent > budgetPacePercent
        ? "支出快于时间进度，建议放慢节奏"
        : "支出节奏健康，仍有预算空间"
    : "暂无预算，设置后可跟踪执行节奏";
  const creditReminder = creditAccountsView.length
    ? `${creditAccountsView[0].name}还款日为 ${creditAccountsView[0].due}。当前仅记录负债余额，不判断是否已出账或已还款。`
    : "暂无信用账户，新增信用卡后展示账单提醒。";
  const goalAdvice = goalCardsView.length
    ? `当前每月储蓄 ${formatMoney(goalsData.monthly_saving)}，总进度 ${goalsData.progress}%。`
    : "暂无目标，创建目标后会自动生成进度建议。";
  const topbarTitle = {
    dashboard: `${getGreeting()}，${USER_DISPLAY_NAME}`,
    ledger: "全部流水",
    assets: assetSection === "accounts" ? "账户与负债" : "投资持仓",
    plan: planSection === "budget" ? "月度预算" : "储蓄目标",
  }[activePage] || pageTitles[activePage];
  const topbarGroup = "Invest";
  const dashboardTrendLabel = getRangeLabel(chartRangeOptions.trend, dashboardTrendRange);
  const investmentTrendLabel = getRangeLabel(chartRangeOptions.trend, investmentTrendRange);
  const incomeChartLabel = getRangeLabel(chartRangeOptions.expense, incomeChartRange);
  const incomeTrendLabel = getRangeLabel(chartRangeOptions.cashflow, incomeTrendRange);
  const expenseChartLabel = getRangeLabel(chartRangeOptions.expense, expenseChartRange);
  const cashflowRangeLabel = getRangeLabel(chartRangeOptions.cashflow, cashflowRange);
  const goalPlanLabel = getRangeLabel(chartRangeOptions.goal, goalPlanRange);
  const dashboardTrendHint = dashboardTrendRange === "month" ? "按日快照" : "月度快照";
  const investmentTrendHint = investmentTrendRange === "month" ? "按日快照" : "月度快照";
  const incomeTrendHint = incomeTrendRange === "month" ? "按日汇总" : "按月汇总";
  const cashflowHint = cashflowRange === "month" ? "按日汇总" : "按月汇总";
  const ActivePageComponent = pageComponents[activePage] || pageComponents.dashboard;
  const pageView = {
    accountDistributionView,
    accountOwnerGroups,
    accountOwnerOptions,
    accountsData,
    assetSection,
    assetAccountsView,
    assetData,
    budgetCategoriesView,
    budgetData,
    budgetDrafts,
    cancelBudgetDrafts,
    budgetLeft,
    budgetPacePercent,
    budgetPaceText,
    budgetPercent,
    budgetTotal,
    budgetUsedPercent,
    cashflowHint,
    cashflowRange,
    cashflowRangeLabel,
    cashflowView,
    chartExpenseCategories,
    chartIncomeCategories,
    chartRangeOptions,
    colors,
    categoriesData,
    creditAccountsView,
    creditReminder,
    dashboardTransactions,
    dashboardTrendHint,
    dashboardTrendLabel,
    dashboardTrendRange,
    daysLeft,
    detailExpenseCategories,
    detailIncomeCategories,
    expenseChartLabel,
    expenseChartRange,
    expenseData,
    filteredInvestmentHoldingsView,
    focusedExpenseLabel,
    focusedExpenseValue,
    focusedIncomeLabel,
    focusedIncomeValue,
    goalAdvice,
    goalCardsView,
    goalPlanLabel,
    goalPlanRange,
    goalPlanView,
    goalsData,
    handleCopyPreviousBudget,
    handleDownloadLedger,
    handleGoalStatus,
    handleRefresh: (...args) => handleRefresh(...args),
    handleSaveBudgetBatch,
    handleStatementImport,
    holdingFilter,
    holdings,
    incomeAccountFilter,
    incomeAccountOptions,
    incomeChartLabel,
    incomeChartRange,
    incomeData,
    incomeOrderRows,
    incomeOrderSearch,
    incomeOrderTotal,
    incomeTrendHint,
    incomeTrendLabel,
    incomeTrendRange,
    incomeTrendView,
    investmentAllocationView,
    investmentCashAccountsView,
    investmentCashAvailable,
    investmentHoldingsView,
    investmentProfit,
    investmentProfitRate,
    investmentTotalValue,
    investmentTrendHint,
    investmentTrendLabel,
    investmentTrendRange,
    investmentTrendView,
    investmentTrades,
    tradeAccountFilter,
    setTradeAccountFilter,
    setReversalTarget,
    isRefreshing,
    isSavingBudgets,
    ledgerData,
    ledgerAccountFilter,
    setLedgerAccountFilter,
    monthlyExpense,
    monthlyIncome,
    netWorth,
    openAccountDetail,
    openAction,
    openEditAction,
    openGoalRecord,
    openGoalRecords,
    openRepayment,
    openTradeAction,
    paymentAccountFilter,
    paymentAccountOptions,
    paymentOrderRows,
    paymentOrderSearch,
    paymentOrderTotal,
    profitRate,
    quoteRefreshResult,
    resetIncomeFilters,
    resetPaymentFilters,
    savingsRate,
    selectedExpenseCategory,
    selectedExpenseItem,
    selectedIncomeCategory,
    selectedIncomeItem,
    selectedMonth,
    setActivePage,
    setAssetSection,
    setBudgetDraft,
    setCashflowRange,
    setExpenseChartRange,
    setHoldingFilter,
    setIncomeAccountFilter,
    setIncomeChartRange,
    setIncomeOrderSearch,
    setIncomeTrendRange,
    setInvestmentTrendRange,
    setIsCashEditorOpen,
    setPaymentAccountFilter,
    setPaymentOrderSearch,
    setPlanSection,
    setSelectedExpenseCategory,
    setSelectedIncomeCategory,
    setDashboardTrendRange,
    setGoalPlanRange,
    planSection,
    totalProfit,
    trendData,
    toggleExpenseCategory,
    toggleIncomeCategory,
    visibleExpenseCategories,
    visibleIncomeCategories,
    ChartRangeSwitch,
    ChartTooltip,
    IconBadge,
    formatDateLabel,
    formatMoney,
    formatMonthLabel,
    formatQuoteSources,
    handleExportExpense,
    handleExportIncome,
  };

  const handleRefresh = useCallback(async ({ silent = false } = {}) => {
    setIsRefreshing(true);
    try {
      const res = await fetch(apiUrl("/investments/refresh"), {
        method: "POST",
        headers: requestHeaders(),
      });
      await ensureResponse(res, "/investments/refresh");
      const data = await res.json();
      setQuoteRefreshResult(data);
      if (data.summary) {
        setInvestmentData({ ...fallbackInvestment, ...data.summary });
        if (data.summary.holdings?.length) {
          setHoldings(data.summary.holdings);
        }
      }
      await loadData();
    } catch (error) {
      if (!silent) {
        alert(`刷新行情失败：${error.message}`);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData]);

  useEffect(() => {
    if (loggedIn && !autoQuoteRefreshRef.current.app) {
      autoQuoteRefreshRef.current.app = true;
      handleRefresh({ silent: true });
    }
  }, [handleRefresh, loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    if (activePage !== "assets" || assetSection !== "investments") {
      autoQuoteRefreshRef.current.invest = false;
      return;
    }
    if (!autoQuoteRefreshRef.current.invest) {
      autoQuoteRefreshRef.current.invest = true;
      handleRefresh({ silent: true });
    }
  }, [activePage, assetSection, handleRefresh, loggedIn]);

  const renderAccountOwnerOptions = () => accountOwnerOptions.map((owner) => (
    <option key={owner} value={owner}>{owner}</option>
  ));

  const renderAccountOptions = (owner, predicate = () => true) => (accountsData?.accounts || [])
    .filter((account) => normalizeAccountOwner(account.owner || account.institution) === normalizeAccountOwner(owner))
    .filter(predicate)
    .map((account) => (
      <option key={account.id} value={account.id}>{account.name}</option>
  ));

  const renderInvestmentAccountOptions = (owner) => renderAccountOptions(
    owner,
    (account) => !account.is_liability && account.type === "investment",
  );

  const renderAllAccountOptions = (predicate = () => true) => (accountsData?.accounts || [])
    .filter(predicate)
    .map((account) => (
      <option key={account.id} value={account.id}>
        {normalizeAccountOwner(account.owner || account.institution)} · {account.name}
      </option>
    ));

  const renderCategoryOptions = (type, selectedName = "") => {
    const categoryOptions = categoriesData.filter((category) => category.type === type);
    const hasSelectedName = selectedName && categoryOptions.some((category) => category.name === selectedName);
    return (
      <>
        {!categoryOptions.length && !selectedName && <option value="" disabled>暂无可用分类</option>}
        {selectedName && !hasSelectedName && <option value={selectedName}>{selectedName}</option>}
        {categoryOptions.map((category) => (
          <option key={category.id} value={category.name}>
            {getCategoryIcon(category.name, category.icon, category.type)} {category.name}
          </option>
        ))}
      </>
    );
  };

  const actionTitles = {
    transaction: editTarget ? "编辑流水" : "记一笔",
    holding: editTarget ? "编辑已有持仓" : "录入已有持仓",
    account: editTarget ? "编辑账户" : "新增账户",
    adjustment: "余额核对 / 调整",
    transfer: "资金划转",
    trade: form.trade_type === "buy" ? "买入持仓" : "卖出持仓",
    new_trade: "买入新标的",
    budget: editTarget ? "编辑预算" : "设置预算",
    goal: editTarget ? "编辑目标" : "创建目标",
    goal_record: form.goal_record_type === "withdraw" ? "从目标取出" : "存入目标",
  };

  const renderDateButton = ({ field, mode = "date", label, help, value = form[field], allowClear = false }) => (
    <FormField label={label} help={help}>
      <span className="date-input-shell">
        <input
          type="text"
          className={`date-input-control${value ? "" : " empty"}`}
          aria-label={`选择${label}`}
          readOnly
          value={formatDateButtonLabel(value, mode)}
          onClick={() => openDateSelector({ field, mode, value, label, help, allowClear })}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openDateSelector({ field, mode, value, label, help, allowClear });
            }
          }}
        />
      </span>
    </FormField>
  );

  const renderActionPanel = () => {
    if (!isAdding) return null;
    const fromAccount = getAccountById(form.from_account_id);
    const toAccount = getAccountById(form.to_account_id);
    const sameTransferCurrency = accountCurrency(fromAccount) === accountCurrency(toAccount);
    const received = Number(sameTransferCurrency ? form.amount : form.to_amount);
    const preview = tradePreview(form, getAccountById(form.account_id));
    return (
      <div
        className={`modal-backdrop${isDatePickerOpen ? " modal-backdrop-muted" : ""}`}
        role="presentation"
        onClick={(event) => {
          if (isDatePickerOpen || event.target !== event.currentTarget) return;
          closeActionPanel();
        }}
      >
        <section className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title">
            <div>
              <p className="eyebrow">{editTarget ? "编辑数据" : "录入数据"}</p>
              <h2>{actionTitles[actionMode]}</h2>
            </div>
            <button type="button" className="modal-close" disabled={isSubmitting} onClick={closeActionPanel}>×</button>
          </div>
          <fieldset className="quick-add financial-form" disabled={isSubmitting}>
            {actionMode === "transaction" && (
              <>
                <FormField label="金额">
                  <input name="amount" autoFocus inputMode="decimal" placeholder="0.00" value={form.amount} onChange={handleChange} />
                </FormField>
                <FormField label="类型">
                  <select name="direction" value={form.direction} onChange={handleChange}>
                    <option value="expense">支出</option>
                    <option value="income">收入</option>
                  </select>
                </FormField>
                <FormField label="分类">
                  <select name="category_name" value={form.category_name} onChange={handleChange}>
                    <option value="">选择分类</option>
                    {renderCategoryOptions(form.direction, form.category_name)}
                  </select>
                </FormField>
                <FormField label="账户">
                  <select name="account_id" value={form.account_id} onChange={handleChange}>
                    <option value="">选择账户</option>
                    {renderAllAccountOptions()}
                  </select>
                </FormField>
                {renderDateButton({ field: "occurred_at", label: "日期" })}
                <details className="optional-fields wide" open={Boolean(form.merchant || form.note)}>
                  <summary>商户与备注</summary>
                  <div>
                    <FormField label="商户 / 来源">
                      <input name="merchant" placeholder="例如：盒马 / 公司工资" value={form.merchant} onChange={handleChange} />
                    </FormField>
                    <FormField label="备注">
                      <input name="note" placeholder="补充说明" value={form.note} onChange={handleChange} />
                    </FormField>
                  </div>
                </details>
              </>
            )}
            {["holding", "new_trade"].includes(actionMode) && (
              <>
                <FormField label="持仓名称" help="显示在投资理财持仓列表中。">
                  <input name="name" placeholder="例如：贵州茅台 / 沪深300ETF" value={form.name} onChange={handleChange} />
                </FormField>
                <FormField label="证券代码" help="用于线上行情匹配，请尽量填写标准代码。">
                  <input name="code" placeholder="例如：600519 / 001186 / AAPL" value={form.code} onChange={handleChange} />
                </FormField>
                <FormField label="资产类型" help="股票和基金会尝试自动刷新行情。">
                  <select name="asset_type" value={form.asset_type} onChange={handleChange}>
                    <option value="stock">股票</option>
                    <option value="fund">基金</option>
                    <option value="bond">债券</option>
                    <option value="gold">黄金 / 商品</option>
                  </select>
                </FormField>
                <FormField label="用户" help="先选择持仓归属大宝还是小宝。">
                  <select name="account_owner" value={form.account_owner} onChange={handleChange}>
                    {renderAccountOwnerOptions()}
                  </select>
                </FormField>
                <FormField label="账户名称" help="只展示所选用户的投资账户。">
                  <select name="account_id" value={form.account_id} onChange={handleChange}>
                    <option value="">选择投资账户</option>
                    {renderInvestmentAccountOptions(form.account_owner)}
                  </select>
                </FormField>
                <FormField label="交易市场" help="不确定时可保持自动识别；美股请选美股。">
                  <select name="market" value={form.market} onChange={handleChange}>
                    <option value="">自动识别市场</option>
                    <option value="sh">上海 A 股</option>
                    <option value="sz">深圳 A 股</option>
                    <option value="bj">北京证券交易所</option>
                    <option value="hk">港股</option>
                    <option value="us">美股</option>
                  </select>
                </FormField>
                <FormField label="计价币种" help="持仓价格使用的原始币种，例如 CNY、HKD、USD。">
                  <input name="currency" maxLength="3" placeholder="CNY" value={form.currency} onChange={handleChange} />
                </FormField>
                <FormField label="兑人民币汇率" help="1 单位原币可兑换的人民币金额，用于统一汇总。">
                  <input name="exchange_rate_to_base" inputMode="decimal" placeholder="例如：7.12" value={form.exchange_rate_to_base} onChange={handleChange} />
                </FormField>
                {actionMode === "holding" && <>
                <FormField label="买入均价" help="用于计算持仓成本和累计盈亏。">
                  <input name="buy_price" placeholder="例如：12.35" value={form.buy_price} onChange={handleChange} />
                </FormField>
                <FormField label="持仓数量" help="股票填写股数，基金填写份额。">
                  <input name="quantity" placeholder="例如：1000" value={form.quantity} onChange={handleChange} />
                </FormField>
                {["stock", "fund"].includes(form.asset_type) ? (
                  <div className="form-hint-card wide">
                    <strong>{form.asset_type === "fund" ? "基金净值由线上行情自动刷新" : "股票现价由线上行情自动刷新"}</strong>
                    <span>股票支持 A 股、港股、美股多源行情；基金支持天天基金估值。保存后会自动刷新，也可以点击“刷新行情”手动更新。</span>
                  </div>
                ) : (
                  <FormField label="当前价格 / 净值" help="该资产暂未接入自动行情，需要手动维护估值。">
                    <input name="current_price" placeholder="例如：510.00" value={form.current_price} onChange={handleChange} />
                  </FormField>
                )}
                </>}
              </>
            )}
            {actionMode === "account" && (
              <>
                <FormField label="账户名称">
                  <input name="name" autoComplete="off" placeholder="例如：招商储蓄卡" value={form.name} onChange={handleChange} />
                </FormField>
                <FormField label="所属人">
                  <input name="owner" autoComplete="off" placeholder="例如：大宝 / 小宝" value={form.owner} onChange={handleChange} />
                </FormField>
                <FormField label="账户类型">
                  <select name="type" value={form.type} onChange={handleChange}>
                    <option value="debit_card">储蓄卡</option>
                    <option value="wallet">电子钱包</option>
                    <option value="investment">投资账户</option>
                    <option value="deposit">定期存款</option>
                    <option value="credit_card">信用卡</option>
                  </select>
                </FormField>
                {!editTarget && (
                  <FormField label={form.type === "investment" ? "当前现金可投" : form.type === "credit_card" ? "当前待还" : "当前余额"}>
                    <input name="balance" inputMode="decimal" placeholder="0.00" value={form.balance} onChange={handleChange} />
                  </FormField>
                )}
                {!editTarget && renderDateButton({ field: "opening_date", label: "建账日期" })}
                <FormField label="账户币种">
                  <input name="currency" maxLength="3" placeholder="CNY" value={form.currency} onChange={handleChange} />
                </FormField>
                {form.currency.trim().toUpperCase() !== "CNY" && (
                  <FormField label="兑人民币汇率">
                    <input name="exchange_rate_to_base" inputMode="decimal" placeholder="例如：7.12" value={form.exchange_rate_to_base} onChange={handleChange} />
                  </FormField>
                )}
                <div className="form-hint-card wide">
                  <strong>{form.type === "investment" ? "总额 = 持仓市值 + 现金可投" : form.type === "credit_card" ? "信用卡自动作为负债账户" : "后续余额由流水联动"}</strong>
                  <span>期初余额和核对调整会单独留痕，不计入收入与支出。</span>
                </div>
                <FormField label="账户尾号">
                  <input name="last4" autoComplete="off" inputMode="numeric" maxLength="8" placeholder="例如：8888" value={form.last4} onChange={handleChange} />
                </FormField>
                {form.type === "credit_card" && (
                  <>
                    <FormField label="信用额度">
                      <input name="credit_limit" autoComplete="off" inputMode="decimal" placeholder="例如：50000" value={form.credit_limit} onChange={handleChange} />
                    </FormField>
                    <FormField label="账单日">
                      <input name="statement_day" autoComplete="off" inputMode="numeric" maxLength="2" placeholder="例如：10" value={form.statement_day} onChange={handleChange} />
                    </FormField>
                    <FormField label="还款日">
                      <input name="repayment_day" autoComplete="off" inputMode="numeric" maxLength="2" placeholder="例如：25" value={form.repayment_day} onChange={handleChange} />
                    </FormField>
                  </>
                )}
              </>
            )}
            {actionMode === "adjustment" && (
              <>
                <FormField label="账户">
                  <select name="account_id" value={form.account_id} onChange={handleChange}>
                    <option value="">选择账户</option>
                    {renderAllAccountOptions()}
                  </select>
                </FormField>
                <FormField label={getAccountById(form.account_id)?.type === "investment" ? "核对后现金可投" : "核对后余额"}>
                  <input name="actual_balance" inputMode="decimal" value={form.actual_balance} onChange={handleChange} />
                </FormField>
                {renderDateButton({ field: "occurred_at", label: "核对日期" })}
                <FormField label="调整原因">
                  <input name="reason" placeholder="例如：银行余额核对" value={form.reason} onChange={handleChange} />
                </FormField>
              </>
            )}
            {actionMode === "transfer" && (
              <>
                <FormField label="转出用户" help="先选择转出账户所属用户。">
                  <select name="from_account_owner" value={form.from_account_owner} onChange={handleChange}>
                    {renderAccountOwnerOptions()}
                  </select>
                </FormField>
                <FormField label="转出账户" help="只展示所选用户的账户。">
                  <select name="from_account_id" value={form.from_account_id} onChange={handleChange}>
                    <option value="">转出账户</option>
                    {renderAccountOptions(form.from_account_owner)}
                  </select>
                </FormField>
                <FormField label="转入用户" help="先选择转入账户所属用户。">
                  <select name="to_account_owner" value={form.to_account_owner} onChange={handleChange}>
                    {renderAccountOwnerOptions()}
                  </select>
                </FormField>
                <FormField label="转入账户" help="只展示所选用户的账户。">
                  <select name="to_account_id" value={form.to_account_id} onChange={handleChange}>
                    <option value="">转入账户</option>
                    {renderAccountOptions(form.to_account_owner)}
                  </select>
                </FormField>
                <FormField label={`付款金额 (${accountCurrency(fromAccount)})`} help={form.repayment_account_id && !sameTransferCurrency ? "按估值汇率预估，请按实际付款修改；金额使用转出账户原币。" : "按转出账户原币填写，不计入收入或支出。"}>
                  <input name="amount" placeholder="例如：3000" value={form.amount} onChange={handleChange} />
                </FormField>
                {!sameTransferCurrency && <FormField label={`实际到账 (${accountCurrency(toAccount)})`} help="填写已扣除换汇费用的实际到账金额，本次结算汇率会单独保存。">
                  <input name="to_amount" inputMode="decimal" placeholder="0.00" value={form.to_amount} onChange={handleChange} />
                </FormField>}
                <div className="form-hint-card wide" aria-live="polite">
                  <strong>付款 {originalMoney(Number(form.amount || 0), accountCurrency(fromAccount))} → 到账 {originalMoney(received || 0, accountCurrency(toAccount))}</strong>
                  <span>{sameTransferCurrency ? "同币种按原币 1:1 划转。" : Number(form.amount) > 0 && received > 0 ? `本次结算：1 ${accountCurrency(fromAccount)} = ${(received / Number(form.amount)).toFixed(6)} ${accountCurrency(toAccount)}` : "请填写两端实际金额，确认后再保存。"}</span>
                  {fromAccount && <span>转出后{fromAccount.is_liability ? "待还" : fromAccount.type === "investment" ? "现金可投" : "余额"}：{originalMoney(originalBalance(fromAccount) + Number(form.amount || 0) * (fromAccount.is_liability ? 1 : -1), accountCurrency(fromAccount))}</span>}
                  {toAccount && <span>转入后{toAccount.is_liability ? "待还（负数为溢缴款）" : toAccount.type === "investment" ? "现金可投" : "余额"}：{originalMoney(originalBalance(toAccount) + (received || 0) * (toAccount.is_liability ? -1 : 1), accountCurrency(toAccount))}</span>}
                </div>
                {renderDateButton({ field: "occurred_at", label: "划转日期", help: "用于记录本次资金移动发生的日期。" })}
                <FormField label="备注" help="可选，例如储蓄转投资、还信用卡等。">
                  <input name="note" placeholder="例如：储蓄转入投资账户" value={form.note} onChange={handleChange} />
                </FormField>
              </>
            )}
            {["trade", "new_trade"].includes(actionMode) && (
              <>
                <div className="form-hint-card wide">
                  <strong>{form.name || "首次买入"}</strong>
                  <span>{form.code} · {form.trade_type === "buy" ? "买入会扣减投资账户现金" : "卖出会增加投资账户现金"}</span>
                </div>
                {actionMode === "trade" && <FormField label="交易方向">
                  <select name="trade_type" value={form.trade_type} onChange={handleChange}>
                    <option value="buy">买入</option>
                    <option value="sell">卖出</option>
                  </select>
                </FormField>}
                <FormField label="数量">
                  <input name="quantity" inputMode="decimal" placeholder="0" value={form.quantity} onChange={handleChange} />
                </FormField>
                <FormField label="成交价格">
                  <input name="price" inputMode="decimal" placeholder="0.00" value={form.price} onChange={handleChange} />
                </FormField>
                <FormField label="手续费" help={`使用标的计价币种 ${preview.currency}`}>
                  <input name="fee" inputMode="decimal" placeholder="0.00" value={form.fee} onChange={handleChange} />
                </FormField>
                {!preview.sameCurrency && <FormField label="实际结算汇率" help={`1 ${preview.currency} 对应多少 ${preview.cashCurrency}；用于本次现金收付。`}>
                  <input name="settlement_rate" inputMode="decimal" placeholder="按券商实际结算填写" value={form.settlement_rate} onChange={handleChange} />
                </FormField>}
                <div className="form-hint-card wide" aria-live="polite">
                  <strong>成交额 {originalMoney(preview.gross || 0, preview.currency)} · 手续费 {originalMoney(preview.fee || 0, preview.currency)}</strong>
                  {preview.valid ? <>
                    <span>现金{preview.cashChange < 0 ? "扣减" : "增加"} {originalMoney(Math.abs(preview.cashChange), preview.cashCurrency)}</span>
                    <span className={preview.remaining < 0 ? "negative" : ""}>交易后现金可投 {originalMoney(preview.remaining, preview.cashCurrency)}{preview.remaining < 0 ? "，现金不足" : ""}</span>
                  </> : <span>填写数量、成交价及结算信息后显示现金变化。</span>}
                  <span>成交价用于记录成本，已有持仓的当前行情独立更新。</span>
                </div>
                {renderDateButton({ field: "occurred_at", label: "交易日期" })}
                <FormField label="备注">
                  <input name="note" placeholder="可选" value={form.note} onChange={handleChange} />
                </FormField>
              </>
            )}
            {actionMode === "budget" && (
              <>
                {renderDateButton({ field: "month", mode: "month", label: "预算月份", help: "该预算只影响选中月份的预算执行统计。" })}
                <FormField label="预算分类" help="需要和支出流水分类一致，才能自动计算已用金额。">
                  <select name="category_name" value={form.category_name} onChange={handleChange}>
                    <option value="">选择预算分类</option>
                    {renderCategoryOptions("expense", form.category_name)}
                  </select>
                </FormField>
                <FormField label="预算金额" help="这个分类在该月份的可用预算。">
                  <input name="amount" placeholder="例如：2500" value={form.amount} onChange={handleChange} />
                </FormField>
              </>
            )}
            {actionMode === "goal" && (
              <>
                <FormField label="目标名称" help="显示在目标规划卡片中，图标和颜色会根据名称自动生成。">
                  <input name="name" placeholder="例如：旅行基金" value={form.name} onChange={handleChange} />
                </FormField>
                <FormField label="目标金额" help="最终希望达成的总金额。">
                  <input name="target_amount" placeholder="例如：30000" value={form.target_amount} onChange={handleChange} />
                </FormField>
                {!editTarget && (
                  <FormField label="初始已分配" help="这是已有资产的用途分配，不会重复计入总资产。">
                    <input name="current_amount" placeholder="例如：8000" value={form.current_amount} onChange={handleChange} />
                  </FormField>
                )}
                <FormField label="每月储蓄" help="用于生成历史计划参考线，和实际积累做对比。">
                  <input name="monthly_saving" placeholder="例如：2000" value={form.monthly_saving} onChange={handleChange} />
                </FormField>
                {renderDateButton({ field: "due_date", label: "目标日期", help: "希望完成目标的截止日期，可选。", allowClear: true })}
              </>
            )}
            {actionMode === "goal_record" && (
              <>
                <div className="form-hint-card wide">
                  <strong>{form.name}</strong>
                  <span>目标资金是已有资产的用途分配，不会改变总资产。</span>
                </div>
                <FormField label="操作">
                  <select name="goal_record_type" value={form.goal_record_type} onChange={handleChange}>
                    <option value="deposit">存入</option>
                    <option value="withdraw">取出</option>
                  </select>
                </FormField>
                <FormField label="金额">
                  <input name="amount" autoFocus inputMode="decimal" placeholder="0.00" value={form.amount} onChange={handleChange} />
                </FormField>
                {renderDateButton({ field: "occurred_at", label: "日期" })}
                <FormField label="备注">
                  <input name="note" placeholder="可选" value={form.note} onChange={handleChange} />
                </FormField>
              </>
            )}
          </fieldset>
          {editTarget && (
            <div className="modal-danger-zone">
              <div>
                <strong>{editTarget.type === "account" ? "归档账户" : "删除当前数据"}</strong>
                <span>{editTarget.type === "account" ? "清空余额和持仓后可归档，历史记录保留。" : "删除后会同步更新看板、图表和汇总数据。"}</span>
              </div>
              <button type="button" className="danger-button" disabled={isSubmitting} onClick={() => handleDelete(editTarget.type, editTarget.id)}>{editTarget.type === "account" ? "归档" : "删除"}</button>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="record-button compact" disabled={isSubmitting} onClick={() => handleSubmitAction()}>{isSubmitting ? "保存中…" : editTarget ? "保存修改" : "完成"}</button>
            {actionMode === "transaction" && !editTarget && (
              <button type="button" className="ghost-button" disabled={isSubmitting} onClick={() => handleSubmitAction({ keepOpen: true })}>再记一笔</button>
            )}
            <button type="button" className="ghost-button" disabled={isSubmitting} onClick={closeActionPanel}>取消</button>
          </div>
        </section>
      </div>
    );
  };

  const renderInvestmentCashEditor = () => {
    if (!isCashEditorOpen) return null;
    return (
      <div
        className="modal-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) setIsCashEditorOpen(false);
        }}
      >
        <section className="modal-card cash-editor-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title">
            <div>
              <p className="eyebrow">手动维护</p>
              <h2>股票账户现金可投</h2>
            </div>
            <button type="button" className="modal-close" onClick={() => setIsCashEditorOpen(false)}>×</button>
          </div>
          {investmentCashAccountsView.length ? (
            <div className="investment-cash-list">
              {investmentCashAccountsView.map((account) => (
                <div className="investment-cash-row" key={account.id}>
                  <div>
                    <strong>{account.name}</strong>
                    <span>
                      {account.owner} · 当前 {account.currency || "CNY"} {formatPrice(account.cash_available_original ?? account.cash_available ?? 0)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={account.draft}
                    onChange={(event) => {
                      cashDirtyAccountIdsRef.current.add(account.id);
                      setCashDrafts((value) => ({ ...value, [account.id]: event.target.value }));
                    }}
                  />
                  <button
                    type="button"
                    className="edit-button subtle"
                    disabled={savingCashAccountId === account.id}
                    onClick={() => handleSaveInvestmentCash(account.id)}
                  >
                    {savingCashAccountId === account.id ? "保存中" : "保存"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">暂无股票账户，请先到账户管理新增投资账户。</div>
          )}
          <p className="cash-editor-note">保存后会按账户汇率折算，并立即联动总资产与投资账户余额。</p>
        </section>
      </div>
    );
  };

  const renderAccountDetail = () => {
    if (!accountDetail) return null;
    const { account, transactions: accountTransactions = [], holdings: accountHoldings = [], trades: accountTrades = [] } = accountDetail;
    return (
      <div className="modal-backdrop" role="presentation" onClick={(event) => {
        if (event.target === event.currentTarget) setAccountDetail(null);
      }}>
        <section className="modal-card detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title">
            <div>
              <p className="eyebrow">{normalizeAccountOwner(account.owner)} · {accountTypeLabels[account.type] || "账户"}</p>
              <h2>{account.name}</h2>
            </div>
            <button type="button" className="modal-close" onClick={() => setAccountDetail(null)}>×</button>
          </div>
          <div className="account-detail-balance">
            <span>{account.type === "investment" ? "账户总额" : account.is_liability ? "当前待还" : "当前余额"}</span>
            <strong>{formatMoney(account.balance)}</strong>
            {account.type === "investment" && (
              <small>持仓 {formatMoney(account.holdings_value || 0)} · 现金可投 {formatMoney(account.cash_available || 0)}</small>
            )}
          </div>
          <div className="account-detail-actions">
            <button type="button" className="filter-button primary" onClick={() => openAdjustment(account)}>余额核对</button>
            {account.is_liability && <button type="button" className="filter-button" onClick={() => { setAccountDetail(null); openRepayment(account); }}>还款</button>}
            <button type="button" className="filter-button" onClick={() => { setAccountDetail(null); openEditAction("account", account); }}>编辑资料</button>
          </div>
          {accountHoldings.length > 0 && (
            <div className="detail-section">
              <h3>关联持仓</h3>
              {accountHoldings.map((holding) => (
                <div className="detail-list-row" key={holding.id}>
                  <span>{holding.name} · {holding.code}</span>
                  <b>{holding.quantity}</b>
                </div>
              ))}
            </div>
          )}
          <div className="detail-section">
            <div className="panel-title"><h3>账户流水</h3>
              <button type="button" className="edit-button subtle" onClick={() => {
                setLedgerAccountFilter(String(account.id)); setAccountDetail(null); setActivePage("ledger");
              }}>查看全部</button>
            </div>
            {accountTransactions.slice(0, 12).map((item) => (
              <div className="detail-list-row" key={item.id}>
                <div>
                  <strong>{item.voided_at ? "已撤销 · " : ""}{item.merchant || item.category_name || (item.source === "opening" ? "期初余额" : item.source === "adjustment" ? "余额核对" : "资金划转")}</strong>
                  <span>{formatDateLabel(item.occurred_at)}{item.note ? ` · ${item.note}` : ""}</span>
                </div>
                <b className={item.direction === "income" ? "positive" : "negative"}>
                  {item.direction === "income" ? "+" : "-"}{formatMoney(item.base_amount ?? item.amount)}
                </b>
              </div>
            ))}
            {!accountTransactions.length && <div className="empty-state">该账户暂无流水。</div>}
          </div>
          {accountTrades.length > 0 && (
            <div className="detail-section">
              <div className="panel-title"><h3>投资交易</h3>
                <button type="button" className="edit-button subtle" onClick={() => {
                  setTradeAccountFilter(String(account.id)); setAccountDetail(null); setAssetSection("investments"); setActivePage("assets");
                }}>查看全部</button>
              </div>
              {accountTrades.slice(0, 8).map((trade) => (
                <div className="detail-list-row" key={trade.id}>
                  <span>{trade.voided_at ? "已撤销 · " : ""}{trade.trade_type === "buy" ? "买入" : "卖出"} {trade.holding_name} · {trade.quantity}</span>
                  <b>{formatMoney(trade.base_amount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderGoalRecords = () => {
    if (!goalRecords) return null;
    return (
      <div className="modal-backdrop" role="presentation" onClick={(event) => {
        if (event.target === event.currentTarget) setGoalRecords(null);
      }}>
        <section className="modal-card detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title">
            <div>
              <p className="eyebrow">存取记录</p>
              <h2>{goalRecords.goal.name}</h2>
            </div>
            <button type="button" className="modal-close" onClick={() => setGoalRecords(null)}>×</button>
          </div>
          <div className="detail-section">
            {goalRecords.records.map((record) => (
              <div className="detail-list-row" key={record.id}>
                <div>
                  <strong>{record.amount >= 0 ? "存入" : "取出"}</strong>
                  <span>{formatDateLabel(record.recorded_at)}{record.note ? ` · ${record.note}` : ""}</span>
                </div>
                <b className={record.amount >= 0 ? "positive" : "negative"}>
                  {record.amount >= 0 ? "+" : "-"}{formatMoney(Math.abs(record.amount))}
                </b>
              </div>
            ))}
            {!goalRecords.records.length && <div className="empty-state">还没有存取记录。</div>}
          </div>
        </section>
      </div>
    );
  };

  const renderDatePicker = () => {
    if (!isDatePickerOpen || !datePickerTarget) return null;
    const isMonthMode = datePickerTarget.mode === "month";
    const currentValue = buildPickerValue(datePickerDraftParts, datePickerTarget.mode);
    const todayParts = parsePickerValue(todayInputValue(), "date");
    const monthNames = Array.from({ length: 12 }, (_, index) => index + 1);
    const calendarDays = getCalendarDays(datePickerDraftParts.year, datePickerDraftParts.month);
    return (
      <div className="date-picker-layer" role="presentation">
        <section className="date-picker-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="date-picker-title">
            <div>
              <p className="eyebrow">{datePickerTarget.scope === "filter" ? "页面筛选" : "选择日期"}</p>
              <h2>{datePickerTarget.label}</h2>
            </div>
            <button type="button" className="modal-close" onClick={() => setIsDatePickerOpen(false)}>×</button>
          </div>
          <div className="date-picker-body">
            <div className="date-picker-current">
              <div>
                <span>{datePickerTarget.help}</span>
                <strong>{formatDateButtonLabel(currentValue, datePickerTarget.mode)}</strong>
              </div>
              <button type="button" onClick={handleUseTodayInPicker}>{isMonthMode ? "回到本月" : "选今天"}</button>
            </div>
            <div className="date-picker-toolbar">
              <button type="button" aria-label="上一年" onClick={() => setDatePickerDraftParts((value) => ({ ...value, year: value.year - 1 }))}>‹</button>
              <strong>{datePickerDraftParts.year}年</strong>
              <button type="button" aria-label="下一年" onClick={() => setDatePickerDraftParts((value) => ({ ...value, year: value.year + 1 }))}>›</button>
            </div>
            {isMonthMode ? (
              <div className="month-grid">
                {monthNames.map((month) => (
                  <button
                    type="button"
                    className={datePickerDraftParts.month === month ? "active" : ""}
                    key={month}
                    onClick={() => setDatePickerDraftParts((value) => ({ ...value, month }))}
                  >
                    {month}月
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="date-picker-toolbar compact">
                  <button type="button" aria-label="上个月" onClick={() => setDatePickerDraftParts((value) => addPickerMonths(value, -1))}>‹</button>
                  <strong>{datePickerDraftParts.month}月</strong>
                  <button type="button" aria-label="下个月" onClick={() => setDatePickerDraftParts((value) => addPickerMonths(value, 1))}>›</button>
                </div>
                <div className="weekday-grid">
                  {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="day-grid">
                  {calendarDays.map((day, index) => day ? (
                    <button
                      type="button"
                      className={[
                        datePickerDraftParts.day === day ? "active" : "",
                        todayParts.year === datePickerDraftParts.year && todayParts.month === datePickerDraftParts.month && todayParts.day === day ? "today" : "",
                      ].filter(Boolean).join(" ")}
                      key={`${datePickerDraftParts.year}-${datePickerDraftParts.month}-${day}`}
                      onClick={() => setDatePickerDraftParts((value) => ({ ...value, day }))}
                    >
                      {day}
                    </button>
                  ) : <span key={`empty-${index}`} />)}
                </div>
              </>
            )}
          </div>
          <div className="date-picker-actions">
            {datePickerTarget.allowClear && <button type="button" className="ghost-button" onClick={handleClearDatePicker}>清空日期</button>}
            <button type="button" className="ghost-button" onClick={() => setIsDatePickerOpen(false)}>取消</button>
            <button type="button" className="record-button compact" onClick={handleApplyDatePicker}>确认选择</button>
          </div>
        </section>
      </div>
    );
  };

  if (!loggedIn) {
    return (
      <main className="login-page">
        <div className="login-card">
          <div className="brand-wordmark">Invest</div>
          <p className="eyebrow">PERSONAL FINANCE</p>
          <h1>欢迎回到 Invest</h1>
          <p>输入密码后查看你的个人理财看板。</p>
          <input
            type="password"
            placeholder="请输入访问密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
          />
          <button type="button" onClick={handleLogin}>登录</button>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-wordmark">Invest</div>
        </div>
        <nav>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <p>{group.title}</p>
              {group.items.map((item) => (
                <button
                  type="button"
                  className={activePage === item.key ? "active" : ""}
                  key={item.key}
                  onClick={() => setActivePage(item.key)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="member-card">
          <div>{USER_DISPLAY_NAME}</div>
          <span>{USER_BADGE}</span>
          <button type="button" onClick={handleLogout}>退出登录</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="breadcrumb">
              {topbarGroup} / {pageTitles[activePage]}
            </p>
            <h1>{topbarTitle}</h1>
          </div>
          <div className="top-actions">
            <button type="button" className="month-pill" onClick={openDatePicker}>
              {formatMonthLabel(selectedMonth)}
            </button>
            <button type="button" className="icon-command top-backup-button" onClick={() => setIsBackupOpen(true)} title="备份与恢复" aria-label="备份与恢复">
              <DatabaseBackup size={17} />
            </button>
            <button type="button" className="record-button" onClick={() => openAction("transaction")} title="记一笔" aria-label="记一笔">
              <Plus size={20} /> 记一笔
            </button>
            <button type="button" className="mobile-logout-button" onClick={handleLogout}>
              退出
            </button>
          </div>
        </header>

        {dataLoadError && (
          <div className="data-load-error" role="alert">
            部分数据加载失败：{dataLoadError}
          </div>
        )}

        {renderActionPanel()}
        {renderInvestmentCashEditor()}
        {renderAccountDetail()}
        {renderGoalRecords()}
        {renderDatePicker()}
        {importPreview && <StatementImportDialog preview={importPreview} onClose={() => setImportPreview(null)} onImported={async (result) => {
          setImportPreview(null); await loadData(); alert(`${result.message}，跳过 ${result.skipped} 笔。`);
        }} />}
        {isBackupOpen && <BackupDialog onClose={() => setIsBackupOpen(false)} onDownload={handleDownloadBackup} onRestored={async () => {
          setBudgetDrafts({}); setCashDrafts({}); cashDirtyAccountIdsRef.current.clear();
          setAccountDetail(null); setGoalRecords(null); setLedgerAccountFilter("all"); setTradeAccountFilter("all");
          localStorage.removeItem(RECENT_ACCOUNT_KEY); await loadData();
        }} />}
        {reversalTarget && <ReversalDialog target={reversalTarget} onClose={() => setReversalTarget(null)} onReversed={async () => {
          setReversalTarget(null); await loadData();
        }} />}

        <Suspense fallback={<div className="empty-state page-loading">页面加载中...</div>}>
          <ActivePageComponent view={pageView} />
        </Suspense>
      </main>
    </div>
  );
}

export default App;
