import {
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronRight, History, ListPlus, Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import MetricValue from "../components/MetricValue";
import HoldingDetailDialog from "../features/investments/HoldingDetailDialog";

const RADIAN = Math.PI / 180;

function renderAllocationPercentLabel({
  cx,
  cy,
  innerRadius,
  midAngle,
  outerRadius,
  payload,
}) {
  const percent = Number(payload?.percent || 0);
  if (percent < 6) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text className="allocation-pie-label" x={x} y={y} textAnchor="middle" dominantBaseline="central">
      {`${percent.toFixed(percent % 1 ? 1 : 0)}%`}
    </text>
  );
}

export default function InvestmentPage({ view }) {
  const {
    formatMoney,
    investmentTotalValue,
    investmentProfit,
    investmentProfitRate,
    investmentHoldingsView,
    investmentCashAvailable,
    investmentCashAccountsView,
    setIsCashEditorOpen,
    quoteRefreshResult,
    formatQuoteSources,
    investmentTrendLabel,
    investmentTrendHint,
    ChartRangeSwitch,
    chartRangeOptions,
    investmentTrendRange,
    setInvestmentTrendRange,
    investmentTrendView,
    investmentTrades,
    investmentTradesMeta,
    investmentTradesRequest = {},
    loadInvestmentTradesPage,
    accountsData,
    tradeAccountFilter,
    setTradeAccountFilter,
    setReversalTarget,
    ChartTooltip,
    dataRevision,
    investmentAllocationView,
    holdingFilter,
    setHoldingFilter,
    filteredInvestmentHoldingsView,
    openAction,
    openEditAction,
    openTradeAction,
  } = view;
  const historyRef = useRef(null);
  const [tradePage, setTradePage] = useState(1);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const serverPagination = typeof loadInvestmentTradesPage === "function";
  useEffect(() => {
    if (tradeAccountFilter !== "all") historyRef.current?.scrollIntoView({ block: "start" });
  }, [tradeAccountFilter]);
  useEffect(() => {
    if (!serverPagination) return;
    loadInvestmentTradesPage({ accountId: tradeAccountFilter, page: tradePage });
  }, [dataRevision, loadInvestmentTradesPage, serverPagination, tradeAccountFilter, tradePage]);
  const trades = serverPagination
    ? investmentTrades
    : investmentTrades.filter((trade) => tradeAccountFilter === "all" || String(trade.account_id) === tradeAccountFilter);
  const tradePageCount = Math.max(
    1,
    Math.ceil((serverPagination ? investmentTradesMeta.total : trades.length) / 50),
  );
  useEffect(() => {
    if (serverPagination && !investmentTradesRequest.loading && !investmentTradesRequest.error
        && investmentTradesMeta.page === tradePage && tradePage > tradePageCount) setTradePage(tradePageCount);
  }, [investmentTradesMeta?.page, investmentTradesRequest.error, investmentTradesRequest.loading, serverPagination, tradePage, tradePageCount]);
  const hasEditableInvestmentAccount = investmentCashAccountsView.some((account) => account.can_edit !== false);
  const runHoldingDetailAction = (action) => {
    setSelectedHolding(null);
    window.setTimeout(action, 0);
  };

  return (
    <>
                <section className="summary-grid invest-summary">
                  <article className="metric-card">
                    <span>投资总市值</span>
                    <MetricValue>{formatMoney(investmentTotalValue)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>持仓浮动盈亏</span>
                    <MetricValue className={investmentProfit >= 0 ? "positive" : "negative"}>
                      {investmentProfit >= 0 ? "+" : "-"}{formatMoney(Math.abs(investmentProfit))}
                    </MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>持仓收益率 · {investmentHoldingsView.length} 项</span>
                    <MetricValue className={investmentProfitRate >= 0 ? "positive" : "negative"}>
                      {investmentProfitRate >= 0 ? "+" : ""}{investmentProfitRate.toFixed(1)}%
                    </MetricValue>
                  </article>
                  <article className="metric-card metric-card-action">
                    <span>现金可投 · {investmentCashAccountsView.length} 账户</span>
                    <MetricValue>{investmentCashAvailable ? formatMoney(investmentCashAvailable) : "暂无"}</MetricValue>
                    {hasEditableInvestmentAccount && (
                      <button
                        type="button"
                        className="cash-editor-trigger metric-card-edit"
                        aria-label="编辑现金可投"
                        title="编辑现金可投"
                        onClick={() => setIsCashEditorOpen(true)}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </article>
                </section>

                {quoteRefreshResult && (
                  <section className="quote-refresh-card">
                    <div>
                      <span>线上行情</span>
                      <strong>
                        已更新 {quoteRefreshResult.updated || 0} 项行情
                        {quoteRefreshResult.failed ? ` · ${quoteRefreshResult.failed} 项失败` : ""}
                        {quoteRefreshResult.skipped ? ` · ${quoteRefreshResult.skipped} 项跳过` : ""}
                      </strong>
                      <p>
                        数据源：{formatQuoteSources(quoteRefreshResult)} · 更新时间 {quoteRefreshResult.updated_at ? new Date(quoteRefreshResult.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "刚刚"}
                      </p>
                    </div>
                    <b>{formatMoney(quoteRefreshResult.summary?.total_value || investmentTotalValue)}</b>
                  </section>
                )}

                <section className="investment-grid">
                  <article className="panel investment-chart-panel">
                    <div className="panel-title chart-panel-title">
                      <div>
                        <h3>持仓市值趋势</h3>
                        <p>{investmentTrendLabel} · {investmentTrendHint} · 单位万元</p>
                      </div>
                      <div className="chart-title-actions">
                        <ChartRangeSwitch options={chartRangeOptions.trend} value={investmentTrendRange} onChange={setInvestmentTrendRange} />
                        <div className="chart-legend">
                          <span><i />我的组合</span>
                        </div>
                      </div>
                    </div>
                    {investmentTrendView.length > 1 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={investmentTrendView}>
                          <CartesianGrid stroke="#dce3e0" vertical={false} />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} hide />
                          <YAxis axisLine={false} tickLine={false} hide />
                          <Tooltip
                            content={
                              <ChartTooltip
                                title="持仓市值"
                                names={{ mine: "我的组合" }}
                                valueFormatter={(value) => `${value} 万`}
                              />
                            }
                            cursor={{ stroke: "#9eaaa4", strokeDasharray: "4 4" }}
                          />
                          <Line dataKey="mine" stroke="#176b4d" strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }} type="monotone" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state">暂无可对比的持仓市值趋势，积累多天或多月快照后展示。</div>
                    )}
                  </article>

                  <article className="panel allocation-panel">
                    <div className="panel-title">
                      <div>
                        <h3>大类配置</h3>
                        <p>按当前持仓市值汇总</p>
                      </div>
                    </div>
                    {investmentAllocationView.length ? (
                      <div className="allocation-chart-layout">
                        <div className="allocation-donut">
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie
                                data={investmentAllocationView}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={58}
                                outerRadius={92}
                                paddingAngle={2}
                                labelLine={false}
                                label={renderAllocationPercentLabel}
                                isAnimationActive={false}
                              >
                                {investmentAllocationView.map((item) => (
                                  <Cell fill={item.color} key={item.name} />
                                ))}
                              </Pie>
                              <Tooltip
                                content={
                                  <ChartTooltip
                                    title="大类配置"
                                    valueFormatter={(value) => formatMoney(value)}
                                  />
                                }
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="allocation-donut-center">
                            <span>总市值</span>
                            <strong>{formatMoney(investmentTotalValue)}</strong>
                          </div>
                        </div>
                        <div className="allocation-legend" role="list" aria-label="大类配置图例">
                          {investmentAllocationView.map((item) => (
                            <div className="allocation-legend-row" role="listitem" key={item.name}>
                              <i style={{ background: item.color }} aria-hidden="true" />
                              <div>
                                <strong>{item.name}</strong>
                                <span>{formatMoney(item.value)}</span>
                              </div>
                              <b>{item.percent}%</b>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">暂无持仓配置数据。</div>
                    )}
                  </article>

                  <article className="panel holdings-table-panel holdings-overview-panel">
                    {investmentHoldingsView.some((item) => item.included_in_totals === 0) && <p className="workflow-note">
                      未关联账户的旧持仓保留在下方，暂不计入资产与投资汇总。请通过“编辑”关联投资账户。
                    </p>}
                    <div className="panel-title holdings-panel-title">
                      <div>
                        <h3>持仓明细</h3>
                        <p>已有持仓只录入现状，买卖交易会联动现金可投</p>
                      </div>
                      <div className="panel-actions holdings-toolbar">
                        <div className="segmented" role="group" aria-label="持仓类型">
                          {["全部", "基金", "股票"].map((filter) => (
                            <button
                              type="button"
                              className={holdingFilter === filter ? "active" : ""}
                              aria-pressed={holdingFilter === filter}
                              key={filter}
                              onClick={() => setHoldingFilter(filter)}
                            >
                              {filter}
                            </button>
                          ))}
                        </div>
                        <button type="button" className="filter-button" disabled={!hasEditableInvestmentAccount} onClick={() => openAction("holding")}>
                          <ListPlus size={15} /> 录入已有持仓
                        </button>
                        <button type="button" className="filter-button primary" disabled={!hasEditableInvestmentAccount} onClick={() => openAction("new_trade")}>
                          <Plus size={15} /> 买入新标的
                        </button>
                      </div>
                    </div>
                    <div className="investment-table">
                      <div className="investment-table-head">
                        <span>标的</span>
                        <span>投资账户</span>
                        <span>持仓成本</span>
                        <span>现价</span>
                        <span>市值</span>
                        <span>盈亏金额</span>
                        <span>收益率</span>
                        <span>占比</span>
                        <span>操作</span>
                      </div>
                      {filteredInvestmentHoldingsView.map((item) => (
                        <div className="investment-row" key={item.id}>
                          <button
                            type="button"
                            className="holding-list-summary"
                            aria-label={`查看${item.name}持仓详情`}
                            onClick={() => setSelectedHolding(item)}
                          >
                            <span className="holding-summary-main">
                              <strong>{item.name}</strong>
                              <small>{item.code} · {item.account_name}</small>
                            </span>
                            <span className="holding-summary-values">
                              <strong>{formatMoney(item.value)}</strong>
                              <small className={item.returnRate >= 0 ? "positive" : "negative"}>
                                {item.returnRate >= 0 ? "+" : ""}{item.returnRate.toFixed(1)}%
                              </small>
                            </span>
                            <ChevronRight size={18} aria-hidden="true" />
                          </button>
                          <div className="investment-identity">
                            <div className="investment-primary">
                              <strong>{item.name}</strong>
                              <span>{item.code}</span>
                            </div>
                            <span className="investment-account" data-label="投资账户">{item.account_name}</span>
                          </div>
                          <span className="investment-cost" data-label="持仓成本">{item.cost}</span>
                          <span className="investment-price" data-label="现价">{item.price}</span>
                          <span className="investment-value" data-label="市值">{formatMoney(item.value)}</span>
                          <span className={`investment-profit ${item.profit >= 0 ? "positive" : "negative"}`} data-label="盈亏金额">
                            {item.profit >= 0 ? "+" : "-"}{formatMoney(Math.abs(item.profit))}
                          </span>
                          <span className={`investment-return ${item.returnRate >= 0 ? "positive" : "negative"}`} data-label="收益率">
                            {item.returnRate >= 0 ? "+" : ""}{item.returnRate.toFixed(1)}%
                          </span>
                          <span className="investment-ratio ratio-pill" data-label="占比">{item.percent}%</span>
                          {item.can_edit !== false ? (
                            <div className="row-actions">
                              <button type="button" className="edit-button subtle" disabled={!item.account_id} title={!item.account_id ? "请先编辑并关联投资账户" : "记录买入"} onClick={() => openTradeAction(item, "buy")}>买入</button>
                              <button type="button" className="edit-button subtle" disabled={!item.account_id} title={!item.account_id ? "请先编辑并关联投资账户" : "记录卖出"} onClick={() => openTradeAction(item, "sell")}>卖出</button>
                              <button type="button" className="row-icon-button" aria-label={`编辑${item.name}`} title="编辑持仓" onClick={() => openEditAction("holding", item)}>
                                <Pencil size={15} />
                              </button>
                            </div>
                          ) : <span className="readonly-label">仅查看</span>}
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className="panel holdings-table-panel trade-history-panel" ref={historyRef}>
                    <div className="panel-title trade-history-header">
                      <div>
                        <h3>
                          买卖记录
                          <span className="trade-count">{serverPagination ? investmentTradesMeta.total : trades.length} 笔</span>
                        </h3>
                        <p>{investmentTradesRequest.loading ? "正在加载交易..." : "有效交易联动现金 · 更正时先撤销再录入"}</p>
                      </div>
                      <label className="trade-history-filter">
                        <span>投资账户</span>
                        <select className="filter-button" aria-label="交易记录账户" value={tradeAccountFilter} onChange={(event) => { setTradeAccountFilter(event.target.value); setTradePage(1); }}>
                          <option value="all">全部投资账户</option>
                          {(accountsData.accounts || []).filter((account) => account.type === "investment").map((account) => (
                            <option key={account.id} value={account.id}>{account.owner} · {account.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="trade-history-list">
                      {trades.map((trade) => (
                        <div className="detail-list-row" key={trade.id}>
                          <div>
                            <strong>{trade.voided_at ? "已撤销 · " : ""}{trade.trade_type === "buy" ? "买入" : "卖出"} · {trade.holding_name}</strong>
                            <span>{trade.occurred_at} · {trade.account_owner} · {trade.account_name}{trade.void_reason ? ` · ${trade.void_reason}` : ""}</span>
                          </div>
                          <span>{trade.quantity} × {trade.price}</span>
                          <b className={trade.trade_type === "buy" ? "negative" : "positive"}>
                            {trade.trade_type === "buy" ? "-" : "+"}{formatMoney(trade.base_amount)}
                          </b>
                          {!trade.voided_at && <button type="button" className="edit-button subtle"
                            disabled={trade.can_reverse !== true}
                            title={trade.can_reverse ? "撤销后可重新录入" : trade.reverse_disabled_reason || "当前交易不能撤销"}
                            onClick={() => setReversalTarget({ type: "trade", item: trade })}>撤销</button>}
                        </div>
                      ))}
                      {investmentTradesRequest.loading
                        ? <div className="empty-state" role="status">正在加载交易...</div>
                        : !trades.length && (
                          <div className="empty-state trade-history-empty">
                            <History size={20} aria-hidden="true" />
                            <div>
                              <strong>暂无买卖记录</strong>
                              <span>已有持仓录入不会生成交易</span>
                            </div>
                          </div>
                        )}
                    </div>
                    {tradePageCount > 1 && <div className="ledger-pagination">
                      <button type="button" className="filter-button" disabled={investmentTradesRequest.loading || tradePage === 1} onClick={() => setTradePage((value) => value - 1)}>上一页</button>
                      <span>第 {tradePage} / {tradePageCount} 页 · 共 {investmentTradesMeta.total} 笔</span>
                      <button type="button" className="filter-button" disabled={investmentTradesRequest.loading || tradePage === tradePageCount} onClick={() => setTradePage((value) => value + 1)}>下一页</button>
                    </div>}
                  </article>
                </section>
                <HoldingDetailDialog
                  formatMoney={formatMoney}
                  holding={selectedHolding}
                  onClose={() => setSelectedHolding(null)}
                  onEdit={(holding) => runHoldingDetailAction(() => openEditAction("holding", holding))}
                  onTrade={(holding, tradeType) => runHoldingDetailAction(() => openTradeAction(holding, tradeType))}
                />
              </>
  );
}
