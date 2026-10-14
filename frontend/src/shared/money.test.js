import { describe, expect, it } from "vitest";
import {
  formatCurrencyAmount,
  formatExchangeRate,
  formatMoney,
  isForeignCurrency,
} from "./money";

describe("money formatting", () => {
  it("preserves cents and places the sign before the currency symbol", () => {
    expect(formatMoney(734.31)).toBe("¥734.31");
    expect(formatMoney(1000.49)).toBe("¥1,000.49");
    expect(formatMoney(-1000.49)).toBe("-¥1,000.49");
  });

  it("normalizes invalid values and formats original currency explicitly", () => {
    expect(formatMoney(Number.NaN)).toBe("¥0");
    expect(formatMoney(-0)).toBe("¥0");
    expect(formatCurrencyAmount(1000, "usd")).toBe("1,000.00 USD");
    expect(formatExchangeRate(7.1234564)).toBe("¥7.123456");
    expect(isForeignCurrency(" usd ")).toBe(true);
    expect(isForeignCurrency("CNY")).toBe(false);
  });
});
