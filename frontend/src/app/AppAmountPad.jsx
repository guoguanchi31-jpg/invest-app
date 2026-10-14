import { useState } from "react";
import {
  CalendarDays,
  Check,
  Delete,
  MessageSquareText,
} from "lucide-react";
import {
  appendAmountKey,
  applyAmountOperator,
  backspaceAmount,
  EMPTY_AMOUNT_CALCULATOR,
  resolveAmount,
} from "../features/ledger/amountKeypad";
import { todayInputValue } from "../shared/businessDate";

const KEYPAD_ROWS = [
  ["7", "8", "9", "date"],
  ["4", "5", "6", "+"],
  ["1", "2", "3", "-"],
  [".", "0", "backspace", "submit"],
];

export default function AppAmountPad({
  amount,
  currencySymbol = "¥",
  dateValue,
  disabled = false,
  note = "",
  notePlaceholder = "添加备注",
  onAmountChange,
  onDateToday,
  onNoteChange,
  onSubmit,
  submitDisabled = false,
  submitLabel = "完成",
  textEditing = false,
}) {
  const [calculator, setCalculator] = useState(EMPTY_AMOUNT_CALCULATOR);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const resolvedAmount = resolveAmount(calculator, amount);
  const canSubmit = !submitDisabled && Number(resolvedAmount) > 0;

  const pressNumber = (key) => {
    onAmountChange(appendAmountKey(amount, key, calculator.replaceEntry));
    if (calculator.replaceEntry) {
      setCalculator((current) => ({ ...current, replaceEntry: false }));
    }
  };

  const pressOperator = (operator) => {
    const next = applyAmountOperator(calculator, amount, operator);
    onAmountChange(next.amount);
    setCalculator(next.calculator);
  };

  const pressBackspace = () => {
    const next = backspaceAmount(amount, calculator);
    onAmountChange(next.amount);
    setCalculator(next.calculator);
  };

  const submit = () => {
    if (!canSubmit || disabled) return;
    onAmountChange(resolvedAmount);
    setCalculator(EMPTY_AMOUNT_CALCULATOR);
    onSubmit(resolvedAmount);
  };

  const renderKey = (key) => {
    if (key === "date") {
      const isToday = !dateValue || dateValue === todayInputValue();
      return (
        <button
          type="button"
          className="date-key"
          key={key}
          disabled={disabled}
          aria-label="将日期设为今天"
          title={isToday ? "当前日期：今天" : `当前日期：${dateValue}，点击改为今天`}
          onClick={onDateToday}
        >
          <CalendarDays size={18} aria-hidden="true" />
          <span>今天</span>
        </button>
      );
    }
    if (key === "backspace") {
      return (
        <button
          type="button"
          key={key}
          disabled={disabled}
          aria-label="删除一位金额"
          onClick={pressBackspace}
        >
          <Delete size={23} aria-hidden="true" />
        </button>
      );
    }
    if (key === "submit") {
      return (
        <button
          type="button"
          className="submit-key"
          key={key}
          disabled={!canSubmit || disabled}
          onClick={submit}
        >
          <Check size={20} aria-hidden="true" />
          {disabled ? "保存中" : submitLabel}
        </button>
      );
    }
    if (key === "+" || key === "-") {
      return (
        <button
          type="button"
          className="operator-key"
          key={key}
          disabled={disabled}
          aria-label={key === "+" ? "加" : "减"}
          onClick={() => pressOperator(key)}
        >
          {key}
        </button>
      );
    }
    return (
      <button
        type="button"
        key={key}
        disabled={disabled}
        aria-label={key === "." ? "小数点" : `数字 ${key}`}
        onClick={() => pressNumber(key)}
      >
        {key}
      </button>
    );
  };

  return (
    <div className={`app-transaction-footer${isTextEditing || textEditing ? " is-text-editing" : ""}`}>
      <div className="app-transaction-amount-bar">
        <MessageSquareText size={19} aria-hidden="true" />
        <input
          type="text"
          name="note"
          aria-label="备注"
          autoComplete="off"
          disabled={disabled}
          placeholder={notePlaceholder}
          value={note}
          onBlur={() => setIsTextEditing(false)}
          onChange={onNoteChange}
          onFocus={() => setIsTextEditing(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <div className="app-transaction-amount" aria-live="polite">
          {calculator.operator ? (
            <small>{calculator.base} {calculator.operator}</small>
          ) : null}
          <strong>
            <span>{currencySymbol}</span>
            {amount || "0.00"}
          </strong>
        </div>
      </div>
      <div className="app-transaction-keypad" aria-label="金额键盘">
        {KEYPAD_ROWS.flatMap((row) => row.map(renderKey))}
      </div>
    </div>
  );
}
