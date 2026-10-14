import {
  displayText,
  joinDisplayText,
  normalizeDisplayText,
} from "../../shared/displayContent";

export function buildInvestmentViews({
  assetTypeLabels,
  cashDrafts,
  colors,
  fallback,
  formatPrice,
  formatTrendLabel,
  holdingFilter,
  investmentData,
  normalizeOwner,
}) {
  const totalValue = investmentData.total_value ?? fallback.total_value;
  const holdings = investmentData.holdings
    ? investmentData.holdings.map((item) => {
      const marketValue = item.market_value
        || (item.current_price || 0) * (item.quantity || 0);
      const rawCode = normalizeDisplayText(item.code);
      const assetType = normalizeDisplayText(
        assetTypeLabels[item.asset_type] || item.asset_type,
      );
      const accountName = normalizeDisplayText(item.account_name);
      return {
        id: item.id,
        name: displayText(item.name, "未命名持仓"),
        code: joinDisplayText([rawCode, assetType]) || "未提供代码",
        rawCode,
        buy_price: item.buy_price,
        quantity: item.quantity,
        current_price: item.current_price,
        account_id: item.account_id,
        can_edit: item.can_edit !== 0,
        included_in_totals: item.included_in_totals,
        account_name: accountName
          ? joinDisplayText([item.account_owner, accountName])
          : "未关联账户 · 暂不计入汇总",
        asset_type: item.asset_type,
        market: item.market,
        currency: item.currency,
        exchange_rate_to_base: item.exchange_rate_to_base,
        cost: formatPrice(item.buy_price),
        price: formatPrice(item.current_price),
        value: marketValue,
        profit: item.profit || 0,
        returnRate: item.profit_rate || 0,
        percent: item.included_in_totals !== 0 && totalValue
          ? Math.round(marketValue / totalValue * 1000) / 10
          : 0,
      };
    })
    : [];
  return {
    filteredInvestmentHoldingsView: holdings.filter((item) => {
      if (holdingFilter === "基金") {
        return item.code.includes("基金") || item.code.includes("fund");
      }
      if (holdingFilter === "股票") {
        return item.code.includes("股票") || item.code.includes("stock");
      }
      return true;
    }),
    investmentAllocationView: (investmentData.allocation ?? fallback.allocation)
      .filter((item) => (
        normalizeDisplayText(item.name)
        && Number.isFinite(Number(item.value))
        && Number(item.value) > 0
        && Number.isFinite(Number(item.percent))
        && Number(item.percent) > 0
      ))
      .map((item, index) => ({
        ...item,
        name: displayText(assetTypeLabels[item.name] || item.name, "其他"),
        color: colors[index % colors.length],
      })),
    investmentCashAccountsView: (
      investmentData.cash_accounts ?? fallback.cash_accounts
    ).map((account) => ({
      ...account,
      owner: normalizeOwner(account.owner),
      draft: cashDrafts[account.id]
        ?? String(account.cash_available_original ?? account.cash_available ?? 0),
    })),
    investmentCashAvailable:
      investmentData.cash_available ?? fallback.cash_available,
    investmentHoldingsView: holdings,
    investmentProfit: investmentData.total_profit ?? fallback.total_profit,
    investmentProfitRate: investmentData.profit_rate ?? fallback.profit_rate,
    investmentTotalValue: totalValue,
    investmentTrendView: (investmentData.trend ?? fallback.trend)
      .map((item, index) => ({
        month: formatTrendLabel(item.date, index),
        mine: Math.round((item.value || 0) / 1000) / 10,
      })),
  };
}
