import { originalBalance } from "../../settlement";

export function accountDraft({ cashAccount, currentMember, defaultOwner, today }) {
  const balance = String(originalBalance(cashAccount));
  return {
    name: "", type: "debit_card",
    owner: currentMember?.display_name || defaultOwner,
    member_id: currentMember?.id ? String(currentMember.id) : "",
    currency: "CNY", exchange_rate_to_base: "1",
    balance: "", opening_date: today, last4: "", credit_limit: "",
    statement_day: "", repayment_day: "", is_liability: "false",
    account_id: cashAccount?.id ? String(cashAccount.id) : "",
    actual_balance: balance, expected_balance: balance, reason: "",
  };
}

export function editAccountDraft(item, { normalizeOwner, today }) {
  return {
    name: item.name || "", type: item.type || "debit_card",
    owner: normalizeOwner(item.owner || item.institution),
    member_id: item.member_id ? String(item.member_id) : "",
    currency: item.currency || "CNY",
    exchange_rate_to_base: item.exchange_rate_to_base ?? 1,
    balance: item.balance ?? "", opening_date: item.opened_at || today,
    last4: item.last4 || "", credit_limit: item.credit_limit ?? "",
    statement_day: item.statement_day ?? "", repayment_day: item.repayment_day ?? "",
    is_liability: item.is_liability ? "true" : "false",
  };
}

export function changeAccountDraft(next, { mode, name, value, getAccountById, members }) {
  if (name === "member_id") {
    const member = members.find((item) => String(item.id) === String(value));
    if (member) next.owner = member.display_name;
  }
  if (name === "type") next.is_liability = value === "credit_card" ? "true" : "false";
  if (name === "currency" && value.trim().toUpperCase() === "CNY") next.exchange_rate_to_base = "1";
  if (name === "account_id" && mode === "adjustment") {
    next.actual_balance = String(originalBalance(getAccountById(value)));
    next.expected_balance = next.actual_balance;
  }
  return next;
}
