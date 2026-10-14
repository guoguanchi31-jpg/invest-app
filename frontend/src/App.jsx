import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { BookOpen, CalendarRange, ChevronDown, ChevronRight, DatabaseBackup, House, LayoutDashboard, LogIn, LogOut, Plus, QrCode, Settings, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import StatementImportDialog from "./components/StatementImportDialog";
import BackupDialog from "./components/BackupDialog";
import ChartRangeSwitch from "./components/ChartRangeSwitch";
import DialogActions, { DialogAction } from "./components/DialogActions";
import FamilyDialog from "./components/FamilyDialog";
import InvestmentCashDialog from "./components/InvestmentCashDialog";
import ReversalDialog from "./components/ReversalDialog";
import ModalBackdrop from "./components/ModalBackdrop";
import ModalPanel from "./components/ModalPanel";
import FormField from "./components/FormField";
import {
  EMPTY_BUDGET as fallbackBudget,
  EMPTY_DASHBOARD as fallbackDashboard,
  EMPTY_GOALS as fallbackGoals,
  EMPTY_INVESTMENT as fallbackInvestment,
} from "./app/dataDefaults";
import useFinanceData from "./app/useFinanceData";
import useDeleteAction from "./app/useDeleteAction";
import useSession from "./app/useSession";
import AccountDetailDialog from "./features/accounts/AccountDetailDialog";
import ReconciliationDialog from "./features/accounts/ReconciliationDialog";
import {
  ACCOUNT_TYPE_LABELS as accountTypeLabels,
  buildAccountViews,
} from "./features/accounts/presentation";
import useAccountDetail from "./features/accounts/useAccountDetail";
import { downloadFamilyBackup } from "./features/backup/actions";
import {
  copyPreviousBudget,
  saveBudgetPlan,
} from "./features/budget/actions";
import { buildBudgetView } from "./features/budget/presentation";
import { buildDashboardView } from "./features/dashboard/presentation";
import {
  saveGoalPlan,
} from "./features/goals/actions";
import { buildGoalViews } from "./features/goals/presentation";
import GoalRecordsDialog from "./features/goals/GoalRecordsDialog";
import useGoalWorkspace from "./features/goals/useGoalWorkspace";
import {
  useInvestmentDrafts,
  useInvestmentMutations,
} from "./features/investments/useInvestmentWorkspace";
import { buildInvestmentViews } from "./features/investments/presentation";
import {
  downloadLedger,
  previewStatementImport,
} from "./features/ledger/actions";
import {
  currentMonthValue,
  formatBusinessDateLabel as formatDateLabel,
  formatGoalDue,
  todayInputValue,
} from "./shared/businessDate";
import {
  formatCurrencyAmount,
  formatExchangeRate,
  formatMoney,
} from "./shared/money";
import {
  displayText,
  joinDisplayText,
  normalizeDisplayText,
} from "./shared/displayContent";
import { RECENT_ACCOUNT_KEY } from "./features/ledger/drafts";
import useActionWorkspace from "./app/useActionWorkspace";
import { useCommandActions } from "./features/shared/useSubmission";
import ActionDialog from "./app/ActionDialog";
import { repaymentDraft } from "./settlement";
import usePaginatedResource from "./usePaginatedResource";
import { isStaleRequestError } from "./api";
import GuestPreview from "./app/GuestPreview";
import SiteFooter from "./components/SiteFooter";
import { GUEST_DISPLAY_NAME } from "./guest/mode";

const pageComponents = {
  dashboard: lazy(() => import("./pages/DashboardPage")),
  ledger: lazy(() => import("./pages/LedgerPage")),
  assets: lazy(() => import("./pages/AssetsPage")),
  plan: lazy(() => import("./pages/PlanPage")),
};
const AppDownloadDialog = lazy(() => import("./components/AppDownloadDialog"));

const USER_DISPLAY_NAME = import.meta.env.VITE_USER_NAME || "冠池";
const DEFAULT_ACCOUNT_OWNER = USER_DISPLAY_NAME || "冠池";
const TRADE_FILTER_ALIASES = Object.freeze({ accountId: "account_id" });

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

const colors = ["#176b4d", "#b77a22", "#5f927c", "#d8a54c", "#4f7ea3", "#c45d52"];
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
  服饰: "👕",
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
  goal: [
    { value: "12m", label: "近12月" },
    { value: "6m", label: "近6月" },
    { value: "year", label: "今年" },
  ],
};

function normalizeAccountOwner(owner) {
  return (owner || "").trim() || DEFAULT_ACCOUNT_OWNER;
}

function formatAccountLabel(account) {
  if (!account) return "未知账户";
  const owner = normalizeAccountOwner(normalizeDisplayText(
    account.owner || account.account_owner || account.institution,
  ));
  const name = displayText(account.name || account.account_name, "未知账户");
  return joinDisplayText([owner, name]);
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
    <span className={`icon-badge ${className}`} style={{ "--icon-color": color || "#176b4d" }}>
      {getCategoryIcon(name, icon, type)}
    </span>
  );
}

function getRangeLabel(options, value) {
  return options.find((option) => option.value === value)?.label || timeRangeLabels[value] || value;
}

