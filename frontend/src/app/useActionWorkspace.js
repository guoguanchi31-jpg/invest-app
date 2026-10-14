import { useCallback, useEffect, useRef, useState } from "react";
import useSubmission from "../features/shared/useSubmission";
import { RECENT_ACCOUNT_KEY } from "../features/ledger/drafts";
import { todayInputValue } from "../shared/businessDate";
import { actionDefinitions } from "./actionDefinitions";

export default function useActionWorkspace({
  accountsData, authSession, dataIdentityKey, defaultOwner, familyData,
  loadData, normalizeOwner, onDataChanged, refreshInvestmentQuotes,
  requestOptions, selectedMonth,
}) {
  const [actionMode, setActionMode] = useState("transaction");
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({});
  const [isAdding, setIsAdding] = useState(false);
  const { begin, submit, isSubmitting } = useSubmission(dataIdentityKey);
  const submitLock = useRef(false);
  const identityRef = useRef(dataIdentityKey);
  identityRef.current = dataIdentityKey;

  const getAccountById = useCallback((id) => (
    (accountsData?.accounts || []).find((account) => String(account.id) === String(id))
  ), [accountsData?.accounts]);

  const closeActionPanel = useCallback((force = false) => {
    if (submitLock.current && force !== true) return;
    setIsAdding(false);
    setEditTarget(null);
  }, []);

  const clearActionWorkspace = useCallback(() => {
    submitLock.current = false;
    begin();
    setIsAdding(false);
    setEditTarget(null);
    setForm({});
  }, [begin]);

  useEffect(() => { clearActionWorkspace(); }, [clearActionWorkspace, dataIdentityKey]);

  const createDraft = useCallback((mode, overrides = {}) => {
    const active = (accountsData?.accounts || []).filter((item) => item.can_edit !== false);
    const recent = localStorage.getItem(RECENT_ACCOUNT_KEY);
    const cashAccount = active.find((item) => String(item.id) === recent)
      || active.find((item) => !item.is_liability && ["debit_card", "wallet"].includes(item.type))
      || active.find((item) => !item.is_liability) || active[0];
    const currentMember = familyData.members.find((member) => member.is_current) || {
      id: familyData.current_member_id || authSession?.family?.member_id,
      display_name: authSession?.user?.display_name || defaultOwner,
    };
    const context = {
      mode, cashAccount, currentMember, defaultOwner, normalizeOwner,
      today: todayInputValue(),
      investmentAccount: active.find((item) => !item.is_liability && item.type === "investment") || cashAccount,
      transferTarget: active.find((item) => item.id !== cashAccount?.id),
    };
    return {
      occurred_at: context.today, note: "", month: selectedMonth,
      ...actionDefinitions[mode]?.draft?.(context),
      ...overrides,
    };
  }, [accountsData?.accounts, authSession, defaultOwner, familyData, normalizeOwner, selectedMonth]);

  const openAction = useCallback((mode, overrides = {}) => {
    if (submitLock.current) return;
    const definition = actionDefinitions[mode];
    if (!definition) throw new Error(`不支持的操作类型：${mode}`);
    const editableCount = (accountsData?.accounts || []).filter((item) => item.can_edit !== false).length;
    if (editableCount < (definition.minimumAccounts || 0)) {
      window.alert("至少需要两个账户，才能进行资金划转。");
      return;
    }
    begin();
    setActionMode(mode);
    setEditTarget(null);
    setForm(createDraft(mode, overrides));
    setIsAdding(true);
  }, [accountsData?.accounts, begin, createDraft]);

  const openEditAction = useCallback((type, item) => {
    if (!item?.id || submitLock.current) return;
    const account = getAccountById(item.account_id || (type === "account" ? item.id : null));
    if (item.can_edit === false || account?.can_edit === false) {
      window.alert("家庭成员只能修改自己名下的数据");
      return;
    }
    begin();
    setActionMode(type);
    setEditTarget({ type, id: item.id, item });
    setForm(createDraft(type, {
      account_id: item.account_id ? String(item.account_id) : "",
      account_owner: normalizeOwner(item.account_owner || account?.owner || account?.institution),
      occurred_at: item.occurred_at?.slice(0, 10) || todayInputValue(),
      note: item.note || "",
      ...actionDefinitions[type]?.edit?.(item, { normalizeOwner, today: todayInputValue() }),
    }));
    setIsAdding(true);
  }, [begin, createDraft, getAccountById, normalizeOwner]);

  const handleChange = useCallback((event) => {
    const { name, value } = event.target;
    setForm((current) => {
      const next = { ...current, [name]: value };
      const definition = actionDefinitions[actionMode];
      for (const [ownerField, accountField] of [
        ["account_owner", "account_id"],
        ["from_account_owner", "from_account_id"],
        ["to_account_owner", "to_account_id"],
      ]) {
        if (name === ownerField) {
          const account = getAccountById(current[accountField]);
          if (!account || normalizeOwner(account.owner || account.institution) !== normalizeOwner(value)) {
            const match = (accountsData?.accounts || []).find((item) => (
              item.can_edit !== false
              && normalizeOwner(item.owner || item.institution) === normalizeOwner(value)
              && (!definition.accountFilter || definition.accountFilter(item))
            ));
            next[accountField] = match?.id ? String(match.id) : "";
          }
        }
        if (name === accountField) {
          const account = getAccountById(value);
          if (account) next[ownerField] = normalizeOwner(account.owner || account.institution);
        }
      }
      return definition.change?.(next, {
        mode: actionMode, name, value, getAccountById, members: familyData.members,
      }) || next;
    });
  }, [accountsData?.accounts, actionMode, familyData.members, getAccountById, normalizeOwner]);

  const submitAction = useCallback(async ({
    keepOpen = false,
    formOverride = null,
  } = {}) => {
    if (submitLock.current) return;
    const identity = dataIdentityKey;
    const submittedForm = formOverride || form;
    submitLock.current = true;
    const definition = actionDefinitions[actionMode];
    try {
      return await submit({
        requestOptions,
        write: (options) => definition.submit({
          editTarget, form: submittedForm, getAccountById, mode: actionMode,
          normalizeOwner, requestOptions: options,
        }),
        onCommitted: (action) => {
          if (action?.rememberAccountId) localStorage.setItem(RECENT_ACCOUNT_KEY, action.rememberAccountId);
          onDataChanged();
          if (keepOpen && definition.canRepeat && !editTarget) {
            begin();
            setForm(createDraft(actionMode, {
              account_id: submittedForm.account_id,
              account_owner: submittedForm.account_owner,
              direction: submittedForm.direction,
              occurred_at: submittedForm.occurred_at,
            }));
          } else {
            setForm({});
            closeActionPanel(true);
          }
          if (action?.refreshQuotes) void refreshInvestmentQuotes({ silent: true });
        },
        refresh: loadData,
      });
    } finally {
      if (identity === identityRef.current) submitLock.current = false;
    }
  }, [actionMode, begin, closeActionPanel, createDraft, dataIdentityKey, editTarget, form,
    getAccountById, loadData, normalizeOwner, onDataChanged, refreshInvestmentQuotes, requestOptions, submit]);

  const submitPlan = useCallback((write) => submit({
    write, requestOptions,
    onCommitted: () => { closeActionPanel(true); onDataChanged(); },
    refresh: loadData,
  }), [closeActionPanel, loadData, onDataChanged, requestOptions, submit]);

  return {
    actionMode, clearActionWorkspace, closeActionPanel, editTarget, form,
    getAccountById, handleChange, isAdding, isSubmitting, openAction,
    openEditAction, setForm, submitAction, submitPlan,
  };
}
