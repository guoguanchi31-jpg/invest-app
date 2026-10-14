export function buildBudgetView({
  budgetData,
  colors,
  fallback,
  getCategoryIcon,
  selectedMonth,
}) {
  return {
    budgetCategoriesView: (budgetData.items ?? fallback.items)
      .map((item, index) => ({
        id: item.id,
        member_id: item.member_id,
        member_name: item.member_name || "",
        can_edit: item.can_edit !== false,
        month: budgetData.month || selectedMonth,
        name: item.name,
        icon: getCategoryIcon(item.name, item.icon, "expense"),
        budget: item.budget || 0,
        family_budget: item.family_budget ?? item.budget ?? 0,
        used: item.used || 0,
        member_allocations: item.member_allocations || [],
        color: item.color || colors[index % colors.length],
      })),
    budgetUsedPercent: budgetData.used_percent ?? fallback.used_percent,
  };
}
