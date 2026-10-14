// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InvestmentCashDialog from "./components/InvestmentCashDialog";

afterEach(cleanup);

it("edits and saves an investment cash account without changing the displayed baseline", () => {
  const onDraftChange = vi.fn();
  const onSave = vi.fn();
  render(
    <InvestmentCashDialog
      accounts={[{
        id: 7,
        name: "证券账户",
        owner: "大宝",
        currency: "CNY",
        cash_available_original: 1000,
        draft: "1100",
      }]}
      formatPrice={(value) => Number(value).toFixed(2)}
      onClose={vi.fn()}
      onDraftChange={onDraftChange}
      onSave={onSave}
      savingAccountId={null}
    />,
  );

  expect(screen.getByText(/当前 CNY 1000.00/)).toBeTruthy();
  const input = screen.getByRole("spinbutton", {
    name: "大宝 · 证券账户现金可投（CNY）",
  });
  fireEvent.change(input, { target: { value: "1200" } });
  expect(onDraftChange).toHaveBeenCalledWith(
    expect.objectContaining({ id: 7 }),
    "1200",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onSave).toHaveBeenCalledWith(7);
});
