// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChartRangeSwitch from "./components/ChartRangeSwitch";
import SegmentedTabs from "./components/SegmentedTabs";
import AccountsPage from "./pages/AccountsPage";

afterEach(cleanup);

function TabsHarness() {
  const [value, setValue] = useState("accounts");
  return (
    <SegmentedTabs
      ariaLabel="资产视图"
      idPrefix="assets"
      onChange={setValue}
      options={[
        { value: "accounts", label: "账户与负债" },
        { value: "investments", label: "投资持仓" },
      ]}
      value={value}
    />
  );
}

describe("keyboard and selection semantics", () => {
  it("supports arrow-key tab navigation with one selected tab stop", () => {
    render(<TabsHarness />);
    const accountsTab = screen.getByRole("tab", { name: "账户与负债" });
    const investmentsTab = screen.getByRole("tab", { name: "投资持仓" });

    expect(accountsTab.getAttribute("aria-selected")).toBe("true");
    expect(investmentsTab.tabIndex).toBe(-1);
    fireEvent.keyDown(accountsTab, { key: "ArrowRight" });
    expect(investmentsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(investmentsTab);
    fireEvent.keyDown(investmentsTab, { key: "Home" });
    expect(accountsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("exposes chart ranges as pressed-state controls", () => {
    const onChange = vi.fn();
    render(
      <ChartRangeSwitch
        options={[
          { value: "12m", label: "近12月" },
          { value: "month", label: "本月" },
        ]}
        value="12m"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("group", { name: "图表时间范围" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "近12月" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });

  it("opens asset and credit details with the Space key without scrolling", () => {
    const openAccountDetail = vi.fn();
    const view = {
      formatMoney: String,
      accountsData: { asset_total: 100, liability_total: 50, net_worth: 50 },
      archivedAccountsData: [],
      assetAccountsView: [{ id: 1 }],
      creditAccountsView: [{
        id: 2,
        name: "信用卡",
        owner: "大宝",
        code: "··· 1234",
        bill: 50,
        due: "25日",
        can_edit: false,
      }],
      accountOwnerGroups: [{
        owner: "大宝",
        total: 100,
        accounts: [{
          id: 1,
          name: "储蓄卡",
          icon: "卡",
          color: "forest",
          balance: 100,
          bank: "储蓄卡",
        }],
      }],
      openEditAction: vi.fn(),
      openAccountDetail,
      openRepayment: vi.fn(),
      accountDistributionView: [],
    };
    const { container } = render(<AccountsPage view={view} />);
    const assetCard = container.querySelector(".account-card");
    const creditRow = container.querySelector(".credit-row");
    const assetEvent = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    const creditEvent = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });

    assetCard.dispatchEvent(assetEvent);
    creditRow.dispatchEvent(creditEvent);
    expect(assetEvent.defaultPrevented).toBe(true);
    expect(creditEvent.defaultPrevented).toBe(true);
    expect(openAccountDetail).toHaveBeenCalledTimes(2);
  });
});
