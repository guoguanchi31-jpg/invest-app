import { useState } from "react";
import { importStatement } from "../features/ledger/actions";
import useSubmission from "../features/shared/useSubmission";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";

export default function StatementImportDialog({ preview, onClose, onImported, refresh }) {
  const [selected, setSelected] = useState(() => preview.rows.map((row) => !row.duplicate));
  const { submit: execute, isSubmitting: busy } = useSubmission();
  const [error, setError] = useState("");
  const count = selected.filter(Boolean).length;
  const submit = async () => {
    setError("");
    return execute({
      write: (options) => importStatement(
        preview.rows.map((row, index) => ({
          ...row,
          decision: selected[index] ? "import" : "skip",
        })),
        options,
      ),
      onCommitted: onImported,
      refresh,
      onError: (err) => setError(err.message),
    });
  };
  return (
    <ModalBackdrop onClose={onClose} closeDisabled={busy}>
      <ModalPanel
        className="import-review-modal"
        closeDisabled={busy}
        eyebrow="导入前确认"
        footer={(
          <DialogActions>
            <DialogAction disabled={busy} onClick={onClose}>取消</DialogAction>
            <DialogAction variant="primary" disabled={busy || !count} onClick={submit}>
              {busy ? "导入中…" : `确认导入 ${count} 笔`}
            </DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title={`核对 ${preview.total} 笔流水`}
        titleId="import-title"
      >
        <p className="workflow-note">疑似重复项默认不选；确为两笔消费时，可逐笔勾选。相同交易号的记录不能重复导入。</p>
        {preview.skipped > 0 && <p className="workflow-note">已排除 {preview.skipped} 条转账、期初、调整或已撤销记录。完整迁移请使用 JSON 备份恢复。</p>}
        <div className="import-review-list">
          {preview.rows.map((row, index) => (
            <label className="import-review-row" key={index}>
              <input type="checkbox" checked={selected[index]} disabled={busy || row.duplicate_kind === "exact"}
                onChange={(event) => setSelected((current) => current.map((value, i) => i === index ? event.target.checked : value))} />
              <div>
                <strong>{row.merchant || row.category_name || "未命名流水"} · {row.direction === "income" ? "收入" : "支出"} {row.amount} {row.currency}</strong>
                <span>{row.occurred_at} · {row.account_owner} · {row.account_name}{row.note ? ` · ${row.note}` : ""}</span>
                {row.duplicate && <small className="negative">{row.duplicate_kind === "exact" ? "交易号重复，已跳过" : "疑似重复，请确认"}{row.matched_note ? ` · 已有备注：${row.matched_note}` : row.duplicate_in_file ? " · 同一文件中存在相似流水" : ""}</small>}
                {!row.balance_applied && <small>早于建账日期 {row.opened_at}，仅补历史，不影响余额</small>}
              </div>
            </label>
          ))}
        </div>
        {error && <p role="alert" className="negative">{error}</p>}
      </ModalPanel>
    </ModalBackdrop>
  );
}
