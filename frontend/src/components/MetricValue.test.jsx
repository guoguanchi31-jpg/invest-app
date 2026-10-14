// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitMetricValue } from "./metricValueFit";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockMetricWidth(element, { available, preferred, required }) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: available,
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    get: () => {
      const renderedSize = Number.parseFloat(element.style.fontSize) || preferred;
      return required * (renderedSize / preferred);
    },
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    fontSize: `${preferred}px`,
    getPropertyValue: (name) => name === "--metric-value-min-font-size" ? "15px" : "",
  });
}

describe("fitMetricValue", () => {
  it("keeps the preferred size when the value already fits", () => {
    const element = document.createElement("strong");
    mockMetricWidth(element, { available: 160, preferred: 21, required: 140 });

    fitMetricValue(element);

    expect(element.style.fontSize).toBe("");
    expect(element.hasAttribute("data-fitted")).toBe(false);
  });

  it("shrinks a long value to the available width without dropping below the readable minimum", () => {
    const element = document.createElement("strong");
    mockMetricWidth(element, { available: 150, preferred: 21, required: 190 });

    fitMetricValue(element);

    expect(Number.parseFloat(element.style.fontSize)).toBeCloseTo(16.47, 1);
    expect(element.getAttribute("data-fitted")).toBe("true");
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
  });

  it("honors the minimum font size for exceptionally long values", () => {
    const element = document.createElement("strong");
    mockMetricWidth(element, { available: 100, preferred: 21, required: 220 });

    fitMetricValue(element);

    expect(Number.parseFloat(element.style.fontSize)).toBe(15);
  });
});
