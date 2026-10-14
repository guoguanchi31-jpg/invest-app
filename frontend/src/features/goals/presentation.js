import {
  displayText,
  normalizeDisplayText,
} from "../../shared/displayContent";

export function buildGoalViews({
  colors,
  fallback,
  formatGoalDue,
  formatMoney,
  formatTrendLabel,
  getGoalIcon,
  goalsData,
}) {
  const goalCardsView = (goalsData.goals ?? fallback.goals)
    .map((goal, index) => ({
      id: goal.id,
      name: displayText(goal.name, "未命名目标"),
      icon: getGoalIcon(goal.name, goal.icon),
      target_amount: goal.target_amount,
      current_amount: goal.current_amount,
      monthly_saving: goal.monthly_saving,
      due_date: goal.due_date,
      status: goal.status,
      member_id: goal.member_id,
      member_name: normalizeDisplayText(goal.member_name),
      can_edit: goal.can_edit !== false,
      can_contribute: Boolean(goal.can_contribute),
      allocations: goal.allocations || [],
      family_target_amount: goal.family_target_amount ?? goal.target_amount,
      family_current_amount: goal.family_current_amount ?? goal.current_amount,
      family_monthly_saving:
        goal.family_monthly_saving ?? goal.monthly_saving,
      target: goal.target_amount || 0,
      current: goal.current_amount || 0,
      saved: goal.current_amount || 0,
      monthly: goal.monthly_saving || 0,
      due: formatGoalDue(goal.due_date),
      note: goal.status === "paused" ? "已暂停" : normalizeDisplayText(goal.note),
      color: goal.color || colors[index % colors.length],
    }));
  return {
    goalAdvice: goalCardsView.length
      ? `当前每月储蓄 ${formatMoney(goalsData.monthly_saving ?? 0)}，总进度 ${goalsData.progress ?? 0}%。`
      : "暂无目标，创建目标后会自动生成进度建议。",
    goalCardsView,
    goalPlanView: (goalsData.plan ?? fallback.plan).map((item, index) => ({
      ...item,
      period: normalizeDisplayText(item.period)
        || formatTrendLabel(item.month || item.year, index),
    })),
  };
}
