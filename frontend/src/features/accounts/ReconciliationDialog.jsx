import { useCallback, useState } from "react";
import DialogActions, { DialogAction } from "../../components/DialogActions";
import FormField from "../../components/FormField";
import ModalBackdrop from "../../components/ModalBackdrop";
import ModalPanel from "../../components/ModalPanel";
import { formatCurrencyAmount } from "../../shared/money";
import useScopedDataResource from "../shared/useScopedDataResource";
import useSubmission from "../shared/useSubmission";
import { correctTransactionApplication, loadAccountReconciliation } from "./actions";

const EMPTY = Object.freeze({ items: [] });
const appliedLabel = (value) => value ? "已应用" : "未应用";

export default function ReconciliationDialog({
  accountId, identityKey, requestOptions, onClose, onCorrected, refresh,
}) {
  const load = useCallback(() => loadAccountReconciliation(requestOptions), [requestOptions]);
  const report = useScopedDataResource({
    enabled: true, loggedIn: true, identityKey, resourceKey: "reconciliation",
    initialValue: EMPTY, load,
  });
  const { begin, submit, status, isSubmitting } = useSubmission(identityKey);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const unknown = status === "unknown";
  const locked = isSubmitting || unknown;
  const choose = (account, issue) => {
    begin();
    setSelected({ account, issue });
    setReason("");
    setConfirmed(false);
    setError("");
    setNotice("");
  };
  const correct = () => {
    setError("");
    return submit({
      requestOptions,
      write: (options) => correctTransactionApplication(selected.issue.transaction_id, {
        expected_account_balance: selected.account.actual,
        expected_balance_applied: selected.issue.actual_balance_applied,
        reason: reason.trim(),
      }, options),
      onCommitted: () => {
        setSelected(null);
        setNotice("更正已提交，原流水与余额变更已记入审计。");
        onCorrected?.();
      },
      refresh: async () => {
        const results = await Promise.all([report.refresh(), refresh?.()]);
        return results.every((result) => result !== false);
      },
      onError: (err) => setError(err.message),
    });
  };
  const items = report.data.items.filter((item) => accountId == null || item.account_id === accountId);
  return (
    <ModalBackdrop onClose={onClose} closeDisabled={locked}>
      <ModalPanel title="账本诊断" className="detail-modal" onClose={onClose} closeDisabled={locked}>
        <p className="workflow-note">诊断只读取账本。请核对银行账单及原流水后，逐笔确认余额应用更正；期初证据不足或其他余额差异需要另外核实。</p>
        <button type="button" className="filter-button" disabled={locked || report.loading} onClick={() => {
          setSelected(null);
          begin();
          void report.refresh();
        }}>重新诊断</button>
        {report.loading && <p role="status">正在核对期初、流水应用与余额…</p>}
        {report.error && <p role="alert" className="negative">诊断失败：{report.error}</p>}
        {!report.loading && !report.error && items.map((account) => (
          <section key={account.account_id} className="detail-section reconciliation-account">
            <h3>{account.owner} · {account.account_name}</h3>
            <p className={account.healthy ? "positive" : "negative"}>{account.healthy ? "核对正常" : "需要核对"}</p>
            <dl className="reconciliation-facts">
              <dt>期初证据</dt><dd>{account.history.status === "complete" ? "完整" : "不足"}</dd>
              <dt>流水应用标记</dt><dd>{account.application.marker_consistent ? "符合业务日期" : "存在异常"}</dd>
              <dt>{account.state_field === "cash_available" ? "当前投资现金（原币）" : "当前余额（原币）"}</dt>
              <dd>{formatCurrencyAmount(account.actual, account.currency)}</dd>
              <dt>按已应用流水重建</dt><dd>{formatCurrencyAmount(account.expected, account.currency)}</dd>
              <dt>余额求和</dt><dd>{account.matches ? "一致" : `差异 ${formatCurrencyAmount(account.difference, account.currency)}`}</dd>
            </dl>
            {account.limitation && <p className="workflow-note">{account.limitation}</p>}
            {account.application.issues.map((issue) => (
              <div className="reconciliation-issue" key={issue.transaction_id}>
                <strong>流水 #{issue.transaction_id} · {issue.occurred_at}</strong>
                <p>{issue.direction === "income" ? "收入" : "支出"} {formatCurrencyAmount(issue.amount, account.currency)}
                  {" · "}实际{appliedLabel(issue.actual_balance_applied)}，应{appliedLabel(issue.expected_balance_applied)}</p>
                <p>{issue.voided_at ? "已撤销，仅保留历史异常，不更正余额。" : `更正将使${account.is_liability ? "待还余额" : account.state_field === "cash_available" ? "投资现金" : "账户余额"}变化 ${formatCurrencyAmount(issue.correction_delta, account.currency)}`}</p>
                {issue.requires_correction && account.can_correct && (
                  <button type="button" className="filter-button" disabled={locked} onClick={() => choose(account, issue)}>
                    核对并更正流水 #{issue.transaction_id}
                  </button>
                )}
                {issue.requires_correction && !account.can_correct && <small>当前账户仅可查看；请由有权限的成员处理，归档账户需先恢复。</small>}
              </div>
            ))}
          </section>
        ))}
        {!report.loading && !report.error && !items.length && <p>当前范围没有可诊断的账户。</p>}
        {selected && <section className="form-hint-card reconciliation-confirm" aria-label="确认余额应用更正">
          <strong>更正流水 #{selected.issue.transaction_id}</strong>
          <p>{selected.account.account_name}（{selected.account.currency}）：
            {formatCurrencyAmount(selected.account.actual, selected.account.currency)}
            {" → "}{formatCurrencyAmount(Number(selected.account.actual) + Number(selected.issue.correction_delta), selected.account.currency)}
          </p>
          <p>更正原流水的余额应用标记，保留原金额、日期和历史汇率。提交前会再次检查余额与标记是否变化。</p>
          <div className="quick-add">
            <FormField label="更正原因" wide>
              <input value={reason} maxLength={500} disabled={locked} onChange={(event) => setReason(event.target.value)} />
            </FormField>
          </div>
          <label className="workflow-confirm">
            <input type="checkbox" checked={confirmed} disabled={locked} onChange={(event) => setConfirmed(event.target.checked)} />
            我已核对原流水和账单，确认以上余额变化
          </label>
          {unknown && <p role="status">写入结果待确认，请保留原内容重试。</p>}
          <DialogActions>
            <DialogAction disabled={locked} onClick={() => { setSelected(null); begin(); }}>取消更正</DialogAction>
            <DialogAction variant="primary" disabled={isSubmitting || !confirmed || !reason.trim()} onClick={correct}>
              {isSubmitting ? "提交中…" : unknown ? "按原内容重试" : "确认更正"}
            </DialogAction>
          </DialogActions>
        </section>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert" className="negative">{error}</p>}
      </ModalPanel>
    </ModalBackdrop>
  );
}
