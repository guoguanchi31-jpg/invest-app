import { deleteJson, patchJson, postJson } from "../../api";
import { requireAction } from "../shared/actionErrors";
import { buildInvestmentTradePayload } from "./tradePayload";


export async function submitInvestmentAction({
  editTarget,
  form,
  getAccountById,
  mode,
  requestOptions,
}) {
  if (mode === "holding") {
    requireAction(form.name && form.code, "请至少填写名称和代码");
    const payload = {
      name: form.name,
      code: form.code,
      buy_price: Number(form.buy_price),
      quantity: Number(form.quantity),
      current_price: ["stock", "fund"].includes(form.asset_type)
        ? Number(form.current_price || form.buy_price || 0)
        : Number(form.current_price || 0),
      account_id: form.account_id ? Number(form.account_id) : null,
      asset_type: form.asset_type,
      market: form.market || null,
      currency: form.currency,
      exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
    };
    await (
      editTarget
        ? patchJson(`/holdings/${editTarget.id}`, payload, requestOptions)
        : postJson("/holdings", payload, requestOptions)
    );
    return {
      refreshQuotes: ["stock", "fund"].includes(form.asset_type),
    };
  }

  if (mode === "trade" || mode === "new_trade") {
    await postJson(
      "/investments/trades",
      buildInvestmentTradePayload(
        mode,
        form,
        getAccountById(form.account_id),
      ),
      requestOptions,
    );
    return {};
  }

  return null;
}


export function deleteHolding(holdingId, requestOptions) {
  return deleteJson(`/holdings/${holdingId}`, requestOptions);
}


export function reverseInvestmentTrade(tradeId, reason, requestOptions) {
  return postJson(
    `/investments/trades/${tradeId}/reverse`,
    { reason },
    requestOptions,
  );
}
