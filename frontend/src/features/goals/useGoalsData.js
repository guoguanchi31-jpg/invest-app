import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_GOALS } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


export default function useGoalsData({
  dataScope,
  enabled,
  identityKey,
  loggedIn,
  month,
  planRange,
}) {
  const load = useCallback(
    () => fetchJson(
      `/goals?month=${month}&plan_range=${planRange}`,
      { scope: dataScope },
    ),
    [dataScope, month, planRange],
  );
  return useScopedDataResource({
    resourceKey: `goals:${month}`,
    enabled,
    identityKey,
    initialValue: EMPTY_GOALS,
    load,
    loggedIn,
  });
}
