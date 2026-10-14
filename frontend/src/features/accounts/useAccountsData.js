import { useCallback } from "react";
import { fetchJson } from "../../api";
import { EMPTY_ACCOUNTS } from "../../app/dataDefaults";
import useScopedDataResource from "../shared/useScopedDataResource";


const EMPTY_ARCHIVED_ACCOUNTS = Object.freeze([]);


export default function useAccountsData({
  dataScope,
  identityKey,
  includeArchived,
  loggedIn,
}) {
  const loadAccounts = useCallback(
    () => fetchJson("/accounts/overview", { scope: dataScope }),
    [dataScope],
  );
  const loadArchived = useCallback(
    () => fetchJson("/accounts/archived", { scope: dataScope }),
    [dataScope],
  );
  const accounts = useScopedDataResource({
    resourceKey: "accounts",
    enabled: true,
    identityKey,
    initialValue: EMPTY_ACCOUNTS,
    load: loadAccounts,
    loggedIn,
  });
  const archived = useScopedDataResource({
    resourceKey: "archived-accounts",
    enabled: includeArchived,
    identityKey,
    initialValue: EMPTY_ARCHIVED_ACCOUNTS,
    load: loadArchived,
    loggedIn,
  });
  return { accounts, archived };
}
