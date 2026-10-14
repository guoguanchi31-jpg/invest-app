import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, isStaleRequestError } from "../../api";
import { restoreAccount } from "./actions";
import { useCommandActions } from "../shared/useSubmission";


export default function useAccountDetail({
  dataIdentityKey,
  dataScope,
  loadData,
  onDataChanged,
  requestOptions,
  resourceConfirmations,
}) {
  const [accountDetail, setAccountDetail] = useState(null);
  const runCommand = useCommandActions(dataIdentityKey, resourceConfirmations);
  const [restoringAccountId, setRestoringAccountId] = useState(null);
  const requestRef = useRef(0);
  const identityRef = useRef(dataIdentityKey);
  identityRef.current = dataIdentityKey;

  const closeAccountDetail = useCallback(() => {
    requestRef.current += 1;
    setAccountDetail(null);
  }, []);

  useEffect(() => {
    closeAccountDetail();
    setRestoringAccountId(null);
  }, [closeAccountDetail, dataIdentityKey]);

  const openAccountDetail = useCallback(async (account) => {
    const requestVersion = ++requestRef.current;
    const requestedIdentityKey = dataIdentityKey;
    try {
      const detail = await fetchJson(
        `/accounts/${account.id}`,
        { scope: dataScope },
      );
      if (
        requestVersion !== requestRef.current
        || requestedIdentityKey !== identityRef.current
      ) return;
      setAccountDetail(detail);
    } catch (error) {
      if (
        requestVersion === requestRef.current
        && !isStaleRequestError(error)
      ) {
        window.alert(`加载账户详情失败：${error.message}`);
      }
    }
  }, [dataIdentityKey, dataScope]);

  const handleRestoreAccount = useCallback(async (account) => {
    if (restoringAccountId !== null) return;
    setRestoringAccountId(account.id);
    try {
      await runCommand(`restore:${account.id}`, {
        resourceKey: "accounts",
        write: (options) => restoreAccount(account.id, options),
        requestOptions,
        onCommitted: (result) => {
          closeAccountDetail();
          onDataChanged();
          if (result) window.alert(result.message);
        },
        refresh: loadData,
      });
    } finally {
      if (identityRef.current === dataIdentityKey) {
        setRestoringAccountId(null);
      }
    }
  }, [
    closeAccountDetail,
    dataIdentityKey,
    loadData,
    onDataChanged,
    requestOptions,
    restoringAccountId,
    runCommand,
  ]);

  return {
    accountDetail,
    closeAccountDetail,
    handleRestoreAccount,
    openAccountDetail,
    restoringAccountId,
  };
}
