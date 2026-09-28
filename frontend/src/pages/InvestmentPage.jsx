import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef } from "react";

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
    accountsData,
    tradeAccountFilter,
    setTradeAccountFilter,
    setReversalTarget,
    ChartTooltip,
    investmentAllocationView,
    holdingFilter,
    setHoldingFilter,
    filteredInvestmentHoldingsView,
    openAction,
    openEditAction,
    openTradeAction,
  } = view;
  const historyRef = useRef(null);
  useEffect(() => {
    if (tradeAccountFilter !== "all") historyRef.current?.scrollIntoView({ block: "start" });
  }, [tradeAccountFilter]);
  const trades = investmentTrades.filter((trade) => tradeAccountFilter === "all" || String(trade.account_id) === tradeAccountFilter);
  const latestIds = new Map();
  investmentTrades.filter((trade) => !trade.voided_at).forEach((trade) => {
    latestIds.set(trade.holding_id, Math.max(latestIds.get(trade.holding_id) || 0, trade.id));
  });

  return (
    <>
                <section className="summary-grid invest-summary">
                  <article className="metric-card">
                    <span>投资总市值</span>
                    <strong>{formatMoney(investmentTotalValue)}</strong>
                    <p className={investmentProfit >= 0 ? "positive" : "negative"}>
                      {investmentProfit >= 0 ? "▲" : "▼"} {Math.abs(investmentProfitRate).toFixed(1)}% · 持仓浮动盈亏 {investmentProfit >= 0 ? "+" : "-"}{formatMoney(Math.abs(investmentProfit))}
                    </p>
                  </article>
                  <article className="metric-card">
                    <span>持仓浮动盈亏</span>
                    <strong className={investmentProfit >= 0 ? "positive" : "negative"}>
                      {investmentProfit >= 0 ? "+" : "-"}{formatMoney(Math.abs(investmentProfit))}
                    </strong>
                    <p className={investmentProfit >= 0 ? "positive" : "negative"}>
                      {investmentProfit >= 0 ? "▲" : "▼"} {Math.abs(investmentProfitRate).toFixed(1)}%
                    </p>
                  </article>
                  <article className="metric-card">
                    <span>持仓收益率</span>
                    <strong className={investmentProfitRate >= 0 ? "positive" : "negative"}>
                      {investmentProfitRate >= 0 ? "+" : ""}{investmentProfitRate.toFixed(1)}%
                    </strong>
                    <p>{investmentHoldingsView.length} 个持仓标的</p>
                  </article>
                  <article className="metric-card">
                    <span>股票账户现金可投</span>
                    <strong>{investmentCashAvailable ? formatMoney(investmentCashAvailable) : "暂无"}</strong>
                    <div className="metric-card-footer">
                      <p>{investmentCashAccountsView.length ? `${investmentCashAccountsView.length} 个投资账户独立维护` : "暂无投资账户"}</p>
                      <button type="button" className="cash-editor-trigger compact" onClick={() => setIsCashEditorOpen(true)}>编辑</button>
                    </div>
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
                    <div className="panel-title">
                      <div>
                        <h3>持仓市值趋势</h3>
                        <p>{investmentTrendLabel} · {investmentTrendHint} · 行情快照 · 单位万元</p>
                      </div>
                      <div className="chart-legend">
                        <ChartRangeSwitch options={chartRangeOptions.trend} value={investmentTrendRange} onChange={setInvestmentTrendRange} />
                        <span><i />我的组合</span>
                      </div>
                    </div>
                    {investmentTrendView.length > 1 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={investmentTrendView}>
                          <CartesianGrid stroke="#e9e1d4" vertical={false} />
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
                            cursor={{ stroke: "#cbbda8", strokeDasharray: "4 4" }}
                          />
                          <Line dataKey="mine" stroke="#214f3b" strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fffdf8" }} type="monotone" />
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
                      </div>
                    </div>
                    <div className="allocation-list">
                      {investmentAllocationView.map((item) => (
                        <div className="allocation-item" key={item.name}>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{formatMoney(item.value)} · {item.percent}%</span>
                          </div>
                          <div className="progress-track">
                            <span style={{ width: `${item.percent}%`, background: item.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="risk-note">{investmentAllocationView.length ? "配置数据已根据持仓自动汇总。" : "暂无持仓数据，请先添加持仓。"}</div>
                  </article>

                  <article className="panel holdings-table-panel">
                    {investmentHoldingsView.some((item) => item.included_in_totals === 0) && <p className="workflow-note">
                      未关联账户的旧持仓保留在下方，暂不计入资产与投资汇总。请通过“编辑”关联投资账户。
                    </p>}
                    <div className="panel-title">
                      <div>
                        <h3>持仓明细</h3>
                        <p>已有持仓只录入现状，买卖交易会联动现金可投</p>
                      </div>
                      <div className="panel-actions">
                        <div className="segmented">
                          {["全部", "基金", "股票"].map((filter) => (
                            <button type="button" className={holdingFilter === filter ? "active" : ""} key={filter} onClick={() => setHoldingFilter(filter)}>{filter}</button>
                          ))}
                        </div>
                        <button type="button" className="filter-button" onClick={() => openAction("holding")}>录入已有持仓</button>
                        <button type="button" className="filter-button primary" onClick={() => openAction("new_trade")}>买入新标的</button>
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
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.code}</span>
                          </div>
                          <span>{item.account_name}</span>
                          <span>{item.cost}</span>
                          <span>{item.price}</span>
                          <span>{formatMoney(item.value)}</span>
                          <span className={item.profit >= 0 ? "positive" : "negative"}>
                            {item.profit >= 0 ? "+" : "-"}{formatMoney(Math.abs(item.profit))}
                          </span>
                          <span className={item.returnRate >= 0 ? "positive" : "negative"}>
                            {item.returnRate >= 0 ? "+" : ""}{item.returnRate.toFixed(1)}%
                          </span>
                          <span className="ratio-pill">{item.percent}%</span>
                          <div className="row-actions">
                            <button type="button" className="edit-button subtle" disabled={!item.account_id} title={!item.account_id ? "请先编辑并关联投资账户" : "记录买入"} onClick={() => openTradeAction(item, "buy")}>买入</button>
                            <button type="button" className="edit-button subtle" disabled={!item.account_id} title={!item.account_id ? "请先编辑并关联投资账户" : "记录卖出"} onClick={() => openTradeAction(item, "sell")}>卖出</button>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("holding", item)}>编辑</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className="panel holdings-table-panel" ref={historyRef}>
                    <div className="panel-title">
                      <div>
                        <h3>买卖记录</h3>
                        <p>共 {trades.length} 笔 · 有效交易联动现金；更正时先撤销，再重新录入</p>
                      </div>
                      <select className="filter-button" aria-label="交易记录账户" value={tradeAccountFilter} onChange={(event) => setTradeAccountFilter(event.target.value)}>
                        <option value="all">全部投资账户</option>
                        {(accountsData.accounts || []).filter((account) => account.type === "investment").map((account) => (
                          <option key={account.id} value={account.id}>{account.owner} · {account.name}</option>
                        ))}
                      </select>
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
                            disabled={latestIds.get(trade.holding_id) !== trade.id || trade.quantity_before == null}
                            title={trade.quantity_before == null ? "旧记录缺少交易前快照，不能直接撤销" : latestIds.get(trade.holding_id) !== trade.id ? "请先撤销后续录入的交易" : "撤销后可重新录入"}
                            onClick={() => setReversalTarget({ type: "trade", item: trade })}>撤销</button>}
                        </div>
                      ))}
                      {!trades.length && <div className="empty-state">暂无买卖记录，已有持仓录入不会出现在这里。</div>}
                    </div>
                  </article>
                </section>
              </>
  );
}
