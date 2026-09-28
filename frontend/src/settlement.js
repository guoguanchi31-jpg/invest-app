export const accountCurrency = (account) => (account?.currency || "CNY").trim().toUpperCase();
export const originalBalance = (account) => account?.type === "investment"
  ? Number(account.cash_available_original ?? 0)
  : Number(account?.original_balance ?? (account?.balance || 0) / (account?.exchange_rate_to_base || 1));
export const originalMoney = (amount, currency) => `${Number(amount).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${currency}`;

export function repaymentDraft(source, target) {
  const debt = Math.max(originalBalance(target), 0);
  const sameCurrency = accountCurrency(source) === accountCurrency(target);
  const amount = sameCurrency ? debt : debt * (target?.exchange_rate_to_base || 1) / (source?.exchange_rate_to_base || 1);
  return { amount: source && debt ? String(Math.round(amount * 100) / 100) : "", to_amount: debt ? String(debt) : "" };
}

export function tradePreview(form, account) {
  const currency = accountCurrency(form);
  const cashCurrency = accountCurrency(account);
  const sameCurrency = currency === cashCurrency;
  const rate = sameCurrency ? 1 : Number(form.settlement_rate);
  const gross = Number(form.quantity) * Number(form.price);
  const fee = Number(form.fee || 0);
  const amount = form.trade_type === "sell" ? gross - fee : gross + fee;
  const valid = Boolean(account && rate > 0 && Number(form.quantity) > 0 && Number(form.price) > 0 && fee >= 0 && amount > 0);
  const cashChange = amount * rate * (form.trade_type === "sell" ? 1 : -1);
  return { currency, cashCurrency, sameCurrency, rate, gross, fee, valid,
    cashChange, remaining: originalBalance(account) + cashChange };
}
