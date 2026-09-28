import { useState } from "react";
import { postJson } from "../api";

export default function ReversalDialog({ target, onClose, onReversed }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isTrade = target.type === "trade";
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await postJson(isTrade ? `/investments/trades/${target.item.id}/reverse`
        : `/accounts/transfers/${encodeURIComponent(target.item.reference_id)}/reverse`, { reason });
      await onReversed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reversal-title">
        <div className="modal-title">
          <h2 id="reversal-title">撤销{isTrade ? "投资交易" : "转账"}</h2>
          <button type="button" className="modal-close" disabled={busy} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="workflow-note">{isTrade
          ? "撤销会恢复交易前的数量、成本和本笔现金变动。仅支持按录入顺序撤销该持仓的最后一笔有效交易。"
          : "撤销会回滚转出和转入账户的余额变动。"}原记录会保留并标为已撤销；需要更正时，撤销后重新录入。</p>
        <p>{target.item.occurred_at} · {target.item.holding_name || target.item.from_account_name} · {target.item.quantity || target.item.amount}</p>
        <div className="quick-add"><label className="form-field wide"><span>撤销原因</span><input autoFocus value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：数量录错，撤销后重新录入" /></label></div>
        {error && <p role="alert" className="negative">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="filter-button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="filter-button primary" disabled={busy || !reason.trim()} onClick={submit}>{busy ? "撤销中…" : "确认撤销"}</button>
        </div>
      </section>
    </div>
  );
}
