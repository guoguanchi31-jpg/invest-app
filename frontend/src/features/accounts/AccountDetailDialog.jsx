import AuditDetails from "../../components/AuditDetails";
import ModalBackdrop from "../../components/ModalBackdrop";
import ModalPanel from "../../components/ModalPanel";


export default function AccountDetailDialog({
  accountDetail,
  accounts,
  accountTypeLabels,
  closeAccountDetail,
  formatCurrencyAmount,
  formatDateLabel,
  formatExchangeRate,
  formatMoney,
  handleRestoreAccount,
  normalizeOwner,
  onAdjust,
  onEdit,
  onOpenLedger,
  onOpenTrades,
  onRepay,
  onReconcile,
  restoringAccountId,
}) {
  if (!accountDetail) return null;
  const {
    account,
    transactions = [],
    holdings = [],
    trades = [],
    activity = [],
  } = accountDetail;
  const currency = (account.currency || "CNY").trim().toUpperCase();
  const isForeign = currency !== "CNY";
  const balanceLabel = account.type === "investment"
    ? "账户总额（人民币）"
    : account.is_liability
      ? isForeign ? "当前待还（人民币折算）" : "当前待还"
      : isForeign ? "当前余额（人民币折算）" : "当前余额";
  return (
    <ModalBackdrop onClose={closeAccountDetail}>
      <ModalPanel
        className="detail-modal"
        eyebrow={`${normalizeOwner(account.owner)} · ${accountTypeLabels[account.type] || "账户"}`}
        onClose={closeAccountDetail}
        title={account.name}
      >
        <div className="account-detail-balance">
          <span>{balanceLabel}</span>
          <strong>{formatMoney(account.balance)}</strong>
          {account.type === "investment" ? (
            <>
              <small>
                持仓 {formatMoney(account.holdings_value || 0)}
                {" · "}
                现金可投（人民币）{formatMoney(account.cash_available || 0)}
              </small>
              {isForeign ? (
                <small>
                  现金可投原币 {formatCurrencyAmount(account.cash_available_original || 0, currency)}
                  {" · "}
                  1 {currency} = {formatExchangeRate(account.exchange_rate_to_base || 1)}
                </small>
              ) : null}
            </>
          ) : isForeign ? (
            <small>
              原币余额 {formatCurrencyAmount(account.original_balance ?? 0, currency)}
              {" · "}
              1 {currency} = {formatExchangeRate(account.exchange_rate_to_base || 1)}
            </small>
          ) : null}
        </div>
        {!account.is_active ? (
          <div className="archived-account-notice">
            <div>
              <strong>账户已归档</strong>
              <span>归档期间仅可查看历史；恢复后才能更正流水或余额。</span>
            </div>
            {account.can_restore ? (
              <button
                type="button"
                className="filter-button primary"
                disabled={restoringAccountId !== null}
                onClick={() => handleRestoreAccount(account)}
              >
                {restoringAccountId === account.id ? "恢复中" : "恢复账户"}
              </button>
            ) : null}
          </div>
        ) : null}
        {onReconcile && (
          <button type="button" className="filter-button" onClick={() => onReconcile(account.id)}>
            查看账本诊断
          </button>
        )}
        {account.can_edit !== false ? (
          <div className="account-detail-actions">
            <button type="button" className="filter-button primary" onClick={() => onAdjust(account)}>
              余额核对
            </button>
            {account.is_liability ? (
              <button type="button" className="filter-button" onClick={() => onRepay(account)}>
                还款
              </button>
            ) : null}
            <button type="button" className="filter-button" onClick={() => onEdit(account)}>
              编辑资料
            </button>
          </div>
        ) : null}
        {holdings.length > 0 ? (
          <div className="detail-section">
            <h3>关联持仓</h3>
            {holdings.map((holding) => (
              <div className="detail-list-row" key={holding.id}>
                <span>{holding.name} · {holding.code}</span>
                <b>{holding.quantity}</b>
              </div>
            ))}
          </div>
        ) : null}
        <div className="detail-section">
          <div className="panel-title">
            <h3>账户流水</h3>
            <button type="button" className="edit-button subtle" onClick={() => onOpenLedger(account)}>
              查看全部
            </button>
          </div>
          {transactions.slice(0, 12).map((item) => (
            <div className="detail-list-row" key={item.id}>
              <div>
                <strong>
                  {item.voided_at ? "已撤销 · " : ""}
                  {item.merchant
                    || item.category_name
                    || (item.source === "opening"
                      ? "期初余额"
                      : item.source === "adjustment"
                        ? "余额核对"
                        : "资金划转")}
                </strong>
                <span>
                  {formatDateLabel(item.occurred_at)}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
              </div>
              <b className={item.direction === "income" ? "positive" : "negative"}>
                {item.direction === "income" ? "+" : "-"}
                {formatMoney(item.base_amount ?? item.amount)}
              </b>
            </div>
          ))}
          {!transactions.length ? (
            <div className="empty-state">该账户暂无流水。</div>
          ) : null}
        </div>
        {trades.length > 0 ? (
          <div className="detail-section">
            <div className="panel-title">
              <h3>投资交易</h3>
              <button type="button" className="edit-button subtle" onClick={() => onOpenTrades(account)}>
                查看全部
              </button>
            </div>
            {trades.slice(0, 8).map((trade) => (
              <div className="detail-list-row" key={trade.id}>
                <span>
                  {trade.voided_at ? "已撤销 · " : ""}
                  {trade.trade_type === "buy" ? "买入" : "卖出"}{" "}
                  {trade.holding_name} · {trade.quantity}
                </span>
                <b>{formatMoney(trade.base_amount)}</b>
              </div>
            ))}
          </div>
        ) : null}
        {activity.length > 0 ? (
          <div className="detail-section">
            <h3>最近操作</h3>
            {activity.map((event) => (
              <div className="detail-list-row" key={event.id}>
                <div>
                  <strong>{event.summary}</strong>
                  <span>
                    {event.actor_name} · {new Date(event.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {event.reason ? <span>{event.reason}</span> : null}
                <AuditDetails event={event} accounts={accounts} />
              </div>
            ))}
          </div>
        ) : null}
      </ModalPanel>
    </ModalBackdrop>
  );
}
