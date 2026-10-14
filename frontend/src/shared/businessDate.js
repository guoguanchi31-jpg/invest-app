export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Shanghai";
let businessTimezone = DEFAULT_BUSINESS_TIMEZONE;

export function configureBusinessTimezone(timezone = DEFAULT_BUSINESS_TIMEZONE) {
  // Validate before changing the calendar used by new drafts.
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  businessTimezone = timezone;
}

export function todayInputValue(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: businessTimezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentMonthValue(now = new Date()) {
  return todayInputValue(now).slice(0, 7);
}

export function isValidBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function formatBusinessDateLabel(value, now = new Date()) {
  if (!value) return "";
  let day = value.slice(0, 10);
  let time = value.length > 10 ? value.slice(11, 16) : "";
  // Date-only facts and legacy local timestamps retain their recorded calendar.
  // Explicit instants are rendered in the same calendar as new business facts.
  if (/[TZ]/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value;
    day = todayInputValue(instant);
    time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: businessTimezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(instant);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  if (day === todayInputValue(now)) return time ? `今天 ${time}` : "今天";
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}

export function formatGoalDue(value) {
  if (!value) return "暂未设置期限";
  if (!/^\d{4}-\d{2}/.test(value)) return value;
  return `${Number(value.slice(0, 4))}年${Number(value.slice(5, 7))}月达成`;
}
