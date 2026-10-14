import { useCallback } from "react";
import { archiveAccount } from "../features/accounts/actions";
import { deleteBudget } from "../features/budget/actions";
import { deleteGoal } from "../features/goals/actions";
import { deleteHolding } from "../features/investments/actions";
import { deleteTransaction } from "../features/ledger/actions";

const actions = {
  account: { label: "账户", write: archiveAccount },
  transaction: { label: "流水", write: deleteTransaction },
  holding: { label: "持仓", write: deleteHolding },
  budget: { label: "预算", write: deleteBudget },
  goal: { label: "目标", write: deleteGoal },
};

export default function useDeleteAction({
  runCommand, requestOptions, selectedMonth, closeActionPanel, onDataChanged, refresh,
}) {
  return useCallback(async (type, id) => {
    const action = actions[type];
    if (!id || !action) return;
    const message = type === "account"
      ? "确定归档这个账户吗？需要先清空余额和持仓，历史记录会保留。"
      : `确定删除这条${action.label}吗？`;
    if (!window.confirm(message)) return;
    return runCommand(`delete:${type}:${id}`, {
      resourceKey: type === "budget" ? `budget:${selectedMonth}`
        : type === "goal" ? `goals:${selectedMonth}` : "accounts",
      write: (options) => action.write(id, options),
      requestOptions,
      onCommitted: () => {
        closeActionPanel(true);
        onDataChanged();
      },
      refresh,
    });
  }, [closeActionPanel, onDataChanged, refresh, requestOptions, runCommand, selectedMonth]);
}
