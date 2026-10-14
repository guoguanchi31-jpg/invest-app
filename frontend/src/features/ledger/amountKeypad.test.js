import { describe, expect, it } from "vitest";
import {
  appendAmountKey,
  applyAmountOperator,
  backspaceAmount,
  EMPTY_AMOUNT_CALCULATOR,
  resolveAmount,
} from "./amountKeypad";

describe("App transaction amount keypad", () => {
  it("enters a stable two-decimal amount without leading zeroes", () => {
    let amount = "";
    for (const key of ["0", "8", ".", "6", "5", "9"]) {
      amount = appendAmountKey(amount, key);
    }
    expect(amount).toBe("8.65");
  });

  it("calculates chained additions and subtractions without negative money", () => {
    let amount = "100";
    let calculator = EMPTY_AMOUNT_CALCULATOR;

    ({ amount, calculator } = applyAmountOperator(calculator, amount, "-"));
    amount = appendAmountKey(amount, "2", calculator.replaceEntry);
    calculator = { ...calculator, replaceEntry: false };
    amount = appendAmountKey(amount, "0", calculator.replaceEntry);
    ({ amount, calculator } = applyAmountOperator(calculator, amount, "+"));

    expect(amount).toBe("80");
    amount = appendAmountKey(amount, "5", calculator.replaceEntry);
    calculator = { ...calculator, replaceEntry: false };
    expect(resolveAmount(calculator, amount)).toBe("85");

    expect(resolveAmount({ base: 5, operator: "-", replaceEntry: false }, "20"))
      .toBe("0");
  });

  it("uses backspace to cancel a pending operation before deleting digits", () => {
    const pending = { base: 38, operator: "+", replaceEntry: true };
    const cancelled = backspaceAmount("38", pending);
    expect(cancelled).toEqual({
      amount: "38",
      calculator: EMPTY_AMOUNT_CALCULATOR,
    });
    expect(backspaceAmount("38", EMPTY_AMOUNT_CALCULATOR).amount).toBe("3");
  });
});
