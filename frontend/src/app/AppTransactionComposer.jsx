import { useMemo, useState } from "react";
import { ChevronDown, WalletCards } from "lucide-react";
import ModalBackdrop from "../components/ModalBackdrop";
import ModalPanel from "../components/ModalPanel";
import FormField from "../components/FormField";
import AppAmountPad from "./AppAmountPad";
import { currencySymbol } from "./appAmountPresentation";
import { todayInputValue } from "../shared/businessDate";
import { accountCurrency } from "../settlement";

function fallbackCategoryIcon(direction) {
  return direction === "income" ? "💰" : "🧾";
}

export default function AppTransactionComposer({
  categoriesData,
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
  const [merchantEditing, setMerchantEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(
    Boolean(form.merchant || form.occurred_at !== todayInputValue()),
  );
  const categories = useMemo(
    () => (categoriesData || []).filter((category) => category.type === form.direction),
    [categoriesData, form.direction],
  );
  const selectedAccount = getAccountById(form.account_id);
  const selectedCategory = categories.find(
    (category) => category.name === form.category_name,
  );

  const changeField = (name, value) => {
    handleChange({ target: { name, value } });
  };

  return (
    <ModalBackdrop
      className={`modal-backdrop app-transaction-layer${isDatePickerOpen ? " modal-backdrop-muted" : ""}`}
      closeDisabled={isDatePickerOpen || isSubmitting}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName="app-transaction-body"
        className="app-transaction-dialog"
        closeDisabled={isDatePickerOpen || isSubmitting}
        eyebrow={selectedAccount
          ? `${form.account_owner} · ${selectedAccount.name}`
          : "快捷记账"}
        footer={(
          <AppAmountPad
            amount={form.amount || ""}
            currencySymbol={currencySymbol(accountCurrency(selectedAccount))}
            dateValue={form.occurred_at}
            disabled={isSubmitting}
            note={form.note || ""}
            onAmountChange={(value) => changeField("amount", value)}
            onDateToday={() => changeField("occurred_at", todayInputValue())}
            onNoteChange={handleChange}
            onSubmit={(finalAmount) => {
              void handleSubmitAction({
                formOverride: { ...form, amount: finalAmount },
              });
            }}
            submitDisabled={!form.account_id}
            textEditing={merchantEditing}
          />
        )}
        onClose={onClose}
        title="记一笔"
      >
        <div className="app-transaction-direction" role="tablist" aria-label="收支类型">
          {[
            { value: "expense", label: "支出" },
            { value: "income", label: "收入" },
          ].map((option) => (
            <button
              type="button"
              role="tab"
              aria-selected={form.direction === option.value}
              className={form.direction === option.value ? "active" : ""}
              disabled={isSubmitting}
              key={option.value}
              onClick={() => changeField("direction", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="app-transaction-account-fields">
          <label>
            <span>用户</span>
            <select
              name="account_owner"
              aria-label="记账用户"
              disabled={isSubmitting}
              value={form.account_owner || ""}
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
                name="account_id"
                aria-label="记账账户"
                disabled={isSubmitting}
                value={form.account_id || ""}
                onChange={handleChange}
              >
                <option value="">选择账户</option>
                {renderAccountOptions(form.account_owner)}
              </select>
            </span>
          </label>
        </div>

        <div className="app-transaction-category-grid" role="group" aria-label="记账分类">
          {categories.map((category) => {
            const selected = selectedCategory?.name === category.name;
            return (
              <button
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                disabled={isSubmitting}
                key={category.id ?? category.name}
                onClick={() => changeField(
                  "category_name",
                  selected ? "" : category.name,
                )}
                style={{ "--category-color": category.color || "#176b4d" }}
              >
                <i aria-hidden="true">
                  {category.icon || fallbackCategoryIcon(form.direction)}
                </i>
                <span>{category.name}</span>
              </button>
            );
          })}
          {!categories.length ? (
            <p>当前没有可用的{form.direction === "income" ? "收入" : "支出"}分类</p>
          ) : null}
        </div>

        <section className={`app-transaction-more${moreOpen ? " is-open" : ""}`}>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span>更多信息</span>
            <ChevronDown size={17} aria-hidden="true" />
          </button>
          {moreOpen ? <div>
            {renderDateButton({ field: "occurred_at", label: "日期" })}
            <FormField label="商户 / 来源">
              <input
                type="text"
                name="merchant"
                autoComplete="off"
                disabled={isSubmitting}
                placeholder="例如：超市 / 公司工资"
                value={form.merchant || ""}
                onBlur={() => setMerchantEditing(false)}
                onChange={handleChange}
                onFocus={() => setMerchantEditing(true)}
              />
            </FormField>
          </div> : null}
        </section>
      </ModalPanel>
    </ModalBackdrop>
  );
}
