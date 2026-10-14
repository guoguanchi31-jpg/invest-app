import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRequestGeneration, isStaleRequestError, patchJson, postJson } from "../../api";
import { createSubmission, executeSubmission } from "../shared/useSubmission";
import { EMPTY_INVESTMENT } from "../../app/dataDefaults";
import { buildInvestmentCashAdjustment } from "../../app/investmentCash";


export function useInvestmentDrafts() {
  const [cashDrafts, setCashDrafts] = useState({});
  const [isCashEditorOpen, setIsCashEditorOpen] = useState(false);
  const [holdingFilter, setHoldingFilter] = useState("全部");
  const cashDraftBaselinesRef = useRef(new Map());
  const cashDirtyAccountIdsRef = useRef(new Set());
  const cashSubmissions = useRef(new Map());

  const clearInvestmentDrafts = useCallback(() => {
    setCashDrafts({});
    setIsCashEditorOpen(false);
    cashDraftBaselinesRef.current.clear();
    cashDirtyAccountIdsRef.current.clear();
    cashSubmissions.current.clear();
  }, []);

  const updateInvestmentCashDraft = useCallback((account, value) => {
    const intent = cashSubmissions.current.get(account.id);
    if (!intent || ["committed", "invalidated"].includes(intent.status)) {
      cashSubmissions.current.set(account.id, createSubmission());
    }
    if (!cashDraftBaselinesRef.current.has(account.id)) {
      cashDraftBaselinesRef.current.set(
        account.id,
        account.cash_available_original ?? account.cash_available ?? 0,
      );
    }
    cashDirtyAccountIdsRef.current.add(account.id);
    setCashDrafts((current) => ({ ...current, [account.id]: value }));
  }, []);

  return {
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    cashDrafts,
    cashSubmissions,
    clearInvestmentDrafts,
    holdingFilter,
    isCashEditorOpen,
    setCashDrafts,
    setHoldingFilter,
    setIsCashEditorOpen,
    updateInvestmentCashDraft,
  };
}


export function useInvestmentMutations({
  cashDraftBaselinesRef,
  cashDirtyAccountIdsRef,
  cashDrafts,
  cashSubmissions,
  dataIdentityKey,
  dataScope,
  loadData,
  setInvestmentData,
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingCashAccountId, setSavingCashAccountId] = useState(null);
  const [quoteRefreshResult, setQuoteRefreshResult] = useState(null);
  const latestIdentityKeyRef = useRef(dataIdentityKey);
  const cashSaveLock = useRef(false);
  latestIdentityKeyRef.current = dataIdentityKey;
  const requestOptions = useMemo(() => ({ scope: dataScope }), [dataScope]);

  useEffect(() => {
    setIsRefreshing(false);
    setSavingCashAccountId(null);
    setQuoteRefreshResult(null);
    cashSubmissions.current.clear();
    cashSaveLock.current = false;
  }, [cashSubmissions, dataIdentityKey]);

  const saveInvestmentCash = useCallback(async (accountId) => {
    if (cashSaveLock.current) return false;
    const requestedIdentityKey = dataIdentityKey;
    const generation = getRequestGeneration();
    let payload;
    try {
      payload = buildInvestmentCashAdjustment(
        accountId,
        cashDrafts[accountId] ?? "0",
        cashDraftBaselinesRef.current.get(accountId),
      );
    } catch (error) {
      window.alert(error.message);
      return false;
    }

    let intent = cashSubmissions.current.get(accountId);
    if (!intent) {
      intent = createSubmission();
      cashSubmissions.current.set(accountId, intent);
    }
    cashSaveLock.current = true;
    try {
      setSavingCashAccountId(accountId);
      const outcome = await executeSubmission(intent, {
        write: (options) => patchJson("/investments/cash-available", payload, options),
        requestOptions,
        isCurrent: () => requestedIdentityKey === latestIdentityKeyRef.current
          && getRequestGeneration() === generation,
        onCommitted: () => {
          cashDirtyAccountIdsRef.current.delete(accountId);
          cashDraftBaselinesRef.current.set(accountId, payload.cash_available);
        },
        refresh: loadData,
      });
      return outcome.committed;
    } finally {
      if (requestedIdentityKey === latestIdentityKeyRef.current) {
        setSavingCashAccountId(null);
        cashSaveLock.current = false;
      }
    }
  }, [
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    cashDrafts,
    cashSubmissions,
    dataIdentityKey,
    loadData,
    requestOptions,
  ]);

  const refreshInvestmentQuotes = useCallback(async ({ silent = false } = {}) => {
    const requestedIdentityKey = dataIdentityKey;
    setIsRefreshing(true);
    try {
      const data = await postJson(
        "/investments/refresh",
        undefined,
        requestOptions,
      );
      if (requestedIdentityKey !== latestIdentityKeyRef.current) return false;
      setQuoteRefreshResult(data);
      if (data.summary) {
        setInvestmentData({ ...EMPTY_INVESTMENT, ...data.summary });
      }
      return await loadData();
    } catch (error) {
      if (!silent && !isStaleRequestError(error)) {
        window.alert(`刷新行情失败：${error.message}`);
      }
      return false;
    } finally {
      if (requestedIdentityKey === latestIdentityKeyRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [
    dataIdentityKey,
    loadData,
    requestOptions,
    setInvestmentData,
  ]);

  return {
    isRefreshing,
    quoteRefreshResult,
    refreshInvestmentQuotes,
    saveInvestmentCash,
    savingCashAccountId,
  };
}
