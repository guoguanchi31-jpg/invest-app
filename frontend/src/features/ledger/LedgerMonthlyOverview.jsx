import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, ChartNoAxesCombined, ReceiptText } from "lucide-react";
import MetricValue from "../../components/MetricValue";
import useLedgerMonthlyOverview from "./useLedgerMonthlyOverview";

const modeLabels = {
  expense: "支出",
  income: "收入",
};

function monthLabel(month) {
  const [year, monthNumber] = String(month || "").split("-");
  return year && monthNumber ? `${year}年${Number(monthNumber)}月` : "本月";
}

function dayLabel(date) {
  if (!date) return "";
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

function chartDayLabel(date, index, rows) {
  const day = Number(date?.slice(8, 10));
  return day === 1 || day % 5 === 0 || index === rows.length - 1 ? String(day) : "";
}

export default function LedgerMonthlyOverview({
  accountId,
  accountOptions,
  dataRevision,
  dataScope,
  formatMoney,
  identityKey,
  mode,
  month,
  onAccountChange,
  onCategoryOpen,
  onModeChange,
  onOwnerChange,
  owner,
  ownerOptions,
}) {
  const overview = useLedgerMonthlyOverview({
    accountId,
    dataRevision,
    dataScope,
    enabled: true,
    identityKey,
    month,
    owner,
  });
  const data = overview.data;
  const direction = data.directions?.[mode] || {};
  const categories = direction.categories || [];
  const daily = direction.daily || [];
  const summary = data.summary || {};
  const modeLabel = modeLabels[mode];
  const highestDay = direction.highest_day;
  const largestAmount = Math.max(...categories.map((item) => Number(item.amount || 0)), 0);
  const cashflowMax = Math.max(
    Number(summary.income || 0),
    Number(summary.expense || 0),
    1,
  );
  const visibleAccounts = accountOptions.filter(
    (account) => owner === "all" || account.owner === owner,
  );

  return (
    <div className="ledger-overview" aria-label={`${monthLabel(month)}月度收支概览`}>
      <div className="ledger-overview-toolbar">
        <div>
          <span className="panel-kicker">月度收支概览</span>
          <h2>{monthLabel(month)}</h2>
        </div>
        <div className="ledger-overview-controls">
          <div className="segmented ledger-overview-mode" role="group" aria-label="概览类型">
            {Object.entries(modeLabels).map(([value, label]) => (
              <button
                type="button"
                className={mode === value ? "active" : ""}
                aria-pressed={mode === value}
                key={value}
                onClick={() => onModeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="filter-field">
            <span>用户</span>
            <select
              aria-label="概览用户"
              value={owner}
              onChange={(event) => onOwnerChange(event.target.value)}
            >
              <option value="all">全部用户</option>
              {ownerOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>账户</span>
            <select
              aria-label="概览账户"
              value={accountId}
              onChange={(event) => onAccountChange(event.target.value)}
            >
              <option value="all">全部账户</option>
              {visibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.owner} · {account.name}{account.archived ? "（已归档）" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {overview.error ? (
        <div className="empty-state" role="alert">
          <p>月度概览加载失败：{overview.error}</p>
          <button type="button" className="filter-button" onClick={() => overview.refresh()}>
            重新加载概览
          </button>
        </div>
      ) : overview.loading ? (
        <div className="empty-state" role="status">正在汇总月度收支...</div>
      ) : (
        <>
          <article className="panel ledger-overview-balance">
            <div className="ledger-overview-balance-head">
              <div>
                <span>本月结余</span>
                <MetricValue className={summary.balance < 0 ? "negative" : "positive"}>
                  {formatMoney(summary.balance || 0)}
                </MetricValue>
              </div>
              <p>
                上月结余
                <b className={summary.previous_balance < 0 ? "negative" : "positive"}>
                  {formatMoney(summary.previous_balance || 0)}
                </b>
              </p>
            </div>
            <div className="ledger-overview-cashflow">
              {["expense", "income"].map((directionKey) => (
                <div key={directionKey}>
                  <span>本月{modeLabels[directionKey]}</span>
                  <i>
                    <em
                      className={directionKey}
                      style={{
                        width: `${Number(summary[directionKey] || 0) / cashflowMax * 100}%`,
                      }}
                    />
                  </i>
                  <b>{formatMoney(summary[directionKey] || 0)}</b>
                </div>
              ))}
            </div>
          </article>

          <div className="ledger-overview-grid">
            <article className="panel ledger-overview-trend">
              <div className="panel-title">
                <div>
                  <span className="panel-kicker">{modeLabel}节奏</span>
                  <h3>{modeLabel}趋势</h3>
                </div>
                <ChartNoAxesCombined size={20} aria-hidden="true" />
              </div>
              <div className="ledger-overview-stat-grid">
                <div>
                  <span>单日最高{modeLabel}</span>
                  <strong>{highestDay ? dayLabel(highestDay.date) : "暂无记录"}</strong>
                  <small>{highestDay ? formatMoney(highestDay.amount) : "本月无数据"}</small>
                </div>
                <div>
                  <span>日均{modeLabel}</span>
                  <strong>{formatMoney(direction.daily_average || 0)}</strong>
                  <small>按整月自然日计算</small>
                </div>
                <div>
                  <span>{modeLabel}笔数</span>
                  <strong>{direction.count || 0} 笔</strong>
                  <small>仅含有效收支流水</small>
                </div>
              </div>
              {Number(direction.total || 0) > 0 ? (
                <div className="ledger-overview-line" aria-label={`每日${modeLabel}趋势图`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={daily} margin={{ top: 18, right: 10, bottom: 0, left: 10 }}>
                      <XAxis
                        axisLine={false}
                        dataKey="date"
                        interval={0}
                        tickFormatter={(value, index) => chartDayLabel(value, index, daily)}
                        tickLine={false}
                      />
                      <YAxis hide domain={[0, "auto"]} />
                      <Tooltip
                        formatter={(value) => [formatMoney(value), modeLabel]}
                        labelFormatter={dayLabel}
                      />
                      <Line
                        activeDot={{ r: 5 }}
                        dataKey="amount"
                        dot={false}
                        isAnimationActive={false}
                        stroke={mode === "expense" ? "#c45d52" : "#2f704d"}
                        strokeWidth={2.5}
                        type="monotone"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state">本月暂无{modeLabel}趋势。</div>
              )}
            </article>

            <article className="panel ledger-overview-share">
              <div className="panel-title">
                <div>
                  <span className="panel-kicker">分类结构</span>
                  <h3>{modeLabel}占比</h3>
                </div>
                <ReceiptText size={20} aria-hidden="true" />
              </div>
              {categories.length ? (
                <div className="ledger-overview-share-content">
                  <div className="ledger-overview-donut" aria-label={`${modeLabel}分类占比图`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categories}
                          dataKey="amount"
                          innerRadius="58%"
                          isAnimationActive={false}
                          nameKey="name"
                          outerRadius="88%"
                          paddingAngle={1}
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {categories.map((item) => (
                            <Cell key={`${item.category_id ?? "none"}-${item.name}`} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value, name) => [formatMoney(value), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div>
                      <strong>{formatMoney(direction.total || 0)}</strong>
                      <span>{modeLabel}合计</span>
                    </div>
                  </div>
                  <div className="ledger-overview-legend">
                    {categories.slice(0, 6).map((item) => (
                      <div key={`${item.category_id ?? "none"}-${item.name}`}>
                        <i style={{ background: item.color }} />
                        <span>{item.name}</span>
                        <b>{item.percent}%</b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-state">本月暂无可分析的{modeLabel}分类。</div>
              )}
            </article>
          </div>

          <article className="panel ledger-overview-ranking">
            <div className="panel-title">
              <div>
                <span className="panel-kicker">金额与频次</span>
                <h3>{modeLabel}类目排行</h3>
              </div>
              <CalendarDays size={20} aria-hidden="true" />
            </div>
            <div className="ledger-overview-ranking-list">
              {categories.map((item, index) => (
                <button
                  type="button"
                  aria-label={
                    item.category_id
                      ? `查看${item.name}${modeLabel}流水：${formatMoney(item.amount)}，${item.count}笔`
                      : `${item.name}${modeLabel}：${formatMoney(item.amount)}，${item.count}笔`
                  }
                  disabled={!item.category_id}
                  key={`${item.category_id ?? "none"}-${item.name}`}
                  onClick={() => onCategoryOpen(item.category_id)}
                >
                  <span className="ledger-overview-rank">{index + 1}</span>
                  <span className="ledger-overview-category-icon" aria-hidden="true">
                    {item.icon || "·"}
                  </span>
                  <span className="ledger-overview-category-main">
                    <strong>{item.name}</strong>
                    <i>
                      <em
                        style={{
                          background: item.color,
                          width: `${largestAmount ? Number(item.amount) / largestAmount * 100 : 0}%`,
                        }}
                      />
                    </i>
                    <small>{item.percent}% · {item.count} 笔</small>
                  </span>
                  <b>{formatMoney(item.amount)}</b>
                </button>
              ))}
              {!categories.length ? (
                <div className="empty-state">本月暂无{modeLabel}分类排行。</div>
              ) : null}
            </div>
          </article>
        </>
      )}
    </div>
  );
}
