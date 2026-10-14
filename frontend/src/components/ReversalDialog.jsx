import { useState } from "react";
import { reverseInvestmentTrade } from "../features/investments/actions";
import { reverseTransfer } from "../features/ledger/actions";
import useSubmission from "../features/shared/useSubmission";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";

export default function ReversalDialog({ target, onClose, onReversed, refresh }) {
  const [reason, setReason] = useState("");
  const { submit: execute, isSubmitting: busy } = useSubmission();
  const [error, setError] = useState("");
  const isTrade = target.type === "trade";
  const submit = async () => {
    setError("");
    return execute({
      write: (options) => (
        isTrade
          ? reverseInvestmentTrade(target.item.id, reason, options)
          : reverseTransfer(
            encodeURIComponent(target.item.reference_id),
            reason,
            options,
          )
      ),
      onCommitted: onReversed,
      refresh,
      onError: (err) => setError(err.message),
    });
  };
  return (
    <ModalBackdrop onClose={onClose} closeDisabled={busy}>
      <ModalPanel
        closeDisabled={busy}
        footer={(
          <DialogActions>
            <DialogAction disabled={busy} onClick={onClose}>取消</DialogAction>
            <DialogAction variant="primary" disabled={busy || !reason.trim()} onClick={submit}>
              {busy ? "撤销中…" : "确认撤销"}
            </DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title={`撤销${isTrade ? "投资交易" : "转账"}`}
        titleId="reversal-title"
      >
        <p className="workflow-note">{isTrade
          ? "撤销会恢复交易前的数量、成本和本笔现金变动。仅支持按录入顺序撤销该持仓的最后一笔有效交易。"
          : "撤销会回滚转出和转入账户的余额变动。"}原记录会保留并标为已撤销；需要更正时，撤销后重新录入。</p>
        <p>{target.item.occurred_at} · {target.item.holding_name || target.item.from_account_name} · {target.item.quantity || target.item.amount}</p>
        <div className="quick-add"><label className="form-field wide"><span>撤销原因</span><input autoFocus value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：数量录错，撤销后重新录入" /></label></div>
        {error && <p role="alert" className="negative">{error}</p>}
      </ModalPanel>
    </ModalBackdrop>
  );
}
