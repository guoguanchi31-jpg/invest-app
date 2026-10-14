import { repaymentDraft } from "../../settlement";

export const RECENT_ACCOUNT_KEY = "investRecentAccountId";

export function ledgerDraft({ cashAccount, transferTarget, normalizeOwner }) {
  return {
    account_id: cashAccount?.id ? String(cashAccount.id) : "",
    account_owner: normalizeOwner(cashAccount?.owner || cashAccount?.institution),
    amount: "", direction: "expense", category_name: "", merchant: "",
    from_account_id: cashAccount?.id ? String(cashAccount.id) : "",
    from_account_owner: normalizeOwner(cashAccount?.owner || cashAccount?.institution),
    to_account_id: transferTarget?.id ? String(transferTarget.id) : "",
    to_account_owner: normalizeOwner(transferTarget?.owner || transferTarget?.institution),
    to_amount: "", repayment_account_id: "",
  };
}

export function editLedgerDraft(item) {
  return {
    category_name: item.category_name || item.name || "",
    amount: item.rawAmount ?? item.amount ?? "",
    direction: item.direction || "expense",
    merchant: item.merchant || "",
  };
}

export function changeLedgerDraft(next, { mode, name, getAccountById }) {
  if (name === "direction") next.category_name = "";
  if (mode === "transfer" && [
    "from_account_id", "from_account_owner", "to_account_id", "to_account_owner",
  ].includes(name)) {
    const source = getAccountById(next.from_account_id);
    const target = getAccountById(next.to_account_id);
    Object.assign(next, next.repayment_account_id
      && String(target?.id) === next.repayment_account_id
      ? repaymentDraft(source, target)
      : { amount: "", to_amount: "", repayment_account_id: "" });
  }
  return next;
}
