import AccountsPage from "./AccountsPage";
import InvestmentPage from "./InvestmentPage";

export default function AssetsPage({ view }) {
  const { assetSection, setAssetSection, openAction, handleRefresh, isRefreshing } = view;

  return (
    <>
      <div className="section-toolbar">
        <div className="section-tabs" role="tablist" aria-label="资产视图">
          <button type="button" className={assetSection === "accounts" ? "active" : ""} onClick={() => setAssetSection("accounts")}>
            账户与负债
          </button>
          <button type="button" className={assetSection === "investments" ? "active" : ""} onClick={() => setAssetSection("investments")}>
            投资持仓
          </button>
        </div>
        <div className="panel-actions">
          {assetSection === "accounts" ? (
            <>
              <button type="button" className="filter-button" onClick={() => openAction("transfer")}>资金划转</button>
              <button type="button" className="filter-button primary" onClick={() => openAction("account")}>新增账户</button>
            </>
          ) : (
            <button type="button" className="filter-button" disabled={isRefreshing} onClick={() => handleRefresh()}>
              {isRefreshing ? "刷新中" : "刷新行情"}
            </button>
          )}
        </div>
      </div>
      {assetSection === "accounts" ? <AccountsPage view={view} /> : <InvestmentPage view={view} />}
    </>
  );
}
