import { accountCurrency } from "../../settlement";


export function buildInvestmentTradePayload(actionMode, form, account) {
  if (
    (actionMode === "trade" && !form.holding_id)
    || !form.quantity
    || !form.price
  ) {
    throw new Error("请填写交易数量和成交价格");
  }
  if (
    actionMode === "new_trade"
    && (!form.name.trim() || !form.code.trim() || !form.account_id)
  ) {
    throw new Error("请填写名称、代码并选择投资账户");
  }

  return {
    ...(actionMode === "new_trade" ? {
      new_holding: {
        name: form.name.trim(),
        code: form.code.trim(),
        account_id: Number(form.account_id),
        asset_type: form.asset_type,
        market: form.market || null,
        currency: form.currency,
        exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
        buy_price: Number(form.price),
        current_price: Number(form.price),
        quantity: Number(form.quantity),
      },
    } : { holding_id: Number(form.holding_id) }),
    trade_type: actionMode === "new_trade" ? "buy" : form.trade_type,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: Number(form.fee || 0),
    settlement_rate: accountCurrency(form) === accountCurrency(account)
      ? 1
      : (form.settlement_rate ? Number(form.settlement_rate) : null),
    occurred_at: form.occurred_at,
    note: form.note,
  };
}
