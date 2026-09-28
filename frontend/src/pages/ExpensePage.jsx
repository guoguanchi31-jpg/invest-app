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

export default function ExpensePage({ view }) {
  const {
    expenseChartLabel,
    formatMoney,
    expenseData,
    selectedExpenseItem,
    ChartRangeSwitch,
    chartRangeOptions,
    expenseChartRange,
    setExpenseChartRange,
    chartExpenseCategories,
    selectedExpenseCategory,
    toggleExpenseCategory,
    ChartTooltip,
    focusedExpenseValue,
    focusedExpenseLabel,
    IconBadge,
    setSelectedExpenseCategory,
    cashflowRangeLabel,
    cashflowHint,
    cashflowRange,
    setCashflowRange,
    cashflowView,
    detailExpenseCategories,
    handleExportExpense,
    paymentOrderRows,
    paymentOrderTotal,
    paymentAccountFilter,
    paymentOrderSearch,
    resetPaymentFilters,
    setPaymentOrderSearch,
    visibleExpenseCategories,
    setPaymentAccountFilter,
    paymentAccountOptions,
    formatDateLabel,
    openEditAction,
  } = view;

  return (
    <>
                <section className="summary-grid expense-summary">
                  <article className="metric-card">
                    <span>{expenseChartLabel}总支出</span>
                    <strong>{formatMoney(expenseData.total_expense)}</strong>
                    <p className="negative">按所选范围实时分类汇总</p>
                  </article>
                  <article className="metric-card">
                    <span>日均支出</span>
                    <strong>{formatMoney(expenseData.daily_average)}</strong>
                    <p>{expenseChartLabel}平均每日支出</p>
                  </article>
                  <article className="metric-card">
                    <span>最大支出类别</span>
                    <strong className="metric-pair">
                      <span>{expenseData.largest_category?.name || "暂无"}</span>
                      <em>{formatMoney(expenseData.largest_category?.amount || 0)}</em>
                    </strong>
                    <p>占比 {expenseData.largest_category?.percent || 0}%</p>
                  </article>
                </section>

                <section className="expense-grid">
                  <article className="panel expense-structure-panel">
                    <div className="panel-title">
                      <div>
                        <h3>支出结构</h3>
                        <p>{expenseChartLabel} · 按分类占比</p>
                      </div>
                      <div className="chart-title-actions">
                        <ChartRangeSwitch options={chartRangeOptions.expense} value={expenseChartRange} onChange={setExpenseChartRange} />
                        <span className="expense-structure-badge">
                          {selectedExpenseItem ? "已筛选" : "点击分类筛选"}
                        </span>
                      </div>
                    </div>
                    {chartExpenseCategories.length ? (
                      <div className="expense-structure">
                        <div className="donut-wrap expense-donut">
                          <ResponsiveContainer width="100%" height={210}>
                            <PieChart>
                              <Pie
                                data={[{ name: "全部", value: expenseData.total_expense || 1 }]}
                                dataKey="value"
                                innerRadius={72}
                                outerRadius={98}
                                fill="#eee3d4"
                                stroke="transparent"
                                isAnimationActive={false}
                              />
                              <Pie
                                data={chartExpenseCategories}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={72}
                                outerRadius={98}
                                paddingAngle={4}
                                startAngle={90}
                                endAngle={-270}
                                cornerRadius={10}
                                onClick={(item) => toggleExpenseCategory(item?.name)}
                              >
                                {chartExpenseCategories.map((item) => (
                                  <Cell
                                    className="clickable-chart-cell"
                                    key={item.name}
                                    fill={item.color}
                                    opacity={!selectedExpenseItem || selectedExpenseItem.name === item.name ? 1 : 0.28}
                                    stroke={selectedExpenseItem?.name === item.name ? "#fffdf8" : "transparent"}
                                    strokeWidth={selectedExpenseItem?.name === item.name ? 3 : 0}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                content={
                                  <ChartTooltip
                                    title="支出结构"
                                    labelFormatter={(_, rows) => rows[0]?.payload?.name}
                                    valueFormatter={(value, item) => `${formatMoney(value)} · ${item.payload?.percent || 0}%`}
                                  />
                                }
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="donut-center expense-center">
                            <strong>{formatMoney(focusedExpenseValue)}</strong>
                            <span>{focusedExpenseLabel}</span>
                          </div>
                        </div>
                        <div className="expense-legend">
                          {chartExpenseCategories.map((item) => (
                            <button type="button" className={selectedExpenseCategory === item.name ? "active" : ""} key={item.name} onClick={() => toggleExpenseCategory(item.name)}>
                              <IconBadge className="legend-icon" icon={item.icon} name={item.name} color={item.color} />
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
                          {selectedExpenseCategory && (
                            <button type="button" className="expense-clear-button" onClick={() => setSelectedExpenseCategory(null)}>
                              查看全部分类
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">暂无支出分类，记一笔后展示。</div>
                    )}
                  </article>

                  <article className="panel cashflow-panel">
                    <div className="panel-title">
                      <div>
                        <h3>收支对比</h3>
                        <p>{cashflowRangeLabel} · {cashflowHint} · 单位千元</p>
                      </div>
                      <ChartRangeSwitch options={chartRangeOptions.cashflow} value={cashflowRange} onChange={setCashflowRange} />
                    </div>
                    {cashflowView.length ? (
                      <div className="cashflow-chart-body">
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={cashflowView} barGap={8}>
                            <CartesianGrid stroke="#e9e1d4" vertical={false} />
                            <XAxis dataKey="month" axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip
                              content={
                                <ChartTooltip
                                  title="收支对比"
                                  names={{ income: "收入", expense: "支出" }}
                                  valueFormatter={(value) => `${value} 千元`}
                                />
                              }
                            cursor={{ fill: "rgba(33, 79, 59, 0.06)" }}
                            />
                            <Bar dataKey="income" fill="#214f3b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="expense" fill="#df7f56" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="bar-legend">
                          <span><i />收入</span>
                          <span><i />支出</span>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">暂无收支流水，记一笔后展示。</div>
                    )}
                  </article>

                  <article className="panel expense-detail-panel">
                    <div className="panel-title">
                      <div>
                        <h3>分类明细</h3>
                        <p>含环比变化与预算达成</p>
                      </div>
                      <div className="panel-actions">
                        <button type="button" className="filter-button" onClick={handleExportExpense}>导出报表</button>
                      </div>
                    </div>
                    <div className="expense-table">
                      <div className="expense-head">
                        <span>分类</span>
                        <span>本月金额</span>
                        <span>环比</span>
                        <span>占比</span>
                        <span>预算达成</span>
                      </div>
                      {detailExpenseCategories.map((item) => (
                        <div className="expense-row" key={item.name}>
                          <div className="expense-name">
                            <IconBadge icon={item.icon} name={item.name} color={item.color} />
                            <strong>{item.name}</strong>
                          </div>
                          <b>{formatMoney(item.value)}</b>
                          <span className={item.trend === "down" ? "positive" : item.trend === "up" ? "negative" : ""}>
                            {item.change}
                          </span>
                          <span>{item.percent}%</span>
                          <div className="progress-track">
                            <span style={{ width: `${Math.min(item.percent * 2.4, 100)}%`, background: item.color }} />
                          </div>
                        </div>
                      ))}
                      {!detailExpenseCategories.length && (
                        <div className="empty-state">暂无支出分类，记一笔后展示。</div>
                      )}
                    </div>
                  </article>

                  <article className="panel payment-orders-panel">
                    <div className="panel-title">
                      <div>
                        <h3>支付订单明细</h3>
                        <p>{expenseChartLabel} · {paymentOrderRows.length} 笔 · 合计 {formatMoney(paymentOrderTotal)}</p>
                      </div>
                      {(selectedExpenseCategory || paymentAccountFilter !== "all" || paymentOrderSearch) && (
                        <button type="button" className="filter-button" onClick={resetPaymentFilters}>清空筛选</button>
                      )}
                    </div>
                    <div className="payment-filter-bar">
                      <input
                        value={paymentOrderSearch}
                        onChange={(event) => setPaymentOrderSearch(event.target.value)}
                        placeholder="搜索商户、备注、金额"
                      />
                      <select value={selectedExpenseCategory || "all"} onChange={(event) => setSelectedExpenseCategory(event.target.value === "all" ? null : event.target.value)}>
                        <option value="all">全部分类</option>
                        {visibleExpenseCategories.map((item) => (
                          <option key={item.name} value={item.name}>{item.name}</option>
                        ))}
                      </select>
                      <select value={paymentAccountFilter} onChange={(event) => setPaymentAccountFilter(event.target.value)}>
                        <option value="all">全部账户</option>
                        {paymentAccountOptions.map(([accountId, accountName]) => (
                          <option key={accountId} value={accountId}>{accountName}</option>
                        ))}
                      </select>
                    </div>
                    {paymentOrderRows.length ? (
                      <div className="payment-order-list">
                        {paymentOrderRows.map((item) => (
                          <div className="payment-order-row" key={item.id}>
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
                            <b className="negative">-{formatMoney(item.amount)}</b>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("transaction", item)}>编辑</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">{selectedExpenseCategory ? "该分类暂无支付订单。" : "暂无支付订单，记一笔后展示。"}</div>
                    )}
                  </article>
                </section>
              </>
  );
}
