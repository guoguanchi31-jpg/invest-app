import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_DASHBOARD } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


export default function useDashboardData({
  dataScope,
  enabled,
  identityKey,
  loggedIn,
  month,
  trendRange,
}) {
  const load = useCallback(
    () => fetchJson(
      `/dashboard/summary?month=${month}&trend_range=${trendRange}`,
      { scope: dataScope },
    ),
    [dataScope, month, trendRange],
  );
  return useScopedDataResource({
    enabled,
    identityKey,
    initialValue: EMPTY_DASHBOARD,
    load,
    loggedIn,
  });
}
