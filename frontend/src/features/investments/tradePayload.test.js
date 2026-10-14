import { describe, expect, it } from "vitest";
import { buildInvestmentTradePayload } from "./tradePayload";


const form = {
  account_id: "7",
  asset_type: "stock",
  code: " AAPL ",
  currency: "USD",
  exchange_rate_to_base: "7.1",
  fee: "1.25",
  holding_id: "",
  market: "US",
  name: " Apple ",
  note: "定投",
  occurred_at: "2026-09-29",
  price: "20.125",
  quantity: "3.5",
  settlement_rate: "7.2",
  trade_type: "sell",
};


describe("investment trade request", () => {
  it("builds a first-buy payload without leaking view-only fields", () => {
    const payload = buildInvestmentTradePayload(
      "new_trade",
      form,
      { id: 7, currency: "CNY" },
    );
    expect(payload).toEqual({
      new_holding: {
        name: "Apple",
        code: "AAPL",
        account_id: 7,
        asset_type: "stock",
        market: "US",
        currency: "USD",
        exchange_rate_to_base: 7.1,
        buy_price: 20.125,
        current_price: 20.125,
        quantity: 3.5,
      },
      trade_type: "buy",
      quantity: 3.5,
      price: 20.125,
      fee: 1.25,
      settlement_rate: 7.2,
      occurred_at: "2026-09-29",
      note: "定投",
    });
  });

  it("uses one-to-one settlement for matching currencies", () => {
    const payload = buildInvestmentTradePayload(
      "trade",
      { ...form, holding_id: "9", trade_type: "sell" },
      { id: 7, currency: "USD" },
    );
    expect(payload.new_holding).toBeUndefined();
    expect(payload.holding_id).toBe(9);
    expect(payload.trade_type).toBe("sell");
    expect(payload.settlement_rate).toBe(1);
  });
});
