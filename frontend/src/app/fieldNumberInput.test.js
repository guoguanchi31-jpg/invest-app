import { describe, expect, it } from "vitest";
import {
  appendFieldNumber,
  backspaceFieldNumber,
  toggleFieldNumberSign,
} from "./fieldNumberInput";

describe("complex entry number input", () => {
  it("keeps each field's decimal precision and digit limit", () => {
    expect(appendFieldNumber("7.123456", "7", { decimalScale: 6 })).toBe("7.123456");
    expect(appendFieldNumber("7.12345", "6", { decimalScale: 6 })).toBe("7.123456");
    expect(appendFieldNumber("1234", "5", { decimalScale: 0, maxLength: 4 })).toBe("1234");
    expect(appendFieldNumber("", ".", { decimalScale: 2 })).toBe("0.");
  });

  it("supports negative reconciliation values without forcing other fields negative", () => {
    expect(toggleFieldNumberSign("125.5")).toBe("-125.5");
    expect(toggleFieldNumberSign("-125.5")).toBe("125.5");
    expect(toggleFieldNumberSign("")).toBe("-");
    expect(backspaceFieldNumber("-1")).toBe("-");
  });
});
