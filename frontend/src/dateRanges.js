const PRESET_KEYS = new Set([
  "selected_month",
  "previous_month",
  "trailing_3_months",
  "selected_year",
  "all",
  "custom",
]);

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateValue(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function shiftMonth(monthValue, offset) {
  const [year, month] = monthValue.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function monthBounds(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: dateValue(year, month, 1),
    dateTo: dateValue(year, month, lastDay),
  };
}

export function createDateRange(preset, anchorMonth) {
  const normalizedPreset = PRESET_KEYS.has(preset) ? preset : "selected_month";
  if (normalizedPreset === "all") {
    return { preset: "all", dateFrom: "", dateTo: "" };
  }
  if (normalizedPreset === "custom") {
    return { preset: "custom", dateFrom: "", dateTo: "" };
  }
  if (normalizedPreset === "previous_month") {
    return { preset: normalizedPreset, ...monthBounds(shiftMonth(anchorMonth, -1)) };
  }
  if (normalizedPreset === "trailing_3_months") {
    return {
      preset: normalizedPreset,
      dateFrom: monthBounds(shiftMonth(anchorMonth, -2)).dateFrom,
      dateTo: monthBounds(anchorMonth).dateTo,
    };
  }
  if (normalizedPreset === "selected_year") {
    const year = anchorMonth.slice(0, 4);
    return {
      preset: normalizedPreset,
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
    };
  }
  return { preset: "selected_month", ...monthBounds(anchorMonth) };
}

export function isValidDateRange(range) {
  if (range?.preset === "all") return true;
  return Boolean(
    /^\d{4}-\d{2}-\d{2}$/.test(range?.dateFrom || "")
    && /^\d{4}-\d{2}-\d{2}$/.test(range?.dateTo || "")
    && range.dateFrom <= range.dateTo,
  );
}

export function formatDateValue(value) {
  if (!value) return "未选择";
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function formatDateRange(range, anchorMonth) {
  const [year, month] = anchorMonth.split("-").map(Number);
  if (range?.preset === "selected_month") return `${year}年${month}月`;
  if (range?.preset === "previous_month") {
    const [previousYear, previousMonth] = shiftMonth(anchorMonth, -1).split("-").map(Number);
    return `${previousYear}年${previousMonth}月`;
  }
  if (range?.preset === "trailing_3_months") return "近3个月";
  if (range?.preset === "selected_year") return `${year}年全年`;
  if (range?.preset === "all") return "全部日期";
  if (range?.dateFrom && range?.dateTo) {
    return `${formatDateValue(range.dateFrom)} - ${formatDateValue(range.dateTo)}`;
  }
  if (range?.dateFrom) return `${formatDateValue(range.dateFrom)}起`;
  return "自定义日期";
}

export function calendarMonthForRange(range, anchorMonth) {
  return (range?.dateFrom || anchorMonth).slice(0, 7);
}

export function calendarCells(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - firstWeekday + 1));
    const cellYear = date.getUTCFullYear();
    const cellMonth = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      date: dateValue(cellYear, cellMonth, day),
      day,
      inCurrentMonth: cellYear === year && cellMonth === month,
    };
  });
}

export const DATE_RANGE_PRESETS = [
  { key: "selected_month", label: "所选月份", description: "跟随顶部月份" },
  { key: "previous_month", label: "上个月", description: "完整自然月" },
  { key: "trailing_3_months", label: "近3个月", description: "含所选月份" },
  { key: "selected_year", label: "所选年份", description: "1月至12月" },
  { key: "all", label: "全部日期", description: "不限制时间" },
];
