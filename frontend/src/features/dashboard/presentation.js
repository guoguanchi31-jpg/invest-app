export function buildDashboardView({
  dashboardData,
  fallback,
  formatAccountLabel,
  formatDateLabel,
  formatTrendLabel,
  getAccountById,
  getCategoryIcon,
}) {
  const monthlyIncome = dashboardData.monthly_income;
  const monthlyExpense = dashboardData.monthly_expense;
  const budgetTotal = dashboardData.budget?.total ?? 0;
  const budgetLeft = dashboardData.monthly_balance;
  const netWorth = dashboardData.net_worth;
  const budgetPercent = budgetTotal ? monthlyExpense / budgetTotal * 100 : 0;
  const trendData = (dashboardData.trend || fallback.trend)
    .map((item, index) => ({
      month: formatTrendLabel(item.date, index),
      value: Math.round((item.value || 0) / 1000) / 10,
    }));
  const assetData = (dashboardData.asset_allocation || fallback.asset_allocation)
    .map((item) => ({
      name: item.name,
      value: item.percent,
      amount: item.value,
    }));
  const source = dashboardData.recent_transactions;
  const dashboardTransactions = source
    ? source.map((item) => ({
      id: item.id,
      account_id: item.account_id,
      category_id: item.category_id,
      category_name: item.category_name || "",
      name: item.merchant || item.note || item.category_name || "未命名流水",
      account: formatAccountLabel(item),
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
      color: item.color || (
        item.direction === "income" ? "#176b4d" : "#b77a22"
      ),
      can_edit: getAccountById(item.account_id)?.can_edit !== false,
    }))
    : [];
  return {
    assetData,
    budgetLeft,
    budgetPercent,
    budgetTotal,
    dashboardTransactions,
    monthlyExpense,
    monthlyIncome,
    netWorth,
    trendData,
  };
}
