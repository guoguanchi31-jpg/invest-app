export default function BudgetPage({ view }) {
  const {
    formatMoney,
    budgetData,
    budgetCategoriesView,
    budgetUsedPercent,
    daysLeft,
    budgetPaceText,
    budgetPacePercent,
    IconBadge,
    budgetDrafts,
    cancelBudgetDrafts,
    handleCopyPreviousBudget,
    handleSaveBudgetBatch,
    isSavingBudgets,
    openEditAction,
    setBudgetDraft,
  } = view;
  const hasDrafts = budgetCategoriesView.some((item) => Object.hasOwn(budgetDrafts, item.id));

  return (
    <>
                <section className="summary-grid budget-summary">
                  <article className="metric-card">
                    <span>月度总预算</span>
                    <strong>{formatMoney(budgetData.total_budget)}</strong>
                    <p>分配到 {budgetCategoriesView.length} 个分类</p>
                  </article>
                  <article className="metric-card">
                    <span>已支出</span>
                    <strong>{formatMoney(budgetData.total_used)}</strong>
                    <p><b className={budgetUsedPercent > 100 ? "negative" : "positive"}>{Math.round(budgetUsedPercent)}%</b> 已使用</p>
                  </article>
                  <article className="metric-card">
                    <span>剩余可用</span>
                    <strong className={budgetData.left >= 0 ? "positive" : "negative"}>{formatMoney(budgetData.left)}</strong>
                    <p>日均可用 {formatMoney((budgetData.left || 0) / Math.max(daysLeft, 1))}</p>
                  </article>
                </section>

                <section className="budget-page">
                  <article className="panel budget-overview-panel">
                    <div className="panel-title">
                      <div>
                        <h3>总预算执行</h3>
                        <p>距月末还有 {daysLeft} 天 · {budgetPaceText}</p>
                      </div>
                      <span className={`status-pill ${budgetUsedPercent > 100 ? "danger" : "success"}`}>{budgetUsedPercent > 100 ? "超支 · 需要调整" : "预算跟踪中"}</span>
                    </div>
                    <div className="budget-master-track">
                      <span style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
                      <i style={{ left: `${budgetPacePercent}%` }}>时间进度 {budgetPacePercent}%</i>
                    </div>
                  </article>

                  <article className="panel budget-detail-panel">
                    <div className="panel-title">
                      <div>
                        <h3>分类预算</h3>
                        <p>{hasDrafts ? "有未保存的调整，刷新不会覆盖" : budgetCategoriesView.length ? "按分类跟踪预算执行" : "暂无分类预算"}</p>
                      </div>
                      <div className="panel-actions">
                        {hasDrafts && <button type="button" className="filter-button" disabled={isSavingBudgets} onClick={cancelBudgetDrafts}>取消调整</button>}
                        <button type="button" className="filter-button" onClick={handleCopyPreviousBudget}>沿用上月</button>
                        {budgetCategoriesView.length > 0 && (
                          <button type="button" className="filter-button primary" disabled={isSavingBudgets || !hasDrafts} onClick={handleSaveBudgetBatch}>
                            {isSavingBudgets ? "保存中" : "保存批量调整"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="budget-table">
                      <div className="budget-head">
                        <span>分类</span>
                        <span>预算</span>
                        <span>已用</span>
                        <span>进度</span>
                        <span>状态</span>
                        <span>操作</span>
                      </div>
                      {budgetCategoriesView.map((item) => {
                        const usedPercent = item.budget ? Math.min(item.used / item.budget * 100, 104) : 0;
                        return (
                          <div className="budget-row" key={item.name}>
                            <div className="expense-name">
                              <IconBadge icon={item.icon} name={item.name} color={item.color} />
                              <strong>{item.name}</strong>
                            </div>
                            <label className="budget-inline-input">
                              <span>预算金额</span>
                              <input
                                inputMode="decimal"
                                aria-label={`${item.name}预算金额`}
                                value={budgetDrafts[item.id] ?? item.budget}
                                onChange={(event) => setBudgetDraft(item.id, event.target.value)}
                              />
                            </label>
                            <b className={item.used > item.budget ? "negative" : ""}>{formatMoney(item.used)}</b>
                            <div className="progress-track">
                              <span style={{ width: `${usedPercent}%`, background: item.color }} />
                            </div>
                            <span className={`status-pill ${item.statusTone}`}>{item.status}</span>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("budget", item)}>编辑</button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="budget-warning">{budgetPaceText}</div>
                  </article>
                </section>
              </>
  );
}
