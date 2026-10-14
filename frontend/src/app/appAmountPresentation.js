const CURRENCY_SYMBOLS = {
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  JPY: "¥",
  USD: "$",
};

export function currencySymbol(currency = "CNY") {
  const normalized = String(currency || "CNY").trim().toUpperCase() || "CNY";
  return CURRENCY_SYMBOLS[normalized] || normalized;
}
