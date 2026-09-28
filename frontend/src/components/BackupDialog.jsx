import { useState } from "react";
import { downloadFile, postJson } from "../api";

const tableLabels = {
  accounts: "账户", categories: "分类", transactions: "流水", holdings: "持仓",
  investment_trades: "投资交易", budgets: "预算", goals: "目标", goal_records: "目标存取",
  snapshots: "资产快照", prices: "行情记录",
};

export default function BackupDialog({ onClose, onRestored, onDownload }) {
  const [candidate, setCandidate] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const selectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCandidate(null);
    setConfirmed(false);
    setError("");
    setBusy(true);
    try {
      if (file.size > 18 * 1024 * 1024) throw new Error("备份文件不能超过 18 MB");
      const backup = JSON.parse(await file.text());
      const preview = await postJson("/warehouse/restore/preview", backup);
      setCandidate({ backup, preview, name: file.name });
    } catch (err) {
      setError(`校验失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/warehouse/restore", {
        backup: candidate.backup, expected_fingerprint: candidate.preview.expected_fingerprint, confirm_replace: confirmed,
      });
      setRecovery(result.recovery_backup);
      setCandidate(null);
      await onRestored();
    } catch (err) {
      setError(`恢复失败：${err.message}。如账本已变动，请重新选择文件核对。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal-card detail-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <div className="modal-title">
          <div><p className="eyebrow">账本数据</p><h2 id="backup-title">备份与恢复</h2></div>
          <button type="button" className="modal-close" disabled={busy} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="workflow-note">JSON 备份包含账户、收支、转账、持仓、买卖记录、预算和目标。恢复会整体替换当前账本，恢复前会自动保留当前数据副本。</p>
        <div className="panel-actions">
          <button type="button" className="filter-button" disabled={busy} onClick={onDownload}>下载当前备份</button>
          <label className="filter-button import-button">选择备份文件<input type="file" accept=".json,application/json" disabled={busy} onChange={selectFile} /></label>
        </div>
        {busy && <p role="status">正在处理，请稍候…</p>}
        {candidate && <>
          <h3>{candidate.name}</h3>
          <div className="backup-counts">
            <div><strong>数据</strong><strong>当前</strong><strong>恢复后</strong></div>
            {Object.entries(candidate.preview.counts).map(([table, count]) => (
              <div key={table}><span>{tableLabels[table] || table}</span><span>{candidate.preview.current_counts[table] || 0}</span><span>{count}</span></div>
            ))}
          </div>
          <label className="workflow-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />我已核对，确认用此备份覆盖当前账本</label>
          <div className="modal-actions"><button type="button" className="filter-button primary" disabled={!confirmed || busy} onClick={restore}>确认恢复</button></div>
        </>}
        {recovery && <div className="form-hint-card">
          <strong>备份已恢复</strong>
          <button type="button" className="filter-button" onClick={() => downloadFile(`/warehouse/recovery/${recovery}`, recovery).catch((err) => setError(err.message))}>下载恢复前的数据副本</button>
        </div>}
        {error && <p role="alert" className="negative">{error}</p>}
      </section>
    </div>
  );
}
