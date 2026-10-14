import { ArchiveRestore, ArrowRightLeft, ChevronRight, Pencil } from "lucide-react";
import MetricValue from "../components/MetricValue";

const accountTypeLabels = {
  debit_card: "储蓄卡",
  credit_card: "信用卡",
  investment: "投资账户",
  wallet: "电子钱包",
  deposit: "定期存款",
};

export default function AccountsPage({ view }) {
  const {
    formatMoney,
    accountsData,
    archivedAccountsData = [],
    assetAccountsView,
    creditAccountsView,
    accountOwnerGroups,
    openEditAction,
    openAccountDetail,
    openRepayment,
    accountDistributionView,
  } = view;

  return (
    <>
                <section className="summary-grid summary-grid--three account-summary">
                  <article className="metric-card">
                    <span>资产账户合计 · {assetAccountsView.length} 个</span>
                    <MetricValue className="positive">{formatMoney(accountsData?.asset_total ?? 0)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>负债账户合计 · {creditAccountsView.length} 个</span>
                    <MetricValue className="negative">{formatMoney(accountsData?.liability_total ?? 0)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>净资产</span>
                    <MetricValue>{formatMoney(accountsData?.net_worth ?? 0)}</MetricValue>
                  </article>
                </section>

                <section className="account-page">
                  <div className="account-section-title">资产账户</div>
                  {accountOwnerGroups.length ? (
                    accountOwnerGroups.map((group) => (
                      <section className="account-owner-group" key={group.owner}>
                        <div className="account-owner-header">
                          <div>
                            <span>所属人</span>
                            <strong>{group.owner}</strong>
                          </div>
                          <p>{group.accounts.length} 个账户 · 合计 {formatMoney(group.total)}</p>
                        </div>
                        <div className="asset-account-grid">
                          {group.accounts.map((account) => (
                            <article
                              className={`account-card ${account.color}`}
                              key={account.id || account.name}
                              onClick={() => openAccountDetail(account)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openAccountDetail(account);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <div>
                                <span>{account.icon}</span>
                                {account.name}
                              </div>
                              <strong>{formatMoney(account.balance)}</strong>
                              <p>{account.bank}</p>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))
                  ) : (
                    <div className="empty-state account-empty">暂无资产账户，新增后会按所属人分组展示。</div>
                  )}

                  <article className="panel credit-panel">
                    <div className="panel-title">
                      <div>
                        <h3>信用账户</h3>
                        <p>欠款与还款</p>
                      </div>
                    </div>
                    <div className="credit-table">
                      <div className="credit-head">
                        <span>信用卡</span>
                        <span>当前欠款</span>
                        <span>还款日</span>
                        <span>操作</span>
                      </div>
                      {creditAccountsView.map((account) => (
                        <div
                          className="credit-row"
                          key={account.name}
                          role="button"
                          tabIndex={0}
                          onClick={() => openAccountDetail(account)}
                          onKeyDown={(event) => {
                            if (
                              event.target === event.currentTarget
                              && (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              openAccountDetail(account);
                            }
                          }}
                        >
                          <div className="credit-account-main">
                            <strong>{account.name}</strong>
                            <span>{account.owner} · {account.code}</span>
                          </div>
                          <span className="credit-bill negative" data-label="当前欠款">{formatMoney(account.bill)}</span>
                          <span className="credit-due" data-label="还款日">{account.due}</span>
                          {account.can_edit !== false ? <div className="row-actions">
                            <button
                              type="button"
                              className="row-action-button repay"
                              onClick={(event) => {
                                event.stopPropagation();
                                openRepayment(account);
                              }}
                            >
                              <ArrowRightLeft size={15} /> 还款
                            </button>
                            <button
                              type="button"
                              className="row-icon-button"
                              aria-label={`编辑${account.name}`}
                              title="编辑账户"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditAction("account", account);
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                          </div> : <span className="readonly-label">仅查看</span>}
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="panel distribution-panel">
                    <div className="panel-title">
                      <div>
                        <h3>账户余额分布</h3>
                      </div>
                    </div>
                    <div className="account-distribution">
                      {accountDistributionView.map((item) => (
                        <div className="distribution-item" key={item.name}>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{formatMoney(item.value)}</span>
                          </div>
                          <div className="progress-track">
                            <span style={{ width: `${item.percent}%`, background: item.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  {archivedAccountsData.length > 0 && <article className="panel archived-accounts-panel">
                    <div className="panel-title">
                      <div>
                        <h3>已归档账户</h3>
                        <p>查看保留的历史，恢复后可继续更正账目</p>
                      </div>
                      <ArchiveRestore size={19} />
                    </div>
                    <div className="archived-account-list">
                      {archivedAccountsData.map((account) => (
                        <button
                          type="button"
                          className="archived-account-row"
                          key={account.id}
                          onClick={() => openAccountDetail(account)}
                        >
                          <div>
                            <strong>{account.owner} · {account.name}</strong>
                            <span>
                              {accountTypeLabels[account.type] || "账户"}
                              {" · "}{account.transaction_count || 0} 笔流水
                              {account.trade_count ? ` · ${account.trade_count} 笔投资交易` : ""}
                            </span>
                          </div>
                          <span>查看历史 <ChevronRight size={15} /></span>
                        </button>
                      ))}
                    </div>
                  </article>}
                </section>
              </>
  );
}
