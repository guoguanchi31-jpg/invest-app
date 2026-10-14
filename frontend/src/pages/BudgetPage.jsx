import { useRef, useState } from "react";
import { CopyPlus } from "lucide-react";
import { getBudgetPaceState, getBudgetTiming } from "../budgetInsights";
import MetricValue from "../components/MetricValue";

export default function BudgetPage({ view }) {
  const {
    formatMoney,
    budgetData,
    budgetUsedPercent,
    canManagePlans,
    dataScope,
    selectedMonth,
    handleCopyPreviousBudget,
  } = view;
  const [isCopyingBudgets, setIsCopyingBudgets] = useState(false);
  const copyLockRef = useRef(false);
  const budgetTiming = getBudgetTiming(selectedMonth || budgetData.month);
  const paceState = getBudgetPaceState(
    budgetData.total_budget,
    budgetUsedPercent,
    budgetTiming.pacePercent,
    budgetTiming.phase,
    budgetData.total_used,
  );
  const usageLabel = budgetData.total_budget ? `${Math.round(budgetUsedPercent)}%` : "—";
  const availabilityText = budgetTiming.phase === "past"
    ? "该月预算已结束"
    : budgetTiming.phase === "future"
      ? `计划日均 ${formatMoney(budgetData.left / Math.max(budgetTiming.daysInMonth, 1))}`
      : `日均可用 ${formatMoney(budgetData.left / Math.max(budgetTiming.daysLeft, 1))}`;

  const handleCopyBudgets = async () => {
    if (copyLockRef.current) return;
    copyLockRef.current = true;
    setIsCopyingBudgets(true);
    try {
      await handleCopyPreviousBudget();
    } finally {
      copyLockRef.current = false;
      setIsCopyingBudgets(false);
    }
  };

  return (
    <>
      <section className="summary-grid summary-grid--three budget-summary">
        <article className="metric-card">
          <span>{dataScope === "family" ? "家庭月度总预算" : "我的预算额度"}</span>
          <MetricValue>{formatMoney(budgetData.total_budget)}</MetricValue>
        </article>
        <article className="metric-card">
          <span>{dataScope === "family" ? "家庭已支出" : "我的已支出"} · {usageLabel}</span>
          <MetricValue>{formatMoney(budgetData.total_used)}</MetricValue>
        </article>
        <article className="metric-card">
          <span>剩余可用</span>
          <MetricValue className={budgetData.left >= 0 ? "positive" : "negative"}>
            {formatMoney(budgetData.left)}
          </MetricValue>
        </article>
      </section>

      <section className="budget-page">
        <article className="panel budget-overview-panel">
          <div className="panel-title">
            <div>
              <h3>{dataScope === "family" ? "家庭总预算执行" : "个人额度执行"}</h3>
              <p>{budgetTiming.periodLabel} · {paceState.detail} · {availabilityText}</p>
            </div>
            <span className={`status-pill ${paceState.tone}`}>{paceState.label}</span>
          </div>
          <div className="budget-master-meta">
            <span>预算使用 <b className={budgetUsedPercent > 100 ? "negative" : ""}>{usageLabel}</b></span>
            <span>时间进度 <b>{budgetTiming.pacePercent}%</b></span>
          </div>
          <div className="budget-master-track">
            <span style={{ width: `${Math.min(Math.max(budgetUsedPercent, 0), 100)}%` }} />
            <i aria-hidden="true" style={{ left: `${budgetTiming.pacePercent}%` }} />
          </div>
        </article>

        {dataScope === "family" && (
          <article className="panel budget-member-panel">
            <div className="panel-title">
              <div>
                <h3>成员月度预算</h3>
                <p>按成员名下账户的实际支出计算使用情况</p>
              </div>
              {canManagePlans && (
                <div className="panel-actions">
                  <button
                    type="button"
                    className="filter-button"
                    title="沿用上月的家庭总预算和成员额度"
                    disabled={isCopyingBudgets}
                    onClick={handleCopyBudgets}
                  >
                    <CopyPlus size={15} /> {isCopyingBudgets ? "处理中…" : "沿用上月"}
                  </button>
                </div>
              )}
            </div>
            <div className="budget-member-list">
              {(budgetData.allocations || []).map((allocation) => (
                <div className="budget-member-row" key={allocation.member_id}>
                  <div className="budget-member-identity">
                    <div>
                      <strong>{allocation.member_name}</strong>
                      <span>{allocation.percent}%</span>
                    </div>
                    <small>
                      占家庭总预算 {allocation.percent}%
                    </small>
                  </div>
                  <b>{formatMoney(allocation.amount)}</b>
                  <span>已用 {formatMoney(allocation.used)}</span>
                  <span className={allocation.left >= 0 ? "positive" : "negative"}>
                    剩余 {formatMoney(allocation.left)}
                  </span>
                </div>
              ))}
              {!budgetData.allocations?.length && (
                <div className="empty-state">本月尚未设置成员预算。</div>
              )}
            </div>
          </article>
        )}
      </section>
    </>
  );
}
