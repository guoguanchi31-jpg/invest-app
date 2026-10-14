import { describe, expect, it } from "vitest";
import {
  buildInvestmentCashAdjustment,
  INVESTMENT_CASH_ADJUSTMENT_REASON,
} from "./investmentCash";

describe("investment cash adjustment payload", () => {
  it("submits the edited value with its original optimistic-lock baseline", () => {
    expect(buildInvestmentCashAdjustment(7, "1100.50", 1000)).toEqual({
      account_id: 7,
      cash_available: 1100.5,
      expected_cash_available: 1000,
      reason: INVESTMENT_CASH_ADJUSTMENT_REASON,
    });
  });

  it("rejects invalid drafts and missing baselines before sending", () => {
    expect(() => buildInvestmentCashAdjustment(7, "-1", 1000)).toThrow(
      "现金可投金额不能为负数",
    );
    expect(() => buildInvestmentCashAdjustment(7, "100", undefined)).toThrow(
      "现金余额基准已失效",
    );
  });
});
