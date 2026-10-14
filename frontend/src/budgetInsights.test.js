import { describe, expect, it } from "vitest";
import { getBudgetPaceState, getBudgetProgress, getBudgetTiming } from "./budgetInsights";

describe("budget insights", () => {
  it("derives live row status from edited budget amounts", () => {
    expect(getBudgetProgress(500, 1000)).toMatchObject({ percent: 50, label: "50%", tone: "success", valid: true });
    expect(getBudgetProgress(500, 400)).toMatchObject({ percent: 100, label: "超支 25%", tone: "danger", valid: true });
    expect(getBudgetProgress(500, "")).toMatchObject({ percent: 100, label: "已超支", tone: "danger", valid: true });
    expect(getBudgetProgress(500, "invalid")).toMatchObject({ percent: 0, label: "待修正", tone: "danger", valid: false });
  });

  it("uses the selected month instead of the current month for time progress", () => {
    const today = new Date(2026, 8, 28);
    expect(getBudgetTiming("2026-09", today)).toEqual({
      daysLeft: 2, daysInMonth: 30, pacePercent: 93, periodLabel: "距月末还有 2 天", phase: "current",
    });
    expect(getBudgetTiming("2026-08", today)).toMatchObject({ daysLeft: 0, pacePercent: 100, periodLabel: "该月已结束", phase: "past" });
    expect(getBudgetTiming("2026-10", today)).toMatchObject({ daysLeft: 31, pacePercent: 0, periodLabel: "该月尚未开始", phase: "future" });
  });

  it("describes historical and future budgets without current-month pacing language", () => {
    expect(getBudgetPaceState(1000, 80, 100, "past")).toMatchObject({ label: "预算内", tone: "success" });
    expect(getBudgetPaceState(1000, 0, 0, "future")).toMatchObject({ label: "待开始", tone: "neutral" });
    expect(getBudgetPaceState(1000, 110, 100, "past")).toMatchObject({ label: "已超支", tone: "danger" });
    expect(getBudgetPaceState(0, 0, 93, "current", 500)).toMatchObject({ label: "未设预算", tone: "danger" });
  });
});