function UserMenu({
  familyName,
  initial,
  isGuestMode,
  onAppDownload,
  onBackup,
  onFamily,
  onLogout,
  showAppDownload,
  userName,
  userRole,
}) {
  return (
    <div id="user-menu" className="user-menu-popover" role="menu" aria-label="用户菜单">
      <div className="user-menu-profile">
        <span className="member-avatar large">{initial}</span>
        <div>
          <strong>{userName}</strong>
          <small>
            {isGuestMode
              ? `${familyName} · 本地示例`
              : `${familyName} · ${userRole === "owner" ? "创建者" : userRole === "admin" ? "管理员" : "成员"}`}
          </small>
        </div>
      </div>
      {!isGuestMode ? <button type="button" className="user-menu-item" role="menuitem" onClick={onFamily}>
        <Settings size={18} />
        <span>
          <strong>家庭与成员</strong>
          <small>管理家庭名称和登录账号</small>
        </span>
        <ChevronRight size={16} />
      </button> : null}
      {!isGuestMode ? <button type="button" className="user-menu-item" role="menuitem" onClick={onBackup}>
        <DatabaseBackup size={18} />
        <span>
          <strong>数据与备份</strong>
          <small>下载或恢复完整账本</small>
        </span>
        <ChevronRight size={16} />
      </button> : null}
      {showAppDownload ? (
        <button type="button" className="user-menu-item" role="menuitem" onClick={onAppDownload}>
          <QrCode size={18} />
          <span>
            <strong>扫码下载 App</strong>
            <small>打开 Android 下载二维码</small>
          </span>
          <ChevronRight size={16} />
        </button>
      ) : null}
      <div className="user-menu-divider" />
      <button type="button" className="user-menu-item danger" role="menuitem" onClick={onLogout}>
        <LogOut size={18} />
        <span><strong>{isGuestMode ? "退出游客模式" : "退出登录"}</strong></span>
      </button>
    </div>
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
                <i style={{ background: item.color || item.payload?.color || "#176b4d" }} />
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
  const maxDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const day = String(Math.min(parts.day || 1, maxDay)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addPickerMonths(parts, offset) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(parts.day || 1, maxDay) };
}

function addMonthsValue(monthValue, offset) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getCalendarDays(year, month) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
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

function App() {
  const {
    authSession,
    changeScope,
    dataIdentityKey,
    dataScope,
    enterGuestMode,
    familyData,
    guestMode,
    identityError,
    loadIdentity,
    loggedIn,
    login,
    logout,
    password,
    setPassword,
    setUsername,
    username,
  } = useSession();
  const sessionReady = loggedIn && Boolean(authSession);
  const isNativeApp = Capacitor.isNativePlatform();
  const useAppExperience = isNativeApp
    || new URLSearchParams(window.location.search).has("appPreview");
  const [activePage, setActivePage] = useState("dashboard");
  const [assetSection, setAssetSection] = useState("accounts");
  const [planSection, setPlanSection] = useState("budget");
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState("all");
  const [tradeAccountFilter, setTradeAccountFilter] = useState("all");
  const [importPreview, setImportPreview] = useState(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [reconciliationTarget, setReconciliationTarget] = useState(null);
  const openReconciliation = (accountId) => setReconciliationTarget({ accountId });
  const [bookRevision, setBookRevision] = useState(0);
  const [isFamilyOpen, setIsFamilyOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAppDownloadOpen, setIsAppDownloadOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [reversalTarget, setReversalTarget] = useState(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState(null);
  const [datePickerDraftParts, setDatePickerDraftParts] = useState(() => parsePickerValue(currentMonthValue(), "month"));
  const [monthSelection, setSelectedMonth] = useState(null);
  const selectedMonth = monthSelection || currentMonthValue();
  const [dashboardTrendRange, setDashboardTrendRange] = useState("12m");
  const [investmentTrendRange, setInvestmentTrendRange] = useState("12m");
  const [goalPlanRange, setGoalPlanRange] = useState("12m");
  const {
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    cashDrafts,
    clearInvestmentDrafts,
    cashSubmissions,
    holdingFilter,
    isCashEditorOpen,
    setCashDrafts,
    setHoldingFilter,
    setIsCashEditorOpen,
    updateInvestmentCashDraft: handleInvestmentCashDraftChange,
  } = useInvestmentDrafts();
  const {
    accountsData,
    archivedAccountsData,
    budgetData,
    categoriesData,
    dashboardData,
    dataLoadError,
    dataLoading,
    dataRevision,
    goalsData,
    investmentData,
    loadData,
    resourceConfirmations,
    setDataLoadError,
    setDataRevision,
    setInvestmentData,
  } = useFinanceData({
    activePage,
    assetSection,
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    dashboardTrendRange,
    dataIdentityKey,
    dataScope,
    goalPlanRange,
    investmentTrendRange,
    loggedIn: sessionReady,
    planSection,
    selectedMonth,
    setCashDrafts,
  });
  const {
    isRefreshing,
    quoteRefreshResult,
    refreshInvestmentQuotes: handleRefresh,
    saveInvestmentCash: handleSaveInvestmentCash,
    savingCashAccountId,
  } = useInvestmentMutations({
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    cashDrafts,
    cashSubmissions,
    dataIdentityKey,
    dataScope,
    loadData,
    setInvestmentData,
  });
  const {
    items: ledgerData,
    meta: ledgerMeta,
    request: ledgerRequest,
    loadPage: loadLedgerPage,
  } = usePaginatedResource({
    dataScope,
    endpoint: "/ledger",
    identityKey: dataIdentityKey,
    pageSize: 30,
    withSummary: true,
  });
  const {
    items: investmentTrades,
    meta: investmentTradesMeta,
    request: investmentTradesRequest,
    loadPage: loadInvestmentTradesPage,
  } = usePaginatedResource({
    dataScope,
    endpoint: "/investments/trades",
    filterAliases: TRADE_FILTER_ALIASES,
    identityKey: dataIdentityKey,
    pageSize: 50,
  });

  useEffect(() => {
    setIsUserMenuOpen(false);
    setIsBackupOpen(false);
    setReconciliationTarget(null);
    setIsFamilyOpen(false);
    setImportPreview(null);
    setReversalTarget(null);
    clearInvestmentDrafts();
  }, [clearInvestmentDrafts, dataIdentityKey]);

  useEffect(() => {
    if (!isUserMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsUserMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isUserMenuOpen]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError("");
    try {
      if (!await login()) {
        setLoginError("账号或密码错误");
        return;
      }
      setIsLoginOpen(false);
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleEnterGuestMode = () => {
    setIsLoginOpen(false);
    setLoginError("");
    setActivePage("dashboard");
    setAssetSection("accounts");
    setPlanSection("budget");
    setLedgerAccountFilter("all");
    setTradeAccountFilter("all");
    enterGuestMode();
  };

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    setIsLoginOpen(false);
    setLoginError("");
    clearActionWorkspace();
    clearInvestmentDrafts();
    setIsBackupOpen(false);
    setIsFamilyOpen(false);
    setImportPreview(null);
    setReversalTarget(null);
    closeAccountDetail();
    closeGoalRecords();
    localStorage.removeItem(RECENT_ACCOUNT_KEY);
    logout();
  };

  const openBackupFromUserMenu = () => {
    setIsUserMenuOpen(false);
    setIsBackupOpen(true);
  };

  const openFamilyFromUserMenu = () => {
    setIsUserMenuOpen(false);
    setIsFamilyOpen(true);
    loadIdentity().catch((error) => {
      if (!isStaleRequestError(error)) {
        setDataLoadError(`身份信息：${error.message}`);
      }
    });
  };

  const handleScopeChange = (scope) => {
    if (!changeScope(scope)) return;
    setLedgerAccountFilter("all");
    setTradeAccountFilter("all");
    closeAccountDetail();
    closeGoalRecords();
    clearInvestmentDrafts();
  };

  const accountOwnerOptions = useMemo(() => {
    const memberNames = (familyData.members || [])
      .filter((member) => (dataScope === "family" && familyData.can_manage) || member.is_current)
      .map((member) => member.display_name);
    const owners = memberNames.length
      ? memberNames
      : (accountsData?.accounts || []).map((account) => normalizeAccountOwner(account.owner || account.institution));
    return Array.from(new Set(owners.length ? owners : [DEFAULT_ACCOUNT_OWNER]));
  }, [accountsData?.accounts, dataScope, familyData.can_manage, familyData.members]);
  const requestOptions = useMemo(() => ({
    scope: dataScope,
    operationIdentity: authSession?.user?.id && authSession?.family?.id
      ? `${authSession.user.id}:${authSession.family.id}:${dataScope}`
      : undefined,
  }), [authSession?.family?.id, authSession?.user?.id, dataScope]);
  const runCommand = useCommandActions(dataIdentityKey, resourceConfirmations);
  const markDataChanged = useCallback(() => {
    setDataRevision((value) => value + 1);
  }, [setDataRevision]);
  const reloadBook = useCallback(async () => {
    setDataLoadError("");
    const [dataApplied, identityApplied] = await Promise.all([
      loadData(),
      loadIdentity().catch((error) => {
        if (!isStaleRequestError(error)) setDataLoadError(`身份信息：${error.message}`);
        return false;
      }),
    ]);
    return dataApplied && identityApplied;
  }, [loadData, loadIdentity, setDataLoadError]);
  const handleFamilyChanged = useCallback(async () => {
    markDataChanged();
    return reloadBook();
  }, [markDataChanged, reloadBook]);
  const {
    accountDetail,
    closeAccountDetail,
    handleRestoreAccount,
    openAccountDetail,
    restoringAccountId,
  } = useAccountDetail({
    dataIdentityKey,
    dataScope,
    loadData,
    onDataChanged: markDataChanged,
    requestOptions,
    resourceConfirmations,
  });
  const {
    closeGoalRecords,
    goalRecords,
    handleGoalStatus,
    openGoalRecords,
  } = useGoalWorkspace({
    dataIdentityKey,
    dataScope,
    loadData,
    requestOptions,
    resourceConfirmations,
    selectedMonth,
  });
  const {
    actionMode,
    clearActionWorkspace,
    closeActionPanel,
    editTarget,
    form,
    getAccountById,
    handleChange,
    isAdding,
    isSubmitting,
    openAction,
    openEditAction,
    setForm,
    submitAction: handleSubmitAction,
    submitPlan,
  } = useActionWorkspace({
    accountsData,
    authSession,
    dataIdentityKey,
    dataScope,
    defaultOwner: DEFAULT_ACCOUNT_OWNER,
    familyData,
    loadData,
    normalizeOwner: normalizeAccountOwner,
    onDataChanged: markDataChanged,
    refreshInvestmentQuotes: handleRefresh,
    requestOptions,
    selectedMonth,
  });

  const openAdjustment = (account) => {
    const currentBalance = account.type === "investment"
      ? (account.cash_available_original ?? 0)
      : (account.original_balance ?? account.balance ?? 0);
    closeAccountDetail();
    openAction("adjustment", {
      account_id: String(account.id),
      actual_balance: String(currentBalance),
      expected_balance: String(currentBalance),
    });
  };

  const openRepayment = (creditAccount) => {
    const targetOwner = normalizeAccountOwner(
      creditAccount.owner || creditAccount.institution,
    );
    const sources = (accountsData.accounts || []).filter(
      (account) => account.can_edit !== false
        && !account.is_liability
        && account.id !== creditAccount.id,
    );
    const source = sources.find(
      (account) => (
        normalizeAccountOwner(account.owner || account.institution) === targetOwner
        && account.type !== "investment"
      ),
    ) || sources.find(
      (account) => normalizeAccountOwner(account.owner || account.institution) === targetOwner,
    ) || sources.find((account) => account.type !== "investment")
      || sources[0];
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
    const defaultAllocation = goal.allocations?.find(
      (allocation) => allocation.member_id === familyData.current_member_id,
    ) || goal.allocations?.[0];
    openAction("goal_record", {
      goal_id: String(goal.id),
      name: goal.name,
      goal_record_type: recordType,
      amount: "",
      member_id: defaultAllocation?.member_id ? String(defaultAllocation.member_id) : "",
      goal_allocations: goal.allocations || [],
    });
  };

  const handleCopyPreviousBudget = async () => {
    await runCommand(`copy-budget:${selectedMonth}`, {
      resourceKey: `budget:${selectedMonth}`,
      write: (options) => copyPreviousBudget({
        selectedMonth,
        sourceMonth: addMonthsValue(selectedMonth, -1),
        requestOptions: options,
      }),
      requestOptions,
      onCommitted: (result) => {
        if (result) alert(result.skipped ? `已沿用 ${result.copied} 项，跳过 ${result.skipped} 项已有预算。` : result.message);
      },
      refresh: loadData,
    });
  };

  const handleDownloadLedger = () => downloadLedger(requestOptions)
    .catch((error) => {
      if (!isStaleRequestError(error)) alert(`导出流水失败：${error.message}`);
    });

  const handleDownloadBackup = () => downloadFamilyBackup(
    `invest-backup-${todayInputValue()}.json`,
    requestOptions,
  )
    .catch((error) => {
      if (!isStaleRequestError(error)) alert(`下载备份失败：${error.message}`);
    });

  const handleStatementImport = async (rows, skipped = 0) => {
    if (!rows.length) {
      alert(`账单中没有可导入的收支流水${skipped ? `，已排除 ${skipped} 条转账、期初、调整或已撤销记录。完整迁移请使用 JSON 备份恢复` : ""}`);
      return;
    }
    try {
      const preview = await previewStatementImport(rows, requestOptions);
      setImportPreview({ ...preview, skipped });
    } catch (error) {
      if (!isStaleRequestError(error)) {
        alert(`导入账单失败：${error.message}`);
      }
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
    setIsDatePickerOpen(true);
  };

  const handleApplyDatePicker = () => {
    if (!datePickerTarget) return;
    const nextValue = buildPickerValue(datePickerDraftParts, datePickerTarget.mode);
    if (datePickerTarget.scope === "filter") {
      setSelectedMonth(nextValue);
      setForm((value) => ({ ...value, month: nextValue }));
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

  const handleDelete = useDeleteAction({
    runCommand, requestOptions, selectedMonth, closeActionPanel,
    onDataChanged: markDataChanged, refresh: loadData,
  });

  const {
    assetData,
    budgetLeft,
    budgetPercent,
    budgetTotal,
    dashboardTransactions,
    monthlyExpense,
    monthlyIncome,
    netWorth,
    trendData,
  } = buildDashboardView({
    dashboardData,
    fallback: fallbackDashboard,
    formatAccountLabel,
    formatDateLabel,
    formatTrendLabel,
    getAccountById,
    getCategoryIcon,
  });
  const {
    accountDistributionView,
    accountOwnerGroups,
    assetAccountsView,
    creditAccountsView,
  } = buildAccountViews({
    accountsData,
    colors,
    formatMoney,
    normalizeOwner: normalizeAccountOwner,
  });
  const {
    filteredInvestmentHoldingsView,
    investmentAllocationView,
    investmentCashAccountsView,
    investmentCashAvailable,
    investmentHoldingsView,
    investmentProfit,
    investmentProfitRate,
    investmentTotalValue,
    investmentTrendView,
  } = buildInvestmentViews({
    assetTypeLabels,
    cashDrafts,
    colors,
    fallback: fallbackInvestment,
    formatPrice,
    formatTrendLabel,
    holdingFilter,
    investmentData,
    normalizeOwner: normalizeAccountOwner,
  });
  const {
    budgetCategoriesView,
    budgetUsedPercent,
  } = buildBudgetView({
    budgetData,
    colors,
    fallback: fallbackBudget,
    getCategoryIcon,
    selectedMonth,
  });
  const {
    goalAdvice,
    goalCardsView,
    goalPlanView,
  } = buildGoalViews({
    colors,
    fallback: fallbackGoals,
    formatGoalDue,
    formatMoney,
    formatTrendLabel,
    getGoalIcon,
    goalsData,
  });
  const currentUserName = sessionReady
    ? authSession?.user?.display_name || (guestMode ? GUEST_DISPLAY_NAME : USER_DISPLAY_NAME)
    : "登录账号";
  const currentFamilyName = sessionReady
    ? familyData.name || authSession?.family?.name || "我的家庭"
    : "家庭账本";
  const currentUserInitial = Array.from(currentUserName.trim())[0] || "我";
  const privateTopbarTitle = {
    dashboard: dataScope === "family" ? `${currentFamilyName}财务总览` : `${getGreeting()}，${currentUserName}`,
    ledger: "流水明细",
    assets: assetSection === "accounts" ? "账户与负债" : "投资持仓",
    plan: planSection === "budget" ? "月度预算" : "储蓄目标",
  }[activePage] || pageTitles[activePage];
  const publicTopbarTitle = {
    dashboard: "家庭财务总览",
    ledger: "流水明细",
    assets: assetSection === "accounts" ? "账户与负债" : "投资持仓",
    plan: planSection === "budget" ? "月度预算" : "储蓄目标",
  }[activePage] || pageTitles[activePage];
  const topbarTitle = sessionReady ? privateTopbarTitle : publicTopbarTitle;
  const topbarGroup = sessionReady
    ? dataScope === "family" ? currentFamilyName : currentUserName
    : "Invest";
  const dashboardTrendLabel = getRangeLabel(chartRangeOptions.trend, dashboardTrendRange);
  const investmentTrendLabel = getRangeLabel(chartRangeOptions.trend, investmentTrendRange);
  const goalPlanLabel = getRangeLabel(chartRangeOptions.goal, goalPlanRange);
  const dashboardTrendHint = dashboardTrendRange === "month" ? "按日快照" : "月度快照";
  const investmentTrendHint = investmentTrendRange === "month" ? "按日快照" : "月度快照";
  const visibleDataLoadError = [
    identityError,
    dataLoadError,
    ledgerRequest.error ? `完整账本：${ledgerRequest.error}` : "",
    investmentTradesRequest.error ? `投资交易：${investmentTradesRequest.error}` : "",
  ].filter(Boolean).join("；");
  const ActivePageComponent = pageComponents[activePage] || pageComponents.dashboard;
  const pageViews = {
    dashboard: {
      ChartRangeSwitch, ChartTooltip, IconBadge, assetData, budgetLeft,
      budgetPercent, budgetTotal, chartRangeOptions, dashboardTransactions,
      dashboardTrendHint, dashboardTrendLabel, dashboardTrendRange, dataScope,
      formatMoney, goalCardsView, monthlyExpense, monthlyIncome, netWorth,
      openEditAction, setActivePage, setDashboardTrendRange, setPlanSection,
      trendData,
    },
    ledger: {
      accountOwnerOptions, accountsData, categoriesData, dataIdentityKey, dataRevision, dataScope,
      formatDateLabel, formatMoney, handleDownloadLedger, handleStatementImport,
      isGuestMode: guestMode, ledgerAccountFilter, ledgerData, ledgerMeta, ledgerRequest,
      loadLedgerPage, monthlyExpense, monthlyIncome, openAction, openEditAction,
      openReconciliation: guestMode ? null : openReconciliation,
      selectedMonth, setLedgerAccountFilter, setReversalTarget,
    },
    assets: {
      ChartRangeSwitch, ChartTooltip, accountDistributionView, accountOwnerGroups,
      accountsData, archivedAccountsData, assetAccountsView, assetSection,
      chartRangeOptions, creditAccountsView, dataRevision,
      filteredInvestmentHoldingsView, formatMoney, formatQuoteSources,
      handleRefresh: (...args) => handleRefresh(...args), holdingFilter,
      investmentAllocationView, investmentCashAccountsView,
      investmentCashAvailable, investmentHoldingsView, investmentProfit,
      investmentProfitRate, investmentTotalValue, investmentTrades,
      investmentTradesMeta, investmentTradesRequest, investmentTrendHint,
      investmentTrendLabel, investmentTrendRange, investmentTrendView,
      isRefreshing, loadInvestmentTradesPage, openAccountDetail, openAction,
      openEditAction, openRepayment, openTradeAction, quoteRefreshResult,
      setAssetSection, setHoldingFilter, setInvestmentTrendRange,
      setIsCashEditorOpen, setReversalTarget, setTradeAccountFilter,
      tradeAccountFilter,
    },
    plan: {
      ChartRangeSwitch, ChartTooltip, IconBadge, chartRangeOptions,
      budgetCategoriesView, budgetData, budgetUsedPercent,
      canManagePlans: dataScope === "family" && familyData.can_manage,
      dataScope, formatMoney, formatMonthLabel, goalAdvice, goalCardsView,
      goalPlanLabel, goalPlanRange, goalPlanView, goalsData,
      handleCopyPreviousBudget, handleGoalStatus, openAction, openEditAction,
      openGoalRecord, openGoalRecords, planSection, selectedMonth,
      setGoalPlanRange, setPlanSection,
    },
  };
  const pageView = pageViews[activePage] || pageViews.dashboard;

  const renderAccountOwnerOptions = () => accountOwnerOptions.map((owner) => (
    <option key={owner} value={owner}>{owner}</option>
  ));

  const renderAccountOptions = (owner, predicate = () => true) => (accountsData?.accounts || [])
    .filter((account) => account.can_edit !== false)
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
    .filter((account) => account.can_edit !== false)
    .filter(predicate)
    .map((account) => (
      <option key={account.id} value={account.id}>
        {normalizeAccountOwner(account.owner || account.institution)} · {account.name}
      </option>
    ));

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

  const handleSaveBudget = (payload) => submitPlan(
    (options) => saveBudgetPlan(payload, options),
  );

  const handleSaveGoal = (payload) => submitPlan(
    (options) => saveGoalPlan({ editTarget, payload, requestOptions: options }),
  );

  const renderDatePicker = () => {
    if (!isDatePickerOpen || !datePickerTarget) return null;
    const isMonthMode = datePickerTarget.mode === "month";
    const currentValue = buildPickerValue(datePickerDraftParts, datePickerTarget.mode);
    const todayParts = parsePickerValue(todayInputValue(), "date");
    const monthNames = Array.from({ length: 12 }, (_, index) => index + 1);
    const calendarDays = getCalendarDays(datePickerDraftParts.year, datePickerDraftParts.month);
    return (
      <ModalBackdrop className="date-picker-layer" onClose={() => setIsDatePickerOpen(false)}>
        <ModalPanel
          bodyClassName="date-picker-body"
          eyebrow={datePickerTarget.scope === "filter" ? "页面筛选" : "选择日期"}
          footer={(
            <div className="date-picker-actions">
              {datePickerTarget.allowClear && <button type="button" className="ghost-button" onClick={handleClearDatePicker}>清空日期</button>}
              <button type="button" className="ghost-button" onClick={() => setIsDatePickerOpen(false)}>取消</button>
              <button type="button" className="record-button compact" onClick={handleApplyDatePicker}>确认选择</button>
            </div>
          )}
          onClose={() => setIsDatePickerOpen(false)}
          title={datePickerTarget.label}
          variant="date-picker"
        >
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
        </ModalPanel>
      </ModalBackdrop>
    );
  };

  return (
    <div className={`app-shell${sessionReady ? "" : " guest-shell"}${guestMode ? " guest-mode-shell" : ""}`}>
      {sessionReady && isUserMenuOpen && (
        <>
          <button type="button" className="user-menu-scrim" tabIndex={-1} aria-label="关闭用户菜单" onClick={() => setIsUserMenuOpen(false)} />
          <UserMenu
            familyName={currentFamilyName}
            initial={currentUserInitial}
            isGuestMode={guestMode}
            onAppDownload={() => {
              setIsUserMenuOpen(false);
              setIsAppDownloadOpen(true);
            }}
            onBackup={openBackupFromUserMenu}
            onFamily={openFamilyFromUserMenu}
            onLogout={handleLogout}
            showAppDownload={!isNativeApp}
            userName={currentUserName}
            userRole={familyData.role}
          />
        </>
      )}
      {!sessionReady && isLoginOpen && (
        <ModalBackdrop closeDisabled={isLoggingIn} onClose={() => setIsLoginOpen(false)}>
          <ModalPanel
            className="login-dialog"
            closeDisabled={isLoggingIn}
            eyebrow="家庭账本"
            footer={(
              <DialogActions>
                <DialogAction disabled={isLoggingIn} onClick={() => setIsLoginOpen(false)}>
                  取消
                </DialogAction>
                <DialogAction
                  disabled={isLoggingIn}
                  form="account-login-form"
                  type="submit"
                  variant="primary"
                >
                  {isLoggingIn ? "登录中…" : "登录"}
                </DialogAction>
              </DialogActions>
            )}
            onClose={() => setIsLoginOpen(false)}
            title="登录账号"
          >
            <form
              id="account-login-form"
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleLogin();
              }}
            >
              <label>
                <span>登录账号</span>
                <input
                  type="text"
                  aria-label="登录账号"
                  autoComplete="username"
                  autoFocus
                  placeholder="请输入登录账号"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                <span>登录密码</span>
                <input
                  type="password"
                  aria-label="登录密码"
                  autoComplete="current-password"
                  placeholder="请输入访问密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {loginError ? <div className="login-error" role="alert">{loginError}</div> : null}
            </form>
          </ModalPanel>
        </ModalBackdrop>
      )}
      {!isNativeApp && isAppDownloadOpen ? (
        <Suspense fallback={null}>
          <AppDownloadDialog onClose={() => setIsAppDownloadOpen(false)} />
        </Suspense>
      ) : null}
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
                  aria-label={item.label}
                  key={item.key}
                  onClick={() => {
                    setActivePage(item.key);
                    setIsUserMenuOpen(false);
                  }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="member-menu-shell">
          {sessionReady ? (
            <button
              type="button"
              className="member-card"
              aria-label="打开用户菜单"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              aria-controls="user-menu"
              onClick={() => setIsUserMenuOpen((open) => !open)}
            >
              <span className="member-avatar">{currentUserInitial}</span>
              <span className="member-copy">
                <strong>{currentUserName}</strong>
                <small>{currentFamilyName}</small>
              </span>
              <ChevronDown className="member-chevron" size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="member-card guest-member-card"
              aria-label="从侧栏登录账号"
              onClick={() => {
                setLoginError("");
                setIsLoginOpen(true);
              }}
            >
              <span className="member-avatar"><LogIn size={15} /></span>
              <span className="member-copy">
                <strong>登录账号</strong>
                <small>查看家庭账本</small>
              </span>
            </button>
          )}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-heading">
            <div>
              <p className="breadcrumb">
                {topbarGroup} / {pageTitles[activePage]}
              </p>
              <h1>{topbarTitle}</h1>
            </div>
            {sessionReady ? (
              <button
                type="button"
                className="mobile-profile-button"
                aria-label="打开移动端用户菜单"
                aria-haspopup="menu"
                aria-expanded={isUserMenuOpen}
                aria-controls="user-menu"
                onClick={() => setIsUserMenuOpen((open) => !open)}
              >
                {currentUserInitial}
              </button>
            ) : (
              <button
                type="button"
                className="mobile-profile-button"
                aria-label="从移动端登录账号"
                onClick={() => {
                  setLoginError("");
                  setIsLoginOpen(true);
                }}
              >
                <LogIn size={18} />
              </button>
            )}
          </div>
          <div className="top-actions">
            {sessionReady ? (
              <>
                <div className="scope-switch" role="group" aria-label="数据范围">
                  <button type="button" className={dataScope === "personal" ? "active" : ""} aria-pressed={dataScope === "personal"} onClick={() => handleScopeChange("personal")}>
                    <UserRound size={15} /> 个人
                  </button>
                  <button type="button" className={dataScope === "family" ? "active" : ""} aria-pressed={dataScope === "family"} onClick={() => handleScopeChange("family")}>
                    <House size={15} /> 家庭
                  </button>
                </div>
                <button type="button" className="month-pill" onClick={openDatePicker}>
                  <CalendarRange size={16} />
                  <span>{formatMonthLabel(selectedMonth)}</span>
                  <ChevronDown size={15} />
                </button>
                <button type="button" className="record-button" onClick={() => openAction("transaction")} title="记一笔" aria-label="记一笔">
                  <Plus size={20} />
                  <span className="record-button-label">记一笔</span>
                </button>
              </>
            ) : (
              <>
                {!isNativeApp ? (
                  <button
                    type="button"
                    className="app-download-button"
                    onClick={() => setIsAppDownloadOpen(true)}
                    title="扫码下载 App"
                    aria-label="扫码下载 App"
                  >
                    <QrCode size={17} />
                    扫码下载 App
                  </button>
                ) : null}
                <button
                  type="button"
                  className="login-account-button"
                  onClick={() => {
                    setLoginError("");
                    setIsLoginOpen(true);
                  }}
                >
                  <LogIn size={17} />
                  登录账号
                </button>
              </>
            )}
          </div>
        </header>

        {guestMode ? (
          <div className="guest-mode-banner" role="status">
            <span className="guest-mode-banner-icon"><ShieldCheck size={17} /></span>
            <div>
              <strong>游客模式</strong>
              <span>当前为本地示例数据，操作不会写入真实账本</span>
            </div>
            <button type="button" className="filter-button" onClick={handleLogout}>
              退出游客模式
            </button>
          </div>
        ) : null}

        {sessionReady && visibleDataLoadError && (
          <div className="data-load-error" role="alert">
            部分数据加载失败：{visibleDataLoadError}
            <button type="button" className="filter-button" onClick={() => void reloadBook()}>
              重新加载
            </button>
          </div>
        )}
        {sessionReady && dataLoading && (
          <div className="data-loading-state" role="status">正在加载当前账本...</div>
        )}

        {sessionReady ? (
          <>
            <ActionDialog
          actionMode={actionMode}
          budgetData={budgetData}
          categoriesData={categoriesData}
          dataScope={dataScope}
          editTarget={editTarget}
          familyData={familyData}
          form={form}
          formatMoney={formatMoney}
          formatMonthLabel={formatMonthLabel}
          getAccountById={getAccountById}
          handleChange={handleChange}
          handleDelete={handleDelete}
          handleSubmitAction={handleSubmitAction}
          isDatePickerOpen={isDatePickerOpen}
          isOpen={isAdding}
          isSubmitting={isSubmitting}
          onClose={closeActionPanel}
          onSaveBudget={handleSaveBudget}
          onSaveGoal={handleSaveGoal}
          renderAccountOptions={renderAccountOptions}
          renderAccountOwnerOptions={renderAccountOwnerOptions}
          renderAllAccountOptions={renderAllAccountOptions}
          renderDateButton={renderDateButton}
          renderInvestmentAccountOptions={renderInvestmentAccountOptions}
          selectedMonth={selectedMonth}
          useAppExperience={useAppExperience}
        />
        {isCashEditorOpen && (
          <InvestmentCashDialog
            accounts={investmentCashAccountsView}
            formatPrice={formatPrice}
            onClose={() => setIsCashEditorOpen(false)}
            onDraftChange={handleInvestmentCashDraftChange}
            onSave={handleSaveInvestmentCash}
            savingAccountId={savingCashAccountId}
          />
        )}
        <AccountDetailDialog
          accountDetail={accountDetail}
          onReconcile={guestMode ? null : openReconciliation}
          accounts={accountsData.accounts || []}
          accountTypeLabels={accountTypeLabels}
          closeAccountDetail={closeAccountDetail}
          formatCurrencyAmount={formatCurrencyAmount}
          formatDateLabel={formatDateLabel}
          formatExchangeRate={formatExchangeRate}
          formatMoney={formatMoney}
          handleRestoreAccount={handleRestoreAccount}
          normalizeOwner={normalizeAccountOwner}
          onAdjust={openAdjustment}
          onEdit={(account) => {
            closeAccountDetail();
            openEditAction("account", account);
          }}
          onOpenLedger={(account) => {
            setLedgerAccountFilter(String(account.id));
            closeAccountDetail();
            setActivePage("ledger");
          }}
          onOpenTrades={(account) => {
            setTradeAccountFilter(String(account.id));
            closeAccountDetail();
            setAssetSection("investments");
            setActivePage("assets");
          }}
          onRepay={(account) => {
            closeAccountDetail();
            openRepayment(account);
          }}
          restoringAccountId={restoringAccountId}
        />
        <GoalRecordsDialog
          closeGoalRecords={closeGoalRecords}
          formatDateLabel={formatDateLabel}
          formatMoney={formatMoney}
          goalRecords={goalRecords}
        />
        {renderDatePicker()}
        {!guestMode && reconciliationTarget && <ReconciliationDialog
          key={dataIdentityKey}
          accountId={reconciliationTarget.accountId}
          identityKey={dataIdentityKey}
          requestOptions={requestOptions}
          onClose={() => setReconciliationTarget(null)}
          onCorrected={() => { markDataChanged(); closeAccountDetail(); }}
          refresh={loadData}
        />}
        {!guestMode && isFamilyOpen && <FamilyDialog family={familyData} onClose={() => setIsFamilyOpen(false)} onChanged={handleFamilyChanged} />}
        {!guestMode && importPreview && <StatementImportDialog preview={importPreview} onClose={() => setImportPreview(null)} refresh={loadData} onImported={(result) => {
          setImportPreview(null); markDataChanged();
          if (result) alert(`${result.message}，跳过 ${result.skipped} 笔。`);
        }} />}
        {!guestMode && isBackupOpen && <BackupDialog canRestore={familyData.can_manage} onClose={() => setIsBackupOpen(false)} onDownload={handleDownloadBackup} refresh={reloadBook} onRestored={() => {
          clearActionWorkspace();
          clearInvestmentDrafts();
          setImportPreview(null); setReversalTarget(null);
          setBookRevision((revision) => revision + 1);
          closeAccountDetail(); closeGoalRecords(); setLedgerAccountFilter("all"); setTradeAccountFilter("all");
          localStorage.removeItem(RECENT_ACCOUNT_KEY); markDataChanged();
        }} />}
        {reversalTarget && <ReversalDialog target={reversalTarget} onClose={() => setReversalTarget(null)} refresh={loadData} onReversed={() => {
          setReversalTarget(null); markDataChanged();
        }} />}

            <Suspense fallback={<div className="empty-state page-loading">页面加载中...</div>}>
              <ActivePageComponent key={`${activePage}-${dataScope}-${bookRevision}`} view={pageView} />
            </Suspense>
          </>
        ) : (
          <GuestPreview
            activePage={activePage}
            assetSection={assetSection}
            onEnterGuest={handleEnterGuestMode}
            onLogin={() => {
              setLoginError("");
              setIsLoginOpen(true);
            }}
            planSection={planSection}
            setAssetSection={setAssetSection}
            setPlanSection={setPlanSection}
          />
        )}
        {!isNativeApp ? <SiteFooter /> : null}
      </main>
    </div>
  );
}

export default App;
