export default function AccountsPage({ view }) {
  const {
    formatMoney,
    accountsData,
    assetAccountsView,
    creditAccountsView,
    accountOwnerGroups,
    openEditAction,
    openAccountDetail,
    openRepayment,
    creditReminder,
    accountDistributionView,
  } = view;

  return (
    <>
                <section className="summary-grid account-summary">
                  <article className="metric-card">
                    <span>资产账户合计</span>
                    <strong className="positive">{formatMoney(accountsData?.asset_total ?? 0)}</strong>
                    <p>{assetAccountsView.length} 个资产账户</p>
                  </article>
                  <article className="metric-card">
                    <span>负债账户合计</span>
                    <strong className="negative">{formatMoney(accountsData?.liability_total ?? 0)}</strong>
                    <p>{creditAccountsView.length} 个信用账户</p>
                  </article>
                  <article className="metric-card">
                    <span>净资产</span>
                    <strong>{formatMoney(accountsData?.net_worth ?? 0)}</strong>
                    <p className="positive">根据账户余额自动计算</p>
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
                                if (event.key === "Enter" || event.key === " ") openAccountDetail(account);
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
                        <p>账单与还款</p>
                      </div>
                    </div>
                    <div className="credit-table">
                      <div className="credit-head">
                        <span>信用卡</span>
                        <span>本期账单</span>
                        <span>还款日</span>
                        <span>状态</span>
                        <span>操作</span>
                      </div>
                      {creditAccountsView.map((account) => (
                        <div className="credit-row" key={account.name} onClick={() => openAccountDetail(account)}>
                          <div>
                            <strong>{account.name}</strong>
                            <span>{account.owner} · {account.code}</span>
                          </div>
                          <span className="negative">{formatMoney(account.bill)}</span>
                          <span>{account.due}</span>
                          <span className={`status-pill ${account.statusTone}`}>{account.status}</span>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="edit-button subtle"
                              onClick={(event) => {
                                event.stopPropagation();
                                openRepayment(account);
                              }}
                            >
                              还款
                            </button>
                            <button
                              type="button"
                              className="edit-button subtle"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditAction("account", account);
                              }}
                            >
                              编辑
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="account-alert">{creditReminder}</div>
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
                </section>
              </>
  );
}
