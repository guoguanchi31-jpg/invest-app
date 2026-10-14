import { deleteJson, postJson } from "../../api";


export function saveBudgetPlan(payload, requestOptions) {
  return postJson("/budgets", payload, requestOptions);
}


export function copyPreviousBudget({
  selectedMonth,
  sourceMonth,
  requestOptions,
}) {
  return postJson(
    "/budgets/copy",
    {
      source_month: sourceMonth,
      target_month: selectedMonth,
      overwrite: false,
    },
    requestOptions,
  );
}


export function deleteBudget(budgetId, requestOptions) {
  return deleteJson(`/budgets/${budgetId}`, requestOptions);
}
