import { deleteJson, downloadFile, patchJson, postJson } from "../../api";
import { accountCurrency } from "../../settlement";
import { requireAction } from "../shared/actionErrors";


export async function submitLedgerAction({
  editTarget,
  form,
  getAccountById,
  mode,
  requestOptions,
}) {
  if (mode === "transaction") {
    requireAction(form.account_id && form.amount, "请先选择账户并填写金额");
    const payload = {
      account_id: Number(form.account_id),
      category_name: form.category_name || null,
      amount: Number(form.amount),
      direction: form.direction,
      occurred_at: form.occurred_at,
      merchant: form.merchant,
      note: form.note,
    };
    await (
      editTarget
        ? patchJson(`/transactions/${editTarget.id}`, payload, requestOptions)
        : postJson("/transactions", payload, requestOptions)
    );
    return { rememberAccountId: String(form.account_id) };
  }

  if (mode === "transfer") {
    requireAction(
      form.from_account_id && form.to_account_id && form.amount,
      "请选择转出/转入账户并填写金额",
    );
    const source = getAccountById(form.from_account_id);
    const target = getAccountById(form.to_account_id);
    const sameCurrency = accountCurrency(source) === accountCurrency(target);
    requireAction(
      sameCurrency || Number(form.to_amount) > 0,
      "请填写转入账户实际到账金额",
    );
    await postJson(
      "/accounts/transfer",
      {
        from_account_id: Number(form.from_account_id),
        to_account_id: Number(form.to_account_id),
        amount: Number(form.amount),
        to_amount: Number(sameCurrency ? form.amount : form.to_amount),
        occurred_at: form.occurred_at,
        note: form.note,
      },
      requestOptions,
    );
    return {};
  }

  return null;
}


export function previewStatementImport(rows, requestOptions) {
  return postJson(
    "/transactions/import/preview",
    { rows, skip_duplicates: true },
    requestOptions,
  );
}


export function downloadLedger(requestOptions) {
  return downloadFile("/ledger/export", "invest-ledger.csv", requestOptions);
}


export function deleteTransaction(transactionId, requestOptions) {
  return deleteJson(`/transactions/${transactionId}`, requestOptions);
}


export function importStatement(rows, requestOptions) {
  return postJson("/transactions/import", {
    rows,
    skip_duplicates: true,
  }, requestOptions);
}


export function reverseTransfer(referenceId, reason, requestOptions) {
  return postJson(
    `/accounts/transfers/${referenceId}/reverse`,
    { reason },
    requestOptions,
  );
}
