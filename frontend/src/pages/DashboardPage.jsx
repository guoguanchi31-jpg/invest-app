import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, ChevronRight } from "lucide-react";
import MetricValue from "../components/MetricValue";

export default function DashboardPage({ view }) {
  const {
    formatMoney,
    dataScope,
    netWorth,
    monthlyIncome,
    monthlyExpense,
    budgetLeft,
    dashboardTrendLabel,
    dashboardTrendHint,
    ChartRangeSwitch,
    chartRangeOptions,
    dashboardTrendRange,
    setDashboardTrendRange,
    trendData,
    ChartTooltip,
    setActivePage,
    setPlanSection,
    dashboardTransactions,
    IconBadge,
    openEditAction,
    budgetTotal,
    budgetPercent,
    goalCardsView,
  } = view;
  const budgetUsagePercent = Math.min(Math.max(budgetPercent, 0), 100);
  const budgetRemaining = budgetTotal - monthlyExpense;

  return (
    <>
                <section className="summary-grid">
                  <article className="metric-card">
                    <span>净资产</span>
                    <MetricValue>{formatMoney(netWorth)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>本月收入</span>
                    <MetricValue>{formatMoney(monthlyIncome)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>本月支出</span>
                    <MetricValue>{formatMoney(monthlyExpense)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>本月结余</span>
                    <MetricValue>{formatMoney(budgetLeft)}</MetricValue>
                  </article>
                </section>

                <section className="dashboard-grid">
                  <div className="dashboard-stack dashboard-stack-primary">
                  <article className="panel chart-panel">
                    <div className="panel-title chart-panel-title">
                      <div>
                        <h3>净资产趋势</h3>
                        <p>{dashboardTrendLabel} · {dashboardTrendHint} · 单位万元</p>
                      </div>
                      <div className="chart-title-actions">
                        <ChartRangeSwitch options={chartRangeOptions.trend} value={dashboardTrendRange} onChange={setDashboardTrendRange} />
                      </div>
                    </div>
                    {trendData.length > 1 ? (
                      <ResponsiveContainer width="100%" height={230}>
                        <AreaChart data={trendData}>
                          <defs>
                            <linearGradient id="netWorth" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="5%" stopColor="#176b4d" stopOpacity={0.24} />
                              <stop offset="95%" stopColor="#176b4d" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#dce3e0" strokeDasharray="4 4" vertical={false} />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} />
                          <Tooltip
                            content={
                              <ChartTooltip
                                title="净资产趋势"
                                names={{ value: "净资产" }}
                                valueFormatter={(value) => `${value} 万`}
                              />
                            }
                            cursor={{ stroke: "#9eaaa4", strokeDasharray: "4 4" }}
                          />
                          <Area dataKey="value" stroke="#176b4d" strokeWidth={3} fill="url(#netWorth)" type="monotone" activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state">暂无可对比的净资产趋势，积累多天或多月快照后展示。</div>
                    )}
                  </article>

                  <article className="panel goal-panel">
                    <div className="panel-title">
                      <div>
                        <h3>目标进度</h3>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setPlanSection("goals");
                          setActivePage("plan");
                        }}
                      >
                        全部 <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="progress-list">
                      {goalCardsView.slice(0, 2).map((item) => {
                        const percent = item.target ? Math.min(item.current / item.target * 100, 100) : 0;
                        return (
                          <div className="progress-item" key={item.name}>
                            <div>
                              <strong>
                                {dataScope === "family" && item.member_name ? `${item.member_name} · ` : ""}
                                {item.name}
                              </strong>
                              <span>{Math.round(percent)}%</span>
                            </div>
                            {item.can_edit !== false && (
                              <button type="button" className="edit-button subtle" onClick={() => openEditAction("goal", item)}>编辑</button>
                            )}
                            <div className="progress-track">
                              <span style={{ width: `${percent}%`, background: item.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                  </div>

                  <div className="dashboard-stack dashboard-stack-secondary">
                  <article className="panel transaction-panel">
                    <div className="panel-title">
                      <div>
                        <h3>最近交易</h3>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => setActivePage("ledger")}>
                        查看全部 <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="transaction-list">
                      {dashboardTransactions.map((item) => {
                        const canEdit = item.can_edit !== false;
                        const editTransaction = () => openEditAction("transaction", item);
                        return (
                          <div
                            className={`transaction${canEdit ? " is-clickable" : ""}`}
                            key={item.id || `${item.name}-${item.date}`}
                            role={canEdit ? "button" : undefined}
                            tabIndex={canEdit ? 0 : undefined}
                            aria-label={canEdit ? `编辑${item.name}` : undefined}
                            onClick={canEdit ? editTransaction : undefined}
                            onKeyDown={canEdit ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                editTransaction();
                              }
                            } : undefined}
                          >
                            <div className="transaction-main">
                              <IconBadge className="transaction-icon" icon={item.icon} name={item.category_name} color={item.color} type={item.direction} />
                              <div>
                                <strong>{item.name}</strong>
                                <span>{item.account}</span>
                              </div>
                            </div>
                            <div className="transaction-secondary">
                              <span>{item.category_name || "未分类"}</span>
                              <time>{item.date}</time>
                            </div>
                            <div className="transaction-tail">
                              <b className={item.amount > 0 ? "positive" : "negative"}>
                                {item.amount > 0 ? "+" : "-"}{formatMoney(Math.abs(item.amount))}
                              </b>
                              {canEdit && <ChevronRight size={17} aria-hidden="true" />}
                            </div>
                          </div>
                        );
                      })}
                      {!dashboardTransactions.length && (
                        <div className="empty-state">暂无最近交易，记一笔后展示。</div>
                      )}
                    </div>
                  </article>

                  </div>

                  <article className="panel budget-panel dashboard-wide-panel">
                    <div className="panel-title">
                      <div>
                        <h3>本月预算</h3>
                        <p>已用 {formatMoney(monthlyExpense)} / {formatMoney(budgetTotal)}</p>
                      </div>
                      <span className={`status-pill ${budgetPercent > 100 ? "danger" : "success"}`}>{budgetPercent > 100 ? "超支" : "跟踪中"}</span>
                    </div>
                    <div
                      className={`progress-track budget-track${budgetPercent > 100 ? " is-over" : ""}`}
                      role="progressbar"
                      aria-label="本月预算使用进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(budgetUsagePercent)}
                      aria-valuetext={`已用 ${budgetPercent.toFixed(0)}%`}
                    >
                      <span style={{ width: `${budgetUsagePercent}%` }} />
                    </div>
                    <div className="budget-footer">
                      <span>已用 <strong>{budgetPercent.toFixed(0)}%</strong></span>
                      <span>剩余 <strong className={budgetRemaining < 0 ? "negative" : ""}>{formatMoney(budgetRemaining)}</strong></span>
                    </div>
                  </article>
                </section>
              </>
  );
}
