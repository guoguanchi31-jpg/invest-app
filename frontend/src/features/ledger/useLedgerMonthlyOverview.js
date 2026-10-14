import { useCallback, useMemo } from "react";
import { fetchJson } from "../../api";
import useScopedDataResource from "../shared/useScopedDataResource";

const EMPTY_DIRECTION = Object.freeze({
  total: 0,
  daily_average: 0,
  count: 0,
  highest_day: null,
  daily: [],
  categories: [],
});

const EMPTY_OVERVIEW = Object.freeze({
  month: "",
  previous_month: "",
  base_currency: "CNY",
  summary: {
    income: 0,
    expense: 0,
    balance: 0,
    previous_balance: 0,
  },
  directions: {
    expense: EMPTY_DIRECTION,
    income: EMPTY_DIRECTION,
  },
});

export default function useLedgerMonthlyOverview({
  accountId,
  dataRevision,
  dataScope,
  enabled,
  identityKey,
  month,
  owner,
}) {
  const path = useMemo(() => {
    const params = new URLSearchParams({ month });
    if (owner && owner !== "all") params.set("owner", owner);
    if (accountId && accountId !== "all") params.set("account_id", accountId);
    return `/ledger/monthly-overview?${params.toString()}`;
  }, [accountId, month, owner]);
  const load = useCallback(
    () => fetchJson(path, { scope: dataScope }),
    [dataScope, path],
  );
  return useScopedDataResource({
    enabled,
    identityKey,
    initialValue: EMPTY_OVERVIEW,
    load,
    loggedIn: true,
    resourceKey: `${path}:${dataRevision}`,
  });
}
