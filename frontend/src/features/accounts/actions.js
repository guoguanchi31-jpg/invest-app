import { deleteJson, fetchJson, patchJson, postJson } from "../../api";
import { requireAction } from "../shared/actionErrors";


export async function submitAccountAction({
  editTarget,
  form,
  mode,
  normalizeOwner,
  requestOptions,
}) {
  if (mode === "account") {
    requireAction(
      form.name && form.member_id,
      "请填写账户名称并选择所属成员",
    );
    const payload = {
      name: form.name,
      type: form.type,
      owner: normalizeOwner(form.owner),
      member_id: form.member_id ? Number(form.member_id) : null,
      currency: form.currency,
      exchange_rate_to_base: Number(form.exchange_rate_to_base || 1),
      last4: form.last4,
      credit_limit: Number(form.credit_limit || 0),
      statement_day: form.statement_day ? Number(form.statement_day) : null,
      repayment_day: form.repayment_day ? Number(form.repayment_day) : null,
      is_liability: form.type === "credit_card" || form.is_liability === "true",
      balance: editTarget ? 0 : Number(form.balance || 0),
      opening_date: form.opening_date,
    };
    await (
      editTarget
        ? patchJson(`/accounts/${editTarget.id}`, payload, requestOptions)
        : postJson("/accounts", payload, requestOptions)
    );
    return {};
  }

  if (mode === "adjustment") {
    requireAction(
      form.account_id
        && form.actual_balance !== ""
        && form.reason.trim(),
      "请填写核对后余额和调整原因",
    );
    await postJson(
      `/accounts/${form.account_id}/adjustments`,
      {
        actual_balance: Number(form.actual_balance),
        expected_balance: form.expected_balance === ""
          ? null
          : Number(form.expected_balance),
        occurred_at: form.occurred_at,
        reason: form.reason.trim(),
      },
      requestOptions,
    );
    return {};
  }

  return null;
}


export function restoreAccount(accountId, requestOptions) {
  const path = `/accounts/${accountId}`;
  return postJson(`${path}/restore`, undefined, {
    ...requestOptions, conflictKey: path, conflictPaths: [path, `${path}/restore`],
  });
}


export function archiveAccount(accountId, requestOptions) {
  const path = `/accounts/${accountId}`;
  return deleteJson(path, {
    ...requestOptions, conflictKey: path, conflictPaths: [path, `${path}/restore`],
  });
}

export function loadAccountReconciliation(requestOptions) {
  return fetchJson("/accounts/reconciliation", requestOptions);
}

export function correctTransactionApplication(transactionId, payload, requestOptions) {
  return patchJson(`/transactions/${transactionId}/application`, payload, requestOptions);
}
