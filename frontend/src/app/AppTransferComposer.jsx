import { useState } from "react";
import { ArrowDown, ChevronDown, WalletCards } from "lucide-react";
import FormField from "../components/FormField";
import ModalBackdrop from "../components/ModalBackdrop";
import ModalPanel from "../components/ModalPanel";
import {
  accountCurrency,
  originalBalance,
  originalMoney,
} from "../settlement";
import { todayInputValue } from "../shared/businessDate";
import AppAmountPad from "./AppAmountPad";
import { currencySymbol } from "./appAmountPresentation";

export default function AppTransferComposer({
  form,
  getAccountById,
  handleChange,
  handleSubmitAction,
  isDatePickerOpen,
  isSubmitting,
  onClose,
  renderAccountOptions,
  renderAccountOwnerOptions,
  renderDateButton,
}) {
  const [activeAmountField, setActiveAmountField] = useState("amount");
  const [moreOpen, setMoreOpen] = useState(
    Boolean(form.occurred_at !== todayInputValue()),
  );
  const source = getAccountById(form.from_account_id);
  const target = getAccountById(form.to_account_id);
  const sourceCurrency = accountCurrency(source);
  const targetCurrency = accountCurrency(target);
  const sameCurrency = sourceCurrency === targetCurrency;
  const amountField = sameCurrency ? "amount" : activeAmountField;
  const otherAmountReady = amountField === "amount"
    ? sameCurrency || Number(form.to_amount) > 0
    : Number(form.amount) > 0;
  const accountsReady = Boolean(source && target && source.id !== target.id);

  const changeField = (name, value) => {
    handleChange({ target: { name, value } });
  };

  const submit = (finalAmount) => {
    void handleSubmitAction({
      formOverride: {
        ...form,
        [amountField]: finalAmount,
      },
    });
  };

  return (
    <ModalBackdrop
      className={`modal-backdrop app-transaction-layer${isDatePickerOpen ? " modal-backdrop-muted" : ""}`}
      closeDisabled={isDatePickerOpen || isSubmitting}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName="app-transaction-body app-transfer-body"
        className="app-transaction-dialog app-transfer-dialog"
        closeDisabled={isDatePickerOpen || isSubmitting}
        eyebrow={source && target
          ? `${source.name} → ${target.name}`
          : "账户间资金移动"}
        footer={(
          <AppAmountPad
            key={amountField}
            amount={form[amountField] || ""}
            currencySymbol={currencySymbol(
              amountField === "amount" ? sourceCurrency : targetCurrency,
            )}
            dateValue={form.occurred_at}
            disabled={isSubmitting}
            note={form.note || ""}
            notePlaceholder="添加划转备注"
            onAmountChange={(value) => changeField(amountField, value)}
            onDateToday={() => changeField("occurred_at", todayInputValue())}
            onNoteChange={handleChange}
            onSubmit={submit}
            submitDisabled={!accountsReady || !otherAmountReady}
          />
        )}
        onClose={onClose}
        title="资金划转"
      >
        <div className="app-transfer-route">
          <section>
            <strong>转出</strong>
            <div className="app-transaction-account-fields">
              <label>
                <span>用户</span>
                <select
                  name="from_account_owner"
                  aria-label="转出用户"
                  disabled={isSubmitting}
                  value={form.from_account_owner || ""}
                  onChange={handleChange}
                >
                  {renderAccountOwnerOptions()}
                </select>
              </label>
              <label>
                <span>账户</span>
                <span className="app-transaction-account-select">
                  <WalletCards size={17} aria-hidden="true" />
                  <select
                    name="from_account_id"
                    aria-label="转出账户"
                    disabled={isSubmitting}
                    value={form.from_account_id || ""}
                    onChange={handleChange}
                  >
                    <option value="">选择账户</option>
                    {renderAccountOptions(form.from_account_owner)}
                  </select>
                </span>
              </label>
            </div>
          </section>

          <span className="app-transfer-arrow" aria-hidden="true">
            <ArrowDown size={18} />
          </span>

          <section>
            <strong>转入</strong>
            <div className="app-transaction-account-fields">
              <label>
                <span>用户</span>
                <select
                  name="to_account_owner"
                  aria-label="转入用户"
                  disabled={isSubmitting}
                  value={form.to_account_owner || ""}
                  onChange={handleChange}
                >
                  {renderAccountOwnerOptions()}
                </select>
              </label>
              <label>
                <span>账户</span>
                <span className="app-transaction-account-select">
                  <WalletCards size={17} aria-hidden="true" />
                  <select
                    name="to_account_id"
                    aria-label="转入账户"
                    disabled={isSubmitting}
                    value={form.to_account_id || ""}
                    onChange={handleChange}
                  >
                    <option value="">选择账户</option>
                    {renderAccountOptions(form.to_account_owner)}
                  </select>
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className="app-transfer-amount-targets" role="group" aria-label="划转金额">
          <button
            type="button"
            className={amountField === "amount" ? "active" : ""}
            aria-pressed={amountField === "amount"}
            disabled={isSubmitting}
            onClick={() => setActiveAmountField("amount")}
          >
            <span>转出金额</span>
            <strong>{originalMoney(Number(form.amount || 0), sourceCurrency)}</strong>
            {source ? (
              <small>
                转出后 {originalMoney(
                  originalBalance(source)
                    + Number(form.amount || 0) * (source.is_liability ? 1 : -1),
                  sourceCurrency,
                )}
              </small>
            ) : null}
          </button>
          {!sameCurrency ? (
            <button
              type="button"
              className={amountField === "to_amount" ? "active" : ""}
              aria-pressed={amountField === "to_amount"}
              disabled={isSubmitting}
              onClick={() => setActiveAmountField("to_amount")}
            >
              <span>实际到账</span>
              <strong>{originalMoney(Number(form.to_amount || 0), targetCurrency)}</strong>
              {target ? (
                <small>
                  到账后 {originalMoney(
                    originalBalance(target)
                      + Number(form.to_amount || 0) * (target.is_liability ? -1 : 1),
                    targetCurrency,
                  )}
                </small>
              ) : null}
            </button>
          ) : null}
        </div>

        {source && target && source.id === target.id ? (
          <p className="app-quick-entry-error" role="alert">转出和转入账户不能相同</p>
        ) : null}

        <section className={`app-transaction-more${moreOpen ? " is-open" : ""}`}>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span>更多信息</span>
            <ChevronDown size={17} aria-hidden="true" />
          </button>
          {moreOpen ? <div className="single">
            {renderDateButton({ field: "occurred_at", label: "划转日期" })}
            {!sameCurrency && Number(form.amount) > 0 && Number(form.to_amount) > 0 ? (
              <FormField label="本次结算汇率">
                <output>
                  1 {sourceCurrency} = {(Number(form.to_amount) / Number(form.amount)).toFixed(6)} {targetCurrency}
                </output>
              </FormField>
            ) : null}
          </div> : null}
        </section>
      </ModalPanel>
    </ModalBackdrop>
  );
}
