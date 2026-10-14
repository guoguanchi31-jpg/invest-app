const cnyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const originalAmountFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const exchangeRateFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

function finiteAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Object.is(amount, -0)) return 0;
  return amount;
}

export function normalizeCurrency(currency) {
  return String(currency || "CNY").trim().toUpperCase() || "CNY";
}

export function isForeignCurrency(currency) {
  return normalizeCurrency(currency) !== "CNY";
}

export function formatMoney(value) {
  return cnyFormatter.format(finiteAmount(value));
}

export function formatCurrencyAmount(value, currency) {
  return `${originalAmountFormatter.format(finiteAmount(value))} ${normalizeCurrency(currency)}`;
}

export function formatExchangeRate(value) {
  return `¥${exchangeRateFormatter.format(finiteAmount(value))}`;
}
