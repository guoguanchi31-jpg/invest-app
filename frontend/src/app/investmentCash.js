export const INVESTMENT_CASH_ADJUSTMENT_REASON = "手动核对现金可投";

export function buildInvestmentCashAdjustment(accountId, draft, baseline) {
  const cashAvailable = Number(draft || 0);
  const expectedCashAvailable = Number(baseline);
  if (!Number.isFinite(cashAvailable) || cashAvailable < 0) {
    throw new Error("现金可投金额不能为负数");
  }
  if (!Number.isFinite(expectedCashAvailable)) {
    throw new Error("现金余额基准已失效，请刷新后重新编辑");
  }
  return {
    account_id: Number(accountId),
    cash_available: cashAvailable,
    expected_cash_available: expectedCashAvailable,
    reason: INVESTMENT_CASH_ADJUSTMENT_REASON,
  };
}
