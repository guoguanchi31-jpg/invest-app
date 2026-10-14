export function investmentDraft({ investmentAccount: account, normalizeOwner, mode }) {
  return {
    name: "", code: "", buy_price: "", price: "", quantity: "", current_price: "",
    asset_type: "stock", market: "", trade_type: "buy", fee: "0", holding_id: "",
    settlement_rate: "",
    account_id: account?.id && (mode !== "new_trade" || account.type === "investment")
      ? String(account.id) : "",
    account_owner: normalizeOwner(account?.owner || account?.institution),
    currency: mode === "new_trade" ? account?.currency || "CNY" : "CNY",
    exchange_rate_to_base: String(mode === "new_trade" ? account?.exchange_rate_to_base || 1 : 1),
  };
}

export function editInvestmentDraft(item) {
  return {
    name: item.name || "", code: item.rawCode || item.code || "",
    buy_price: item.buy_price ?? "", quantity: item.quantity ?? "",
    current_price: item.current_price ?? "", asset_type: item.asset_type || "stock",
    market: item.market || "", currency: item.currency || "CNY",
    exchange_rate_to_base: item.exchange_rate_to_base ?? 1,
  };
}

export function changeInvestmentDraft(next, { name, value }) {
  if (["account_id", "account_owner", "currency"].includes(name)) next.settlement_rate = "";
  if (name === "currency" && value.trim().toUpperCase() === "CNY") next.exchange_rate_to_base = "1";
  return next;
}
