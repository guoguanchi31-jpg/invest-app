// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DateRangeFilter, { DateRangeDialog } from "./components/DateRangeFilter";
import { createDateRange } from "./dateRanges";

afterEach(cleanup);

it("replaces the native date select with clear presets and applies exact boundaries", () => {
  const onChange = vi.fn();
  render(
    <DateRangeFilter
      anchorMonth="2026-09"
      onChange={onChange}
      value={createDateRange("selected_month", "2026-09")}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "日期范围：2026年9月" }));
  expect(screen.getByRole("dialog", { name: "筛选流水日期" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /近3个月/ }));
  expect(screen.getByText("近3个月", { selector: ".date-range-current strong" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "应用日期" }));

  expect(onChange).toHaveBeenCalledWith({
    preset: "trailing_3_months",
    dateFrom: "2026-07-01",
    dateTo: "2026-09-30",
  });
});

it("supports a two-step custom range without native date inputs", () => {
  const onApply = vi.fn();
  render(
    <DateRangeDialog
      anchorMonth="2026-09"
      onApply={onApply}
      onClose={vi.fn()}
      value={createDateRange("selected_month", "2026-09")}
    />,
  );

  expect(document.querySelector('input[type="date"], input[type="month"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "2026年9月10日" }));
  expect(screen.getByText("请选择结束日期")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2026年9月20日" }));
  fireEvent.click(screen.getByRole("button", { name: "应用日期" }));

  expect(onApply).toHaveBeenCalledWith({
    preset: "custom",
    dateFrom: "2026-09-10",
    dateTo: "2026-09-20",
  });
});
