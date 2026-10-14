import { describe, expect, it } from "vitest";
import {
  displayText,
  joinDisplayText,
  normalizeDisplayText,
} from "./displayContent";

describe("display content quality", () => {
  it("filters empty and sentinel values while preserving valid zeroes", () => {
    expect(normalizeDisplayText(null)).toBe("");
    expect(normalizeDisplayText(" undefined ")).toBe("");
    expect(normalizeDisplayText(Number.NaN)).toBe("");
    expect(normalizeDisplayText(0)).toBe("0");
    expect(normalizeDisplayText(-12)).toBe("-12");
  });

  it("joins only meaningful label segments", () => {
    expect(joinDisplayText(["大宝", null, "投资账户"])).toBe("大宝 · 投资账户");
    expect(joinDisplayText(["", "undefined", "储蓄卡"])).toBe("储蓄卡");
  });

  it("uses a controlled fallback instead of leaking invalid content", () => {
    expect(displayText("null")).toBe("—");
    expect(displayText(" ", "未命名")).toBe("未命名");
  });
});
