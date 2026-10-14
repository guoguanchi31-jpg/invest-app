import { todayInputValue } from "./shared/businessDate";

export function getBudgetProgress(used, budget) {
  const amount = Number(budget);
  if (!Number.isFinite(amount) || amount < 0) {
    return { percent: 0, label: "待修正", tone: "danger", valid: false };
  }
  if (amount === 0) {
    return used > 0
      ? { percent: 100, label: "已超支", tone: "danger", valid: true }
      : { percent: 0, label: "0%", tone: "success", valid: true };
  }
  const rawPercent = used / amount * 100;
  return {
    percent: Math.min(Math.max(rawPercent, 0), 100),
    label: rawPercent > 100 ? `超支 ${Math.round(rawPercent - 100)}%` : `${Math.round(rawPercent)}%`,
    tone: rawPercent > 100 ? "danger" : "success",
    valid: true,
  };
}

export function getBudgetPaceState(totalBudget, usedPercent, pacePercent, phase = "current", totalUsed = 0) {
  if (!totalBudget) {
    if (totalUsed > 0) {
      return { label: "未设预算", tone: "danger", detail: "已有支出但尚未设置预算" };
    }
    return { label: "待设置", tone: "neutral", detail: "暂无预算，设置后可跟踪执行节奏" };
  }
  if (usedPercent > 100) {
    return { label: "已超支", tone: "danger", detail: "已超出预算，请优先减少非必要支出" };
  }
  if (phase === "past") {
    return { label: "预算内", tone: "success", detail: "该月支出控制在预算范围内" };
  }
  if (phase === "future") {
    return { label: "待开始", tone: "neutral", detail: "预算已设置，将从月初开始跟踪" };
  }
  if (usedPercent > pacePercent) {
    return { label: "支出偏快", tone: "warning", detail: "支出快于时间进度，建议放慢节奏" };
  }
  return { label: "节奏健康", tone: "success", detail: "支出节奏健康，仍有预算空间" };
}

export function getBudgetTiming(monthValue, today = new Date()) {
  const [todayYear, todayMonth, todayDay] = todayInputValue(today).split("-").map(Number);
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue || "");
  const parsedMonth = match ? Number(match[2]) : 0;
  const hasValidMonth = Boolean(match) && parsedMonth >= 1 && parsedMonth <= 12;
  const year = hasValidMonth ? Number(match[1]) : todayYear;
  const month = hasValidMonth ? parsedMonth : todayMonth;
  const selectedIndex = year * 12 + month - 1;
  const currentIndex = todayYear * 12 + todayMonth - 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (selectedIndex < currentIndex) {
    return { daysLeft: 0, daysInMonth, pacePercent: 100, periodLabel: "该月已结束", phase: "past" };
  }
  if (selectedIndex > currentIndex) {
    return { daysLeft: daysInMonth, daysInMonth, pacePercent: 0, periodLabel: "该月尚未开始", phase: "future" };
  }

  const elapsedDays = Math.min(todayDay, daysInMonth);
  const daysLeft = Math.max(daysInMonth - elapsedDays, 0);
  return {
    daysLeft,
    daysInMonth,
    pacePercent: Math.round(elapsedDays / daysInMonth * 100),
    periodLabel: daysLeft ? `距月末还有 ${daysLeft} 天` : "本月最后一天",
    phase: "current",
  };
}
