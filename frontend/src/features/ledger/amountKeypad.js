export const EMPTY_AMOUNT_CALCULATOR = Object.freeze({
  base: null,
  operator: null,
  replaceEntry: false,
});

const MAX_INTEGER_DIGITS = 9;
const MAX_DECIMAL_DIGITS = 2;

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatAmount(value) {
  const rounded = roundAmount(Math.max(0, value));
  return Number.isFinite(rounded) ? String(rounded) : "";
}

function calculate(base, operand, operator) {
  return operator === "+"
    ? Number(base) + Number(operand)
    : Number(base) - Number(operand);
}

export function appendAmountKey(amount, key, replaceEntry = false) {
  const current = replaceEntry ? "" : String(amount || "");
  if (key === ".") {
    if (current.includes(".")) return current;
    return `${current || "0"}.`;
  }
  if (!/^\d$/.test(key)) return current;
  const [integer = "", decimals] = current.split(".");
  if (decimals !== undefined && decimals.length >= MAX_DECIMAL_DIGITS) return current;
  if (decimals === undefined && integer.replace(/^0+/, "").length >= MAX_INTEGER_DIGITS) {
    return current;
  }
  if (current === "0") return key;
  return `${current}${key}`;
}

export function backspaceAmount(amount, calculator = EMPTY_AMOUNT_CALCULATOR) {
  if (calculator.replaceEntry) {
    return {
      amount: String(amount || ""),
      calculator: EMPTY_AMOUNT_CALCULATOR,
    };
  }
  return {
    amount: String(amount || "").slice(0, -1),
    calculator,
  };
}

export function applyAmountOperator(
  calculator,
  amount,
  nextOperator,
) {
  const current = Number(amount);
  if (!Number.isFinite(current) || current < 0) {
    return { amount: String(amount || ""), calculator };
  }
  if (calculator.operator && !calculator.replaceEntry) {
    const result = calculate(calculator.base, current, calculator.operator);
    const nextAmount = formatAmount(result);
    return {
      amount: nextAmount,
      calculator: {
        base: Number(nextAmount || 0),
        operator: nextOperator,
        replaceEntry: true,
      },
    };
  }
  return {
    amount: String(amount || ""),
    calculator: {
      base: current,
      operator: nextOperator,
      replaceEntry: true,
    },
  };
}

export function resolveAmount(calculator, amount) {
  const current = Number(amount);
  if (!Number.isFinite(current)) return "";
  if (!calculator.operator || calculator.replaceEntry) return formatAmount(current);
  return formatAmount(calculate(calculator.base, current, calculator.operator));
}
