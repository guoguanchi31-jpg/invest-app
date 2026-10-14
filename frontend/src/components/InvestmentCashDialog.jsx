import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";

export default function InvestmentCashDialog({
  accounts,
  formatPrice,
  onClose,
  onDraftChange,
  onSave,
  savingAccountId,
}) {
  return (
    <ModalBackdrop
      closeDisabled={savingAccountId !== null}
      onClose={onClose}
    >
      <ModalPanel
        className="cash-editor-card"
        closeDisabled={savingAccountId !== null}
        eyebrow="手动维护"
        onClose={onClose}
        title="股票账户现金可投"
      >
        {accounts.length ? (
          <div className="investment-cash-list">
            {accounts.filter((account) => account.can_edit !== false).map((account) => (
              <div className="investment-cash-row" key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>
                    {account.owner} · 当前 {account.currency || "CNY"}{" "}
                    {formatPrice(account.cash_available_original ?? account.cash_available ?? 0)}
                  </span>
                </div>
                <input
                  type="number"
                  aria-label={`${account.owner} · ${account.name}现金可投（${account.currency || "CNY"}）`}
                  min="0"
                  step="0.01"
                  value={account.draft}
                  disabled={savingAccountId !== null}
                  onChange={(event) => onDraftChange(account, event.target.value)}
                />
                <button
                  type="button"
                  className="edit-button subtle"
                  disabled={savingAccountId !== null}
                  onClick={() => onSave(account.id)}
                >
                  {savingAccountId === account.id ? "保存中" : "保存"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无股票账户，请先到账户管理新增投资账户。</div>
        )}
        <p className="cash-editor-note">保存后会按账户汇率折算，并立即联动总资产与投资账户余额。</p>
      </ModalPanel>
    </ModalBackdrop>
  );
}
