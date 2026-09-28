import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function IncomePage({ view }) {
  const {
    incomeChartLabel,
    formatMoney,
    incomeData,
    selectedIncomeItem,
    ChartRangeSwitch,
    chartRangeOptions,
    incomeChartRange,
    setIncomeChartRange,
    chartIncomeCategories,
    selectedIncomeCategory,
    toggleIncomeCategory,
    ChartTooltip,
    focusedIncomeValue,
    focusedIncomeLabel,
    IconBadge,
    setSelectedIncomeCategory,
    incomeTrendLabel,
    incomeTrendHint,
    incomeTrendRange,
    setIncomeTrendRange,
    incomeTrendView,
    detailIncomeCategories,
    handleExportIncome,
    incomeOrderRows,
    incomeOrderTotal,
    incomeAccountFilter,
    incomeOrderSearch,
    resetIncomeFilters,
    setIncomeOrderSearch,
    visibleIncomeCategories,
    setIncomeAccountFilter,
    incomeAccountOptions,
    formatDateLabel,
    openEditAction,
  } = view;

  return (
    <>
                <section className="summary-grid expense-summary income-summary">
                  <article className="metric-card">
                    <span>{incomeChartLabel}总收入</span>
                    <strong className="positive">{formatMoney(incomeData.total_income)}</strong>
                    <p className="positive">按所选范围实时分类汇总</p>
                  </article>
                  <article className="metric-card">
                    <span>日均收入</span>
                    <strong>{formatMoney(incomeData.daily_average)}</strong>
                    <p>{incomeChartLabel}平均每日收入</p>
                  </article>
                  <article className="metric-card">
                    <span>最大收入来源</span>
                    <strong className="metric-pair">
                      <span>{incomeData.largest_category?.name || "暂无"}</span>
                      <em>{formatMoney(incomeData.largest_category?.amount || 0)}</em>
                    </strong>
                    <p>占比 {incomeData.largest_category?.percent || 0}%</p>
                  </article>
                </section>

                <section className="expense-grid income-page">
                  <article className="panel expense-structure-panel">
                    <div className="panel-title">
                      <div>
                        <h3>收入结构</h3>
                        <p>{incomeChartLabel} · 按来源占比</p>
                      </div>
                      <div className="chart-title-actions">
                        <ChartRangeSwitch options={chartRangeOptions.expense} value={incomeChartRange} onChange={setIncomeChartRange} />
                        <span className="expense-structure-badge">
                          {selectedIncomeItem ? "已筛选" : "点击来源筛选"}
                        </span>
                      </div>
                    </div>
                    {chartIncomeCategories.length ? (
                      <div className="expense-structure">
                        <div className="donut-wrap expense-donut">
                          <ResponsiveContainer width="100%" height={210}>
                            <PieChart>
                              <Pie
                                data={[{ name: "全部", value: incomeData.total_income || 1 }]}
                                dataKey="value"
                                innerRadius={72}
                                outerRadius={98}
                                fill="#e1ecd9"
                                stroke="transparent"
                                isAnimationActive={false}
                              />
                              <Pie
                                data={chartIncomeCategories}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={72}
                                outerRadius={98}
                                paddingAngle={4}
                                startAngle={90}
                                endAngle={-270}
                                cornerRadius={10}
                                onClick={(item) => toggleIncomeCategory(item?.name)}
                              >
                                {chartIncomeCategories.map((item) => (
                                  <Cell
                                    className="clickable-chart-cell"
                                    key={item.name}
                                    fill={item.color}
                                    opacity={!selectedIncomeItem || selectedIncomeItem.name === item.name ? 1 : 0.28}
                                    stroke={selectedIncomeItem?.name === item.name ? "#fffdf8" : "transparent"}
                                    strokeWidth={selectedIncomeItem?.name === item.name ? 3 : 0}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                content={
                                  <ChartTooltip
                                    title="收入结构"
                                    labelFormatter={(_, rows) => rows[0]?.payload?.name}
                                    valueFormatter={(value, item) => `${formatMoney(value)} · ${item.payload?.percent || 0}%`}
                                  />
                                }
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="donut-center expense-center">
                            <strong>{formatMoney(focusedIncomeValue)}</strong>
                            <span>{focusedIncomeLabel}</span>
                          </div>
                        </div>
                        <div className="expense-legend">
                          {chartIncomeCategories.map((item) => (
                            <button type="button" className={selectedIncomeCategory === item.name ? "active" : ""} key={item.name} onClick={() => toggleIncomeCategory(item.name)}>
                              <IconBadge className="legend-icon" icon={item.icon} name={item.name} color={item.color} type="income" />
                              <b>
                                {item.name}
                                <small>{formatMoney(item.value)}</small>
                              </b>
                              <strong>{item.percent}%</strong>
                              <i className="expense-legend-bar">
                                <em style={{ width: `${Math.min(item.percent, 100)}%`, background: item.color }} />
                              </i>
                            </button>
                          ))}
                          {selectedIncomeCategory && (
                            <button type="button" className="expense-clear-button" onClick={() => setSelectedIncomeCategory(null)}>
                              查看全部来源
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">暂无收入来源，记一笔收入后展示。</div>
                    )}
                  </article>

                  <article className="panel cashflow-panel">
                    <div className="panel-title">
                      <div>
                        <h3>收入趋势</h3>
                        <p>{incomeTrendLabel} · {incomeTrendHint} · 单位千元</p>
                      </div>
                      <ChartRangeSwitch options={chartRangeOptions.cashflow} value={incomeTrendRange} onChange={setIncomeTrendRange} />
                    </div>
                    {incomeTrendView.length ? (
                      <div className="cashflow-chart-body">
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={incomeTrendView}>
                            <CartesianGrid stroke="#e9e1d4" vertical={false} />
                            <XAxis dataKey="month" axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip
                              content={
                                <ChartTooltip
                                  title="收入趋势"
                                  names={{ income: "收入" }}
                                  valueFormatter={(value) => `${value} 千元`}
                                />
                              }
                              cursor={{ fill: "rgba(33, 79, 59, 0.06)" }}
                            />
                            <Bar dataKey="income" fill="#214f3b" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="bar-legend income-legend">
                          <span><i />收入</span>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">暂无收入流水，记一笔收入后展示。</div>
                    )}
                  </article>

                  <article className="panel expense-detail-panel">
                    <div className="panel-title">
                      <div>
                        <h3>收入分类明细</h3>
                        <p>按来源统计收入贡献</p>
                      </div>
                      <div className="panel-actions">
                        <button type="button" className="filter-button" onClick={handleExportIncome}>导出报表</button>
                      </div>
                    </div>
                    <div className="expense-table">
                      <div className="expense-head income-head">
                        <span>来源</span>
                        <span>收入金额</span>
                        <span>状态</span>
                        <span>占比</span>
                        <span>贡献度</span>
                      </div>
                      {detailIncomeCategories.map((item) => (
                        <div className="expense-row income-row" key={item.name}>
                          <div className="expense-name">
                            <IconBadge icon={item.icon} name={item.name} color={item.color} type="income" />
                            <strong>{item.name}</strong>
                          </div>
                          <b>{formatMoney(item.value)}</b>
                          <span className="positive">{item.change}</span>
                          <span>{item.percent}%</span>
                          <div className="progress-track">
                            <span style={{ width: `${Math.min(item.percent, 100)}%`, background: item.color }} />
                          </div>
                        </div>
                      ))}
                      {!detailIncomeCategories.length && (
                        <div className="empty-state">暂无收入分类，记一笔收入后展示。</div>
                      )}
                    </div>
                  </article>

                  <article className="panel payment-orders-panel">
                    <div className="panel-title">
                      <div>
                        <h3>收入流水明细</h3>
                        <p>{incomeChartLabel} · {incomeOrderRows.length} 笔 · 合计 {formatMoney(incomeOrderTotal)}</p>
                      </div>
                      {(selectedIncomeCategory || incomeAccountFilter !== "all" || incomeOrderSearch) && (
                        <button type="button" className="filter-button" onClick={resetIncomeFilters}>清空筛选</button>
                      )}
                    </div>
                    <div className="payment-filter-bar">
                      <input
                        value={incomeOrderSearch}
                        onChange={(event) => setIncomeOrderSearch(event.target.value)}
                        placeholder="搜索来源、备注、金额"
                      />
                      <select value={selectedIncomeCategory || "all"} onChange={(event) => setSelectedIncomeCategory(event.target.value === "all" ? null : event.target.value)}>
                        <option value="all">全部来源</option>
                        {visibleIncomeCategories.map((item) => (
                          <option key={item.name} value={item.name}>{item.name}</option>
                        ))}
                      </select>
                      <select value={incomeAccountFilter} onChange={(event) => setIncomeAccountFilter(event.target.value)}>
                        <option value="all">全部账户</option>
                        {incomeAccountOptions.map(([accountId, accountName]) => (
                          <option key={accountId} value={accountId}>{accountName}</option>
                        ))}
                      </select>
                    </div>
                    {incomeOrderRows.length ? (
                      <div className="payment-order-list">
                        {incomeOrderRows.map((item) => (
                          <div className="payment-order-row income-order-row" key={item.id}>
                            <span className="payment-category-mark" style={{ "--order-color": item.color }}>
                              {item.icon}
                            </span>
                            <div className="payment-order-main">
                              <div>
                                <strong>{item.name}</strong>
                                <span>{formatDateLabel(item.occurred_at)} · {item.account_label}{item.note ? ` · ${item.note}` : ""}</span>
                              </div>
                            </div>
                            <span className="payment-order-category">{item.category_name}</span>
                            <b className="positive">+{formatMoney(item.amount)}</b>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("transaction", item)}>编辑</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">{selectedIncomeCategory ? "该来源暂无收入流水。" : "暂无收入流水，记一笔收入后展示。"}</div>
                    )}
                  </article>
                </section>
              </>
  );
}
