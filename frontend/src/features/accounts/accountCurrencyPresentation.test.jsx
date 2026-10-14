// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCurrencyAmount,
  formatExchangeRate,
  formatMoney,
} from "../../shared/money";
import AccountActionFields from "./AccountActionFields";
import AccountDetailDialog from "./AccountDetailDialog";

afterEach(cleanup);

describe("foreign account currency presentation", () => {
  const foreignAccount = {
    id: 8,
    name: "美元储蓄",
    owner: "大宝",
    type: "debit_card",
    currency: "USD",
    exchange_rate_to_base: 7.2,
    balance: 7200,
    original_balance: 1000,
    is_active: true,
    can_edit: true,
  };

  it("distinguishes original balance from the base-currency conversion", () => {
    render(
      <AccountDetailDialog
        accountDetail={{ account: foreignAccount }}
        accounts={[foreignAccount]}
        accountTypeLabels={{ debit_card: "储蓄卡" }}
        closeAccountDetail={vi.fn()}
        formatCurrencyAmount={formatCurrencyAmount}
        formatDateLabel={String}
        formatExchangeRate={formatExchangeRate}
        formatMoney={formatMoney}
        handleRestoreAccount={vi.fn()}
        normalizeOwner={String}
        onAdjust={vi.fn()}
        onEdit={vi.fn()}
        onOpenLedger={vi.fn()}
        onOpenTrades={vi.fn()}
        onRepay={vi.fn()}
      />,
    );

    expect(screen.getByText("当前余额（人民币折算）")).toBeTruthy();
    expect(screen.getByText("¥7,200")).toBeTruthy();
    expect(screen.getByText(/原币余额 1,000.00 USD/)).toBeTruthy();
    expect(screen.getByText(/1 USD = ¥7.2/)).toBeTruthy();
  });

  it("labels adjustment input with the account currency", () => {
    render(
      <AccountActionFields
        actionMode="adjustment"
        form={{ account_id: "8", actual_balance: "1000", reason: "" }}
        getAccountById={() => foreignAccount}
        handleChange={vi.fn()}
        renderAllAccountOptions={() => <option value="8">大宝 · 美元储蓄</option>}
        renderDateButton={() => null}
      />,
    );

    expect(screen.getByLabelText(/^核对后余额（USD）/)).toBeTruthy();
    expect(screen.getByText("请输入账户原币余额；系统按账户汇率折算为人民币。")).toBeTruthy();
  });
});
