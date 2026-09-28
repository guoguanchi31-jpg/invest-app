import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function DashboardPage({ view }) {
  const {
    formatMoney,
    netWorth,
    totalProfit,
    profitRate,
    monthlyIncome,
    monthlyExpense,
    budgetLeft,
    savingsRate,
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

  return (
    <>
                <section className="summary-grid">
                  <article className="metric-card">
                    <span>净资产</span>
                    <strong>{formatMoney(netWorth)}</strong>
                    <p className={totalProfit >= 0 ? "positive" : "negative"}>
                      持仓收益 {totalProfit >= 0 ? "+" : ""}{profitRate.toFixed(1)}% · {totalProfit >= 0 ? "+" : "-"}{formatMoney(Math.abs(totalProfit))}
                    </p>
                  </article>
                  <article className="metric-card">
                    <span>本月收入</span>
                    <strong>{formatMoney(monthlyIncome)}</strong>
                    <p className="positive">来自已录入收入流水</p>
                  </article>
                  <article className="metric-card">
                    <span>本月支出</span>
                    <strong>{formatMoney(monthlyExpense)}</strong>
                    <p className="negative">来自已录入支出流水</p>
                  </article>
                  <article className="metric-card">
                    <span>本月结余</span>
                    <strong>{formatMoney(budgetLeft)}</strong>
                    <p>储蓄率 <b className="positive">{savingsRate}%</b></p>
                  </article>
                </section>

                <section className="dashboard-grid">
                  <article className="panel chart-panel">
                    <div className="panel-title">
                      <div>
                        <h3>净资产趋势</h3>
                        <p>{dashboardTrendLabel} · {dashboardTrendHint} · 单位万元</p>
                      </div>
                      <ChartRangeSwitch options={chartRangeOptions.trend} value={dashboardTrendRange} onChange={setDashboardTrendRange} />
                    </div>
                    {trendData.length > 1 ? (
                      <ResponsiveContainer width="100%" height={230}>
                        <AreaChart data={trendData}>
                          <defs>
                            <linearGradient id="netWorth" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="5%" stopColor="#214f3b" stopOpacity={0.28} />
                              <stop offset="95%" stopColor="#214f3b" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#e9e1d4" strokeDasharray="4 4" vertical={false} />
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
                            cursor={{ stroke: "#cbbda8", strokeDasharray: "4 4" }}
                          />
                          <Area dataKey="value" stroke="#214f3b" strokeWidth={3} fill="url(#netWorth)" type="monotone" activeDot={{ r: 5, strokeWidth: 2, stroke: "#fffdf8" }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state">暂无可对比的净资产趋势，积累多天或多月快照后展示。</div>
                    )}
                  </article>

                  <article className="panel transaction-panel">
                    <div className="panel-title">
                      <div>
                        <h3>最近交易</h3>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => setActivePage("ledger")}>查看全部 →</button>
                    </div>
                    <div className="transaction-list">
                      {dashboardTransactions.map((item) => (
                        <div className="transaction" key={item.id || `${item.name}-${item.date}`}>
                          <div className="transaction-main">
                            <IconBadge className="transaction-icon" icon={item.icon} name={item.category_name} color={item.color} type={item.direction} />
                            <div>
                              <strong>{item.name}</strong>
                              <span>{item.account}</span>
                            </div>
                          </div>
                          <b className={item.amount > 0 ? "positive" : "negative"}>
                            {item.amount > 0 ? "+" : "-"}{formatMoney(Math.abs(item.amount))}
                          </b>
                          <time>{item.date}</time>
                          <button type="button" className="edit-button subtle" onClick={() => openEditAction("transaction", item)}>编辑</button>
                        </div>
                      ))}
                      {!dashboardTransactions.length && (
                        <div className="empty-state">暂无最近交易，记一笔后展示。</div>
                      )}
                    </div>
                  </article>

                  <article className="panel budget-panel">
                    <div className="panel-title">
                      <div>
                        <h3>本月预算</h3>
                        <p>已用 {formatMoney(monthlyExpense)} / {formatMoney(budgetTotal)}</p>
                      </div>
                      <span className={`status-pill ${budgetPercent > 100 ? "danger" : "success"}`}>{budgetPercent > 100 ? "超支" : "跟踪中"}</span>
                    </div>
                    <div className="progress-track budget-track">
                      <span style={{ width: `${Math.min(budgetPercent, 100)}%` }} />
                    </div>
                    <div className="budget-footer">
                      <span>已用 {budgetPercent.toFixed(0)}%</span>
                      <span>剩余 {formatMoney(budgetTotal - monthlyExpense)}</span>
                    </div>
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
                        全部 →
                      </button>
                    </div>
                    <div className="progress-list">
                      {goalCardsView.slice(0, 2).map((item) => {
                        const percent = item.target ? Math.min(item.current / item.target * 100, 100) : 0;
                        return (
                          <div className="progress-item" key={item.name}>
                            <div>
                              <strong>{item.name}</strong>
                              <span>{Math.round(percent)}%</span>
                            </div>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("goal", item)}>编辑</button>
                            <div className="progress-track">
                              <span style={{ width: `${percent}%`, background: item.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                </section>
              </>
  );
}
