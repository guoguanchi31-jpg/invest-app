import { useState } from "react";
import { postJson } from "../api";

export default function StatementImportDialog({ preview, onClose, onImported }) {
  const [selected, setSelected] = useState(() => preview.rows.map((row) => !row.duplicate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = selected.filter(Boolean).length;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/transactions/import", {
        rows: preview.rows.map((row, index) => ({ ...row, decision: selected[index] ? "import" : "skip" })),
        skip_duplicates: true,
      });
      await onImported(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal-card import-review-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-title">
          <div><p className="eyebrow">导入前确认</p><h2 id="import-title">核对 {preview.total} 笔流水</h2></div>
          <button type="button" className="modal-close" disabled={busy} onClick={onClose} aria-label="关闭">×</button>
        </div>
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
        <div className="modal-actions">
          <button type="button" className="filter-button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="filter-button primary" disabled={busy || !count} onClick={submit}>{busy ? "导入中…" : `确认导入 ${count} 笔`}</button>
        </div>
      </section>
    </div>
  );
}
