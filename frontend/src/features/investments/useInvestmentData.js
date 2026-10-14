import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_INVESTMENT } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


export default function useInvestmentData({
  cashDraftBaselinesRef,
  cashDirtyAccountIdsRef,
  dataScope,
  enabled,
  identityKey,
  loggedIn,
  month,
  setCashDrafts,
  trendRange,
}) {
  const load = useCallback(
    () => fetchJson(
      `/investments/summary?month=${month}&trend_range=${trendRange}`,
      { scope: dataScope },
    ),
    [dataScope, month, trendRange],
  );
  const onData = useCallback((value) => {
    for (const account of value.cash_accounts || []) {
      if (!cashDirtyAccountIdsRef.current.has(account.id)) {
        cashDraftBaselinesRef.current.set(
          account.id,
          account.cash_available_original ?? account.cash_available ?? 0,
        );
      }
    }
    setCashDrafts((current) => Object.fromEntries(
      (value.cash_accounts || []).map((account) => [
        account.id,
        cashDirtyAccountIdsRef.current.has(account.id)
          ? (current[account.id] ?? "")
          : String(account.cash_available_original ?? account.cash_available ?? 0),
      ]),
    ));
  }, [cashDraftBaselinesRef, cashDirtyAccountIdsRef, setCashDrafts]);
  return useScopedDataResource({
    enabled,
    identityKey,
    initialValue: EMPTY_INVESTMENT,
    load,
    loggedIn,
    onData,
  });
}
