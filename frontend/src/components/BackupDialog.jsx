import { useState } from "react";
import {
  downloadRecoveryBackup,
  previewBackupRestore,
  restoreFamilyBackup,
} from "../features/backup/actions";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";
import useSubmission from "../features/shared/useSubmission";

const tableLabels = {
  accounts: "账户", categories: "分类", transactions: "流水", holdings: "持仓",
  investment_trades: "投资交易", budgets: "预算", goals: "目标", goal_records: "目标存取",
  snapshots: "资产快照", prices: "行情记录", audit_events: "操作审计",
  audit_event_accounts: "审计账户关联",
};
const memberMappingLabels = {
  stable_key: "稳定身份匹配",
  legacy_name: "旧备份按姓名匹配",
  name_match_review: "同名成员，请确认",
  create_pending: "恢复时新建待登录成员",
};

export default function BackupDialog({ canRestore = true, onClose, onRestored, onDownload, refresh }) {
  const [candidate, setCandidate] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const { begin, submit, isSubmitting } = useSubmission();
  const busy = previewing || isSubmitting;
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const selectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCandidate(null);
    setConfirmed(false);
    setError("");
    setPreviewing(true);
    begin();
    try {
      if (file.size > 18 * 1024 * 1024) throw new Error("备份文件不能超过 18 MB");
      const backup = JSON.parse(await file.text());
      const preview = await previewBackupRestore(backup);
      setCandidate({ backup, preview, name: file.name });
    } catch (err) {
      setError(`校验失败：${err.message}`);
    } finally {
      setPreviewing(false);
    }
  };
  const restore = async () => {
    setError("");
    return submit({
      write: (options) => restoreFamilyBackup({
        backup: candidate.backup,
        confirmReplace: confirmed,
        expectedFingerprint: candidate.preview.expected_fingerprint,
      }, options),
      onCommitted: (result) => {
        setRecovery(result?.recovery_backup || "");
        setCandidate(null);
        onRestored();
      },
      refresh,
      onError: (err) => setError(err.message),
    });
  };
  return (
    <ModalBackdrop onClose={onClose} closeDisabled={busy}>
      <ModalPanel
        className="detail-modal"
        closeDisabled={busy}
        eyebrow="账本数据"
        onClose={onClose}
        title="备份与恢复"
        titleId="backup-title"
      >
        <p className="workflow-note">JSON 备份包含当前家庭的账户、收支、转账、持仓、买卖记录、预算和目标。{canRestore ? "恢复会整体替换当前家庭账本，恢复前会自动保留当前数据副本。" : "只有家庭管理员可以执行恢复。"}</p>
        <div className="panel-actions">
          <button type="button" className="filter-button" disabled={busy} onClick={onDownload}>下载当前备份</button>
          {canRestore && <label className="filter-button import-button">选择备份文件<input type="file" accept=".json,application/json" disabled={busy} onChange={selectFile} /></label>}
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
          {candidate.preview.member_mapping?.length > 0 && (
            <div className="backup-member-mapping">
              <strong>成员归属映射</strong>
              {candidate.preview.member_mapping.map((item) => (
                <div key={`${item.source_member_id}-${item.source_name}`}>
                  <span>{item.source_name}</span>
                  <span>→</span>
                  <span>{item.target_name}</span>
                  <small>{memberMappingLabels[item.action] || item.action}</small>
                </div>
              ))}
            </div>
          )}
          {candidate.preview.snapshot_compatibility?.collisions?.length > 0 && (
            <section className="form-hint-card" aria-label="旧快照兼容处理">
              <strong>旧快照日期合并说明</strong>
              <p>以下记录在日期规范化后重合，只保留一条，不相加资产金额。原始备份文件保持不变。</p>
              {candidate.preview.snapshot_compatibility.collisions.map((item) => (
                <div key={`${item.family_id}:${item.member_id}:${item.snapshot_date}`}>
                  <strong>{item.snapshot_date} · {item.member_id == null ? "家庭汇总" : `成员 #${item.member_id}`}</strong>
                  <p>保留 #{item.kept.id}（原日期 {item.kept.original_date}，创建时间 {item.kept.created_at || "未记录"}）</p>
                  {item.discarded.map((row) => (
                    <p key={row.id}>舍弃 #{row.id}（原日期 {row.original_date}，创建时间 {row.created_at || "未记录"}）</p>
                  ))}
                  <p>{item.reason}</p>
                </div>
              ))}
            </section>
          )}
          <label className="workflow-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />我已核对数据量、成员归属与快照兼容说明，确认用此备份覆盖当前账本</label>
          <DialogActions>
            <DialogAction variant="primary" disabled={!confirmed || busy} onClick={restore}>
              确认恢复
            </DialogAction>
          </DialogActions>
        </>}
        {recovery && <div className="form-hint-card">
          <strong>备份已恢复</strong>
          <button type="button" className="filter-button" onClick={() => downloadRecoveryBackup(recovery).catch((err) => setError(err.message))}>下载恢复前的数据副本</button>
        </div>}
        {error && <p role="alert" className="negative">{error}</p>}
      </ModalPanel>
    </ModalBackdrop>
  );
}
