import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_BUDGET } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


export default function useBudgetData({
  dataScope,
  enabled,
  identityKey,
  loggedIn,
  month,
}) {
  const load = useCallback(
    () => fetchJson(`/budgets/monthly?month=${month}`, { scope: dataScope }),
    [dataScope, month],
  );
  return useScopedDataResource({
    resourceKey: `budget:${month}`,
    enabled,
    identityKey,
    initialValue: EMPTY_BUDGET,
    load,
    loggedIn,
  });
}
