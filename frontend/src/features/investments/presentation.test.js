import { describe, expect, it } from "vitest";
import { buildInvestmentViews } from "./presentation";

const fallback = {
  allocation: [],
  cash_accounts: [],
  cash_available: 0,
  holdings: [],
  profit_rate: 0,
  total_profit: 0,
  total_value: 0,
  trend: [],
};

describe("investment display quality", () => {
  it("filters invalid allocation rows and sanitizes holding labels", () => {
    const view = buildInvestmentViews({
      assetTypeLabels: { fund: "基金", stock: "股票" },
      cashDrafts: {},
      colors: ["#176b4d"],
      fallback,
      formatPrice: (value) => String(value ?? 0),
      formatTrendLabel: (value) => value,
      holdingFilter: "全部",
      normalizeOwner: (value) => value || "默认用户",
      investmentData: {
        total_value: 100,
        total_profit: 0,
        profit_rate: 0,
        cash_available: 0,
        cash_accounts: [],
        trend: [],
        holdings: [{
          id: 1,
          name: "undefined",
          code: null,
          asset_type: "fund",
          account_name: "null",
          market_value: 100,
        }],
        allocation: [
          { name: "undefined", value: 50, percent: 50 },
          { name: "stock", value: Number.NaN, percent: 20 },
          { name: "fund", value: 100, percent: 100 },
        ],
      },
    });

    expect(view.investmentHoldingsView[0]).toMatchObject({
      name: "未命名持仓",
      code: "基金",
      account_name: "未关联账户 · 暂不计入汇总",
    });
    expect(view.investmentAllocationView).toEqual([{
      name: "基金",
      value: 100,
      percent: 100,
      color: "#176b4d",
    }]);
  });
});
