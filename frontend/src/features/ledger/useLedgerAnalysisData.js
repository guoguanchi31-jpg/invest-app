import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_EXPENSE, EMPTY_INCOME } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


export default function useLedgerAnalysisData({
  dataScope,
  enabled,
  identityKey,
  loggedIn,
  month,
}) {
  const loadIncome = useCallback(
    () => fetchJson(
      `/income/analysis?month=${month}&income_range=month&trend_range=month`,
      { scope: dataScope },
    ),
    [dataScope, month],
  );
  const loadExpense = useCallback(
    () => fetchJson(
      `/expenses/analysis?month=${month}&expense_range=month&cashflow_range=month`,
      { scope: dataScope },
    ),
    [dataScope, month],
  );
  return {
    income: useScopedDataResource({
      enabled,
      identityKey,
      initialValue: EMPTY_INCOME,
      load: loadIncome,
      loggedIn,
    }),
    expense: useScopedDataResource({
      enabled,
      identityKey,
      initialValue: EMPTY_EXPENSE,
      load: loadExpense,
      loggedIn,
    }),
  };
}
