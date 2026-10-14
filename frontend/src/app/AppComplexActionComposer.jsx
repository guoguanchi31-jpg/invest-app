import { useEffect, useMemo, useState } from "react";
import ModalBackdrop from "../components/ModalBackdrop";
import ModalPanel from "../components/ModalPanel";
import { accountCurrency } from "../settlement";
import AppFieldNumberPad from "./AppFieldNumberPad";
import { AppNumberFieldProvider } from "./AppNumberFieldContext";
import { currencySymbol } from "./appAmountPresentation";

function descriptor(key, label, options = {}) {
  return {
    allowNegative: false,
    decimalScale: 2,
    key,
    label,
    maxLength: 16,
    prefix: "",
    suffix: "",
    ...options,
  };
}

function defaultComplexNumberField({
  actionMode,
  editTarget,
  form,
  getAccountById,
}) {
  if (actionMode === "account") {
    if (!editTarget) {
      const label = form.type === "investment"
        ? "当前现金可投"
        : form.type === "credit_card"
          ? "当前待还"
          : "当前余额";
      return descriptor("balance", label, {
        prefix: currencySymbol(form.currency),
      });
    }
    if (form.type === "credit_card") {
      return descriptor("credit_limit", "信用额度", {
        prefix: currencySymbol(form.currency),
      });
    }
    if (String(form.currency || "CNY").toUpperCase() !== "CNY") {
      return descriptor("exchange_rate_to_base", "兑人民币汇率", {
        decimalScale: 6,
      });
    }
    return descriptor("last4", "账户尾号", {
      decimalScale: 0,
      maxLength: 8,
    });
  }
  if (actionMode === "adjustment") {
    const account = getAccountById(form.account_id);
    return descriptor(
      "actual_balance",
      account?.type === "investment" ? "核对后现金可投" : "核对后余额",
      {
        allowNegative: true,
        prefix: currencySymbol(accountCurrency(account)),
      },
    );
  }
  if (actionMode === "holding") {
    return descriptor("buy_price", "买入均价", {
      decimalScale: 6,
      prefix: currencySymbol(form.currency),
    });
  }
  if (["new_trade", "trade"].includes(actionMode)) {
    return descriptor("quantity", "交易数量", {
      decimalScale: 6,
    });
  }
  if (actionMode === "transaction") {
    return descriptor("amount", "流水金额", {
      prefix: currencySymbol(accountCurrency(getAccountById(form.account_id))),
    });
  }
  if (actionMode === "transfer") {
    return descriptor("amount", "付款金额", {
      prefix: currencySymbol(accountCurrency(getAccountById(form.from_account_id))),
    });
  }
  return null;
}

function submitLabel(actionMode, editTarget, form) {
  if (editTarget) return "保存修改";
  if (actionMode === "account") return "创建账户";
  if (actionMode === "adjustment") return "保存核对";
  if (actionMode === "holding") return "保存持仓";
  if (["new_trade", "trade"].includes(actionMode)) {
    return form.trade_type === "sell" ? "确认卖出" : "确认买入";
  }
  return "完成";
}

export default function AppComplexActionComposer({
  Fields,
  actionMode,
  categoriesData,
  dataScope,
  editTarget,
  familyData,
  fieldProps,
  form,
  getAccountById,
  handleChange,
  handleDelete,
  handleSubmitAction,
  isDatePickerOpen,
  isSubmitting,
  onClose,
  title,
}) {
  const primaryField = useMemo(
    () => defaultComplexNumberField({
      actionMode,
      editTarget,
      form,
      getAccountById,
    }),
    [
      actionMode,
      editTarget,
      form,
      getAccountById,
    ],
  );
  const [activeField, setActiveField] = useState(primaryField);
  const [textEditing, setTextEditing] = useState(false);
  const activeValue = activeField ? String(form[activeField.key] ?? "") : "";

  useEffect(() => {
    setActiveField((current) => (
      current?.key === primaryField?.key ? primaryField : current
    ));
  }, [primaryField]);

  const changeField = (name, value) => {
    handleChange({ target: { name, value } });
  };
  const submit = (finalValue) => {
    const formOverride = activeField
      ? { ...form, [activeField.key]: finalValue }
      : form;
    void handleSubmitAction({ formOverride });
  };

  return (
    <ModalBackdrop
      className={[
        "modal-backdrop app-action-layer",
        isDatePickerOpen ? "modal-backdrop-muted" : "",
      ].filter(Boolean).join(" ")}
      closeDisabled={isDatePickerOpen || isSubmitting}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName="app-complex-action-body"
        className="app-action-dialog app-complex-action-dialog"
        closeDisabled={isDatePickerOpen || isSubmitting}
        eyebrow={editTarget ? "编辑数据" : "录入数据"}
        initialFocusSelector=".modal-close"
        footer={(
          <AppFieldNumberPad
            activeField={activeField}
            disabled={isSubmitting}
            onSubmit={submit}
            onValueChange={(value) => changeField(activeField.key, value)}
            submitLabel={submitLabel(actionMode, editTarget, form)}
            textEditing={textEditing}
            value={activeValue}
          />
        )}
        onClose={onClose}
        title={title}
      >
        <AppNumberFieldProvider
          activeField={activeField}
          onActivate={(field) => {
            setActiveField(field);
            setTextEditing(false);
          }}
        >
          <fieldset
            className="quick-add financial-form app-complex-form"
            disabled={isSubmitting}
            onBlurCapture={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof HTMLInputElement) || next.readOnly) {
                setTextEditing(false);
              }
            }}
            onFocusCapture={(event) => {
              const target = event.target;
              setTextEditing(
                target instanceof HTMLInputElement
                && !target.readOnly
                && target.dataset.appNumberField !== "true",
              );
            }}
          >
            <Fields
              {...fieldProps}
              actionMode={actionMode}
              categoriesData={categoriesData}
              dataScope={dataScope}
              editTarget={editTarget}
              familyData={familyData}
              form={form}
              canManageFamily={dataScope === "family" && familyData.can_manage}
            />
          </fieldset>
        </AppNumberFieldProvider>
        {editTarget ? (
          <div className="modal-danger-zone">
            <div>
              <strong>{editTarget.type === "account" ? "归档账户" : "删除当前数据"}</strong>
              <span>{editTarget.type === "account"
                ? "清空余额和持仓后可归档，历史记录保留。"
                : "删除后会同步更新看板、图表和汇总数据。"}</span>
            </div>
            <button
              type="button"
              className="danger-button"
              disabled={isSubmitting}
              onClick={() => handleDelete(editTarget.type, editTarget.id)}
            >
              {editTarget.type === "account" ? "归档" : "删除"}
            </button>
          </div>
        ) : null}
      </ModalPanel>
    </ModalBackdrop>
  );
}
