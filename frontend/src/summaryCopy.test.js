import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagePaths = [
  "./pages/DashboardPage.jsx",
  "./pages/LedgerPage.jsx",
  "./pages/AccountsPage.jsx",
  "./pages/InvestmentPage.jsx",
  "./pages/BudgetPage.jsx",
  "./pages/GoalsPage.jsx",
];

const pageCopy = pagePaths
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const metricCards = [...pageCopy.matchAll(
  /<article className="metric-card[^"]*">([\s\S]*?)<\/article>/g,
)].map((match) => match[1]);

describe("summary copy hierarchy", () => {
  it("omits redundant provenance, repeated scope and interaction instructions", () => {
    expect(pageCopy).not.toMatch(/来自已录入[收入支出]+流水/);
    expect(pageCopy).not.toMatch(/按所选范围实时分类汇总/);
    expect(pageCopy).not.toMatch(/根据账户余额自动计算/);
    expect(pageCopy).not.toMatch(/全部账户[收入支出]/);
    expect(pageCopy).not.toMatch(/点击上方月份可切换统计周期/);
    expect(pageCopy).not.toMatch(/点击(来源|分类)筛选/);
    expect(pageCopy).not.toMatch(/行情快照 · 单位万元/);
  });

  it("keeps every summary card to a label and primary value", () => {
    expect(metricCards.length).toBeGreaterThanOrEqual(20);
    metricCards.forEach((card) => {
      expect(card).not.toMatch(/<p\b/);
      expect(card).not.toMatch(/metric-card-footer/);
    });
  });

  it("moves useful context into labels or detailed panels", () => {
    expect(pageCopy).toMatch(/资产账户合计 ·/);
    expect(pageCopy).toMatch(/持仓收益率 ·/);
    expect(pageCopy).toMatch(/家庭月度总预算/);
    expect(pageCopy).toMatch(/已积累 ·/);
    expect(pageCopy).toMatch(/有效流水/);
    expect(pageCopy).toMatch(/全部记录/);
    expect(pageCopy).toContain("paceState.detail} · {availabilityText");
  });
});
