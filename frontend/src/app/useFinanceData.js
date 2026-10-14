import { useCallback, useEffect, useState } from "react";
import useAccountsData from "../features/accounts/useAccountsData";
import useBudgetData from "../features/budget/useBudgetData";
import useDashboardData from "../features/dashboard/useDashboardData";
import useReferenceData from "../features/family/useReferenceData";
import useGoalsData from "../features/goals/useGoalsData";
import useInvestmentData from "../features/investments/useInvestmentData";


export default function useFinanceData({
  activePage,
  assetSection,
  cashDraftBaselinesRef,
  cashDirtyAccountIdsRef,
  dashboardTrendRange,
  dataScope,
  dataIdentityKey,
  goalPlanRange,
  investmentTrendRange,
  loggedIn,
  planSection,
  selectedMonth,
  setCashDrafts,
}) {
  const dashboardEnabled = activePage === "dashboard" || activePage === "ledger";
  const accountsEnabled = activePage === "assets" && assetSection === "accounts";
  const investmentEnabled = (
    activePage === "dashboard"
    || (activePage === "assets" && assetSection === "investments")
  );
  const budgetEnabled = activePage === "plan" && planSection === "budget";
  const goalsEnabled = (
    activePage === "dashboard"
    || (activePage === "plan" && planSection === "goals")
  );

  const { accounts, archived } = useAccountsData({
    dataScope,
    identityKey: dataIdentityKey,
    includeArchived: accountsEnabled,
    loggedIn,
  });
  const dashboard = useDashboardData({
    dataScope,
    enabled: dashboardEnabled,
    identityKey: dataIdentityKey,
    loggedIn,
    month: selectedMonth,
    trendRange: dashboardTrendRange,
  });
  const investment = useInvestmentData({
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    dataScope,
    enabled: investmentEnabled,
    identityKey: dataIdentityKey,
    loggedIn,
    month: selectedMonth,
    setCashDrafts,
    trendRange: investmentTrendRange,
  });
  const budget = useBudgetData({
    dataScope,
    enabled: budgetEnabled,
    identityKey: dataIdentityKey,
    loggedIn,
    month: selectedMonth,
  });
  const goals = useGoalsData({
    dataScope,
    enabled: goalsEnabled,
    identityKey: dataIdentityKey,
    loggedIn,
    month: selectedMonth,
    planRange: goalPlanRange,
  });
  const { categories } = useReferenceData({
    dataScope,
    identityKey: dataIdentityKey,
    loggedIn,
  });
  const [dataRevision, setDataRevision] = useState(0);
  const [localError, setDataLoadError] = useState("");
  const refreshAccounts = accounts.refresh;
  const refreshArchived = archived.refresh;
  const refreshBudget = budget.refresh;
  const refreshCategories = categories.refresh;
  const refreshDashboard = dashboard.refresh;
  const refreshGoals = goals.refresh;
  const refreshInvestment = investment.refresh;

  const loadData = useCallback(async () => {
    const results = await Promise.all([
      refreshAccounts(),
      refreshArchived(),
      refreshDashboard(),
      refreshInvestment(),
      refreshBudget(),
      refreshGoals(),
      refreshCategories(),
    ]);
    return results.every(Boolean);
  }, [
    refreshAccounts,
    refreshArchived,
    refreshBudget,
    refreshCategories,
    refreshDashboard,
    refreshGoals,
    refreshInvestment,
  ]);

  useEffect(() => {
    setDataLoadError("");
    setCashDrafts({});
    cashDraftBaselinesRef.current.clear();
    cashDirtyAccountIdsRef.current.clear();
  }, [
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    dataIdentityKey,
    setCashDrafts,
  ]);

  useEffect(() => {
    if (!loggedIn) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void loadData().then((applied) => {
          if (applied) setDataRevision((value) => value + 1);
        });
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

  const errors = [
    ["账户", accounts.error],
    ["已归档账户", archived.error],
    ["看板", dashboard.error],
    ["投资", investment.error],
    ["预算", budget.error],
    ["目标", goals.error],
    ["分类", categories.error],
  ].filter(([, error]) => error).map(([name, error]) => `${name}：${error}`);

  return {
    resourceConfirmations: [accounts.confirmation, archived.confirmation, budget.confirmation, goals.confirmation],
    accountsData: accounts.data,
    archivedAccountsData: archived.data,
    budgetData: budget.data,
    categoriesData: categories.data,
    dashboardData: dashboard.data,
    dataLoadError: localError || errors.join("；"),
    dataLoading: [
      accounts,
      archived,
      dashboard,
      investment,
      budget,
      goals,
      categories,
    ].some((resource) => resource.loading),
    dataRevision,
    goalsData: goals.data,
    investmentData: investment.data,
    loadData,
    setDataLoadError,
    setDataRevision,
    setInvestmentData: investment.setData,
  };
}
