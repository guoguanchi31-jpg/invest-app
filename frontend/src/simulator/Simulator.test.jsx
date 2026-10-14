// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Simulator from "./Simulator";
import {
  DEVICE_PRESETS,
  fitDeviceScale,
  orientedDimensions,
} from "./devices";

afterEach(cleanup);

describe("App simulator", () => {
  it("derives portrait, landscape and fit dimensions", () => {
    const phone = DEVICE_PRESETS[0];

    expect(orientedDimensions(phone, "portrait")).toEqual({ width: 393, height: 852 });
    expect(orientedDimensions(phone, "landscape")).toEqual({ width: 852, height: 393 });
    expect(fitDeviceScale({ width: 500, height: 900 }, phone)).toBeCloseTo(0.968);
    expect(fitDeviceScale({ width: 300, height: 500 }, phone)).toBeGreaterThanOrEqual(0.32);
    expect(fitDeviceScale({ width: 300, height: 500 }, phone)).toBeLessThan(1);
  });

  it("switches devices and rotates the interactive preview", () => {
    render(<Simulator />);

    expect(screen.getByText("393 × 852")).toBeTruthy();
    expect(screen.getByTitle("iPhone 15 Pro App 预览").getAttribute("src")).toBe(
      "/?appPreview=1",
    );

    fireEvent.click(screen.getByRole("button", { name: "横屏" }));
    expect(screen.getByText("852 × 393")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("预览设备"), {
      target: { value: "ipad-mini" },
    });
    expect(screen.getByText("1133 × 744")).toBeTruthy();
    expect(screen.getByTitle("iPad mini App 预览")).toBeTruthy();
  });

  it("refreshes the embedded App without navigating the simulator", () => {
    render(<Simulator />);
    const originalFrame = screen.getByTitle("iPhone 15 Pro App 预览");

    fireEvent.load(originalFrame);
    expect(screen.queryByText("正在载入")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新 App" }));

    expect(screen.getByText("正在载入")).toBeTruthy();
    expect(screen.getByTitle("iPhone 15 Pro App 预览")).not.toBe(originalFrame);
  });
});
