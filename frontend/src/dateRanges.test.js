import { describe, expect, it } from "vitest";
import {
  calendarCells,
  createDateRange,
  formatDateRange,
  isValidDateRange,
  monthBounds,
  shiftMonth,
} from "./dateRanges";

describe("date range rules", () => {
  it("builds exact natural-month ranges across leap years and year boundaries", () => {
    expect(monthBounds("2024-02")).toEqual({
      dateFrom: "2024-02-01",
      dateTo: "2024-02-29",
    });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(createDateRange("previous_month", "2026-01")).toEqual({
      preset: "previous_month",
      dateFrom: "2025-12-01",
      dateTo: "2025-12-31",
    });
  });

  it("keeps preset labels and query boundaries derived from the same range", () => {
    expect(createDateRange("trailing_3_months", "2026-09")).toEqual({
      preset: "trailing_3_months",
      dateFrom: "2026-07-01",
      dateTo: "2026-09-30",
    });
    expect(createDateRange("selected_year", "2026-09")).toEqual({
      preset: "selected_year",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    expect(formatDateRange(
      { preset: "custom", dateFrom: "2026-08-16", dateTo: "2026-09-12" },
      "2026-09",
    )).toBe("2026年8月16日 - 2026年9月12日");
  });

  it("validates custom boundaries and creates a stable six-week calendar grid", () => {
    expect(isValidDateRange({ preset: "all", dateFrom: "", dateTo: "" })).toBe(true);
    expect(isValidDateRange({
      preset: "custom",
      dateFrom: "2026-09-20",
      dateTo: "2026-09-10",
    })).toBe(false);
    const cells = calendarCells("2026-09");
    expect(cells).toHaveLength(42);
    expect(cells.some((cell) => cell.date === "2026-09-01" && cell.inCurrentMonth)).toBe(true);
    expect(cells.some((cell) => !cell.inCurrentMonth)).toBe(true);
  });
});
