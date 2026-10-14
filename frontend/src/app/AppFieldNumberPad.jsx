import { Check, Delete } from "lucide-react";
import {
  appendFieldNumber,
  backspaceFieldNumber,
  toggleFieldNumberSign,
} from "./fieldNumberInput";

const NUMBER_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0"];

export default function AppFieldNumberPad({
  activeField,
  disabled = false,
  onSubmit,
  onValueChange,
  status = "",
  statusReady = false,
  submitDisabled = false,
  submitLabel = "完成",
  textEditing = false,
  value = "",
}) {
  const hasField = Boolean(activeField?.key);
  const keyDisabled = disabled || !hasField;
  const changeValue = (nextValue) => {
    if (!keyDisabled) onValueChange(nextValue);
  };
  const pressNumber = (key) => {
    changeValue(appendFieldNumber(value, key, {
      decimalScale: activeField?.decimalScale,
      maxLength: activeField?.maxLength,
    }));
  };

  return (
    <div className={`app-field-number-pad${textEditing ? " is-text-editing" : ""}`}>
      <div className="app-field-number-display" aria-live="polite">
        <span>{activeField?.label || "选择要编辑的数值"}</span>
        <strong>
          {activeField?.prefix ? <small>{activeField.prefix}</small> : null}
          {value || "0"}
          {activeField?.suffix ? <small>{activeField.suffix}</small> : null}
        </strong>
      </div>
      {status ? (
        <p className={`app-field-number-status${statusReady ? " is-ready" : ""}`} role="status">
          {status}
        </p>
      ) : null}
      <div className="app-field-number-keypad" aria-label="数值键盘">
        {NUMBER_KEYS.map((key) => (
          <button
            type="button"
            className={`number-key key-${key === "." ? "decimal" : key}`}
            disabled={keyDisabled || (key === "." && activeField?.decimalScale === 0)}
            aria-label={key === "." ? "小数点" : `数字 ${key}`}
            key={key}
            onClick={() => pressNumber(key)}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          className="sign-key"
          disabled={keyDisabled || !activeField?.allowNegative}
          aria-label="切换正负数"
          onClick={() => changeValue(toggleFieldNumberSign(value))}
        >
          ±
        </button>
        <button
          type="button"
          className="clear-key"
          disabled={keyDisabled || value === ""}
          aria-label="清空当前数值"
          onClick={() => changeValue("")}
        >
          C
        </button>
        <button
          type="button"
          className="backspace-key"
          disabled={keyDisabled || value === ""}
          aria-label="删除一位数值"
          onClick={() => changeValue(backspaceFieldNumber(value))}
        >
          <Delete size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="submit-key"
          disabled={disabled || submitDisabled}
          onClick={() => onSubmit(value)}
        >
          <Check size={20} aria-hidden="true" />
          {disabled ? "保存中" : submitLabel}
        </button>
      </div>
    </div>
  );
}
