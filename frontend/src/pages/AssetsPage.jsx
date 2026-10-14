import AccountsPage from "./AccountsPage";
import InvestmentPage from "./InvestmentPage";
import SegmentedTabs from "../components/SegmentedTabs";

const assetTabs = [
  { value: "accounts", label: "账户与负债" },
  { value: "investments", label: "投资持仓" },
];

export default function AssetsPage({ view }) {
  const { assetSection, setAssetSection, openAction, handleRefresh, isRefreshing } = view;

  return (
    <>
      <div className="section-toolbar">
        <SegmentedTabs
          ariaLabel="资产视图"
          idPrefix="assets"
          onChange={setAssetSection}
          options={assetTabs}
          value={assetSection}
        />
        <div className="panel-actions" role="group" aria-label="账户操作">
          {assetSection === "accounts" ? (
            <>
              <button type="button" className="filter-button primary" onClick={() => openAction("account")}>新增账户</button>
              <button type="button" className="filter-button" onClick={() => openAction("transfer")}>资金划转</button>
            </>
          ) : (
            <button type="button" className="filter-button" disabled={isRefreshing} onClick={() => handleRefresh()}>
              {isRefreshing ? "刷新中" : "刷新行情"}
            </button>
          )}
        </div>
      </div>
      <div
        id={`assets-panel-${assetSection}`}
        role="tabpanel"
        aria-labelledby={`assets-tab-${assetSection}`}
      >
        {assetSection === "accounts" ? <AccountsPage view={view} /> : <InvestmentPage view={view} />}
      </div>
    </>
  );
}
