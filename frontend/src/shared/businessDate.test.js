import { afterEach, expect, it, vi } from "vitest";
import {
  configureBusinessTimezone,
  currentMonthValue,
  formatBusinessDateLabel,
  formatGoalDue,
  todayInputValue,
} from "./businessDate";
import { getBudgetTiming } from "../budgetInsights";
import { calendarCells, monthBounds, shiftMonth } from "../dateRanges";

afterEach(() => {
  configureBusinessTimezone();
  vi.unstubAllEnvs();
});

it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati"])(
  "uses the business date on devices in %s", (timezone) => {
    vi.stubEnv("TZ", timezone);
    const cases = [
      ["2026-09-30T15:59:59Z", "2026-09-30"],
      ["2026-09-30T16:00:00Z", "2026-10-01"],
      ["2026-09-30T23:59:59Z", "2026-10-01"],
      ["2026-10-01T00:00:00Z", "2026-10-01"],
      ["2026-12-31T16:00:00Z", "2027-01-01"],
      ["2028-02-28T16:00:00Z", "2028-02-29"],
      ["2028-02-29T16:00:00Z", "2028-03-01"],
    ];
    for (const [instant, day] of cases) {
      expect(todayInputValue(new Date(instant))).toBe(day);
      expect(currentMonthValue(new Date(instant))).toBe(day.slice(0, 7));
    }
  },
);

it("uses the session timezone for budget timing and defaults", () => {
  const instant = new Date("2026-09-30T16:00:00Z");
  expect(getBudgetTiming("2026-10", instant)).toMatchObject({ phase: "current", daysLeft: 30 });
  configureBusinessTimezone("America/Los_Angeles");
  expect(currentMonthValue(instant)).toBe("2026-09");
  expect(getBudgetTiming("2026-10", instant)).toMatchObject({ phase: "future", daysLeft: 31 });
  expect(() => configureBusinessTimezone("invalid/timezone")).toThrow();
  expect(currentMonthValue(instant)).toBe("2026-09");
});

it("keeps historical date facts and due months unchanged while rendering instants", () => {
  const instant = new Date("2026-09-30T16:00:00Z");
  expect(formatBusinessDateLabel("2026-10-01", instant)).toBe("今天");
  expect(formatBusinessDateLabel("2026-09-30", instant)).toBe("9月30日");
  expect(formatBusinessDateLabel("2026-09-30T16:00:00Z", instant)).toBe("今天 00:00");
  expect(formatGoalDue("2026-10-01")).toBe("2026年10月达成");
});

it("keeps calendar arithmetic stable across month ends and leap years", () => {
  expect(monthBounds("2028-02").dateTo).toBe("2028-02-29");
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(calendarCells("2028-02").filter((day) => day.inCurrentMonth)).toHaveLength(29);
});
