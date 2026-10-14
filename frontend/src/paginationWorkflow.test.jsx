// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchJson } from "./api";
import usePaginatedResource from "./usePaginatedResource";
import LedgerPage from "./pages/LedgerPage";
import InvestmentPage from "./pages/InvestmentPage";

vi.mock("./api", () => ({
  fetchJson: vi.fn(),
  isStaleRequestError: (error) => error?.stale === true,
}));
const ALIASES = { accountId: "account_id" };
const baseView = {
  accountOwnerOptions: [], accountsData: { accounts: [] }, categoriesData: [],
  incomeData: {}, expenseData: {}, formatMoney: String, formatDateLabel: String,
  monthlyIncome: 0, monthlyExpense: 0, selectedMonth: "2026-09",
  investmentTotalValue: 0, investmentProfit: 0, investmentProfitRate: 0,
  investmentHoldingsView: [], investmentCashAvailable: 0, investmentCashAccountsView: [],
  investmentTrendView: [], investmentAllocationView: [], filteredInvestmentHoldingsView: [],
  chartRangeOptions: { trend: [] }, ChartRangeSwitch: () => null,
};

function PaginatedPage({ identityKey = "session-1:family", kind, revision = 0 }) {
  const [accountFilter, setAccountFilter] = useState("all");
  const resource = usePaginatedResource({
    endpoint: kind === "ledger" ? "/ledger" : "/investments/trades",
    pageSize: kind === "ledger" ? 30 : 50,
    dataScope: "family", identityKey,
    withSummary: kind === "ledger", filterAliases: ALIASES,
  });
  const view = { ...baseView, dataRevision: revision };
  return kind === "ledger" ? <LedgerPage view={{
    ...view, ledgerData: resource.items, ledgerMeta: resource.meta, ledgerRequest: resource.request,
    loadLedgerPage: resource.loadPage, ledgerAccountFilter: accountFilter, setLedgerAccountFilter: setAccountFilter,
  }} /> : <InvestmentPage view={{
    ...view, investmentTrades: resource.items, investmentTradesMeta: resource.meta,
    investmentTradesRequest: resource.request, loadInvestmentTradesPage: resource.loadPage,
    tradeAccountFilter: accountFilter, setTradeAccountFilter: setAccountFilter,
  }} />;
}

function ResourceProbe({ owner = "all", revision = 0 }) {
  const resource = usePaginatedResource({
    endpoint: "/ledger",
    pageSize: 30,
    dataScope: "family",
    identityKey: "session-1:family",
    withSummary: true,
  });
  const { items, loadPage, meta, request } = resource;
  useEffect(() => {
    loadPage({ page: 1, owner });
  }, [loadPage, owner, revision]);
  return (
    <>
      <span data-testid="probe-total">{meta.total}</span>
      <span data-testid="probe-summary">{meta.summary?.expense ?? "none"}</span>
      <span data-testid="probe-item">{items[0]?.merchant || "none"}</span>
      <span data-testid="probe-error">{request.error || "none"}</span>
    </>
  );
}

function pageResult(page, pageSize, total = pageSize + 1) {
  return {
    page, page_size: pageSize, total,
    summary: { income: 0, expense: total * 10, other: 0, voided: 0 },
    items: total > (page - 1) * pageSize ? [{
      id: page, source: "manual", direction: "expense", trade_type: "buy",
      merchant: `第${page}页记录`, holding_name: `第${page}页记录`, amount: 10, base_amount: 10,
      quantity: 1, price: 10, occurred_at: "2026-09-28", account_id: 1,
    }] : [],
  };
}

it("clears data and metadata together when a new filter fails", async () => {
  fetchJson.mockResolvedValueOnce(pageResult(1, 30, 31))
    .mockRejectedValueOnce(new Error("筛选失败"));
  const { rerender } = render(<ResourceProbe />);
  await waitFor(() => expect(screen.getByTestId("probe-item").textContent).toBe("第1页记录"));
  expect(screen.getByTestId("probe-total").textContent).toBe("31");
  expect(screen.getByTestId("probe-summary").textContent).toBe("310");

  rerender(<ResourceProbe owner="小宝" />);
  await waitFor(() => expect(screen.getByTestId("probe-error").textContent).toBe("筛选失败"));
  expect(screen.getByTestId("probe-item").textContent).toBe("none");
  expect(screen.getByTestId("probe-total").textContent).toBe("0");
  expect(screen.getByTestId("probe-summary").textContent).toBe("none");
});

it("preserves confirmed data when refreshing the same query fails", async () => {
  fetchJson.mockResolvedValueOnce(pageResult(1, 30, 31))
    .mockRejectedValueOnce(new Error("刷新失败"));
  const { rerender } = render(<ResourceProbe />);
  await waitFor(() => expect(screen.getByTestId("probe-item").textContent).toBe("第1页记录"));

  rerender(<ResourceProbe revision={1} />);
  await waitFor(() => expect(screen.getByTestId("probe-error").textContent).toBe("刷新失败"));
  expect(screen.getByTestId("probe-item").textContent).toBe("第1页记录");
  expect(screen.getByTestId("probe-total").textContent).toBe("31");
  expect(screen.getByTestId("probe-summary").textContent).toBe("310");
});

beforeEach(() => {
  localStorage.setItem("investDataScope", "family");
  fetchJson.mockReset();
});
afterEach(cleanup);

for (const kind of ["ledger", "trades"]) {
  const pageSize = kind === "ledger" ? 30 : 50;
  const requestedPages = () => fetchJson.mock.calls.map(([path]) => Number(new URL(path, "http://test").searchParams.get("page")));

  it(`${kind}: next and previous page survive a delayed response without resetting`, async () => {
    let resolveSecond;
    fetchJson.mockImplementation(async (path) => {
      const page = Number(new URL(path, "http://test").searchParams.get("page"));
      if (page === 2) return new Promise((resolve) => { resolveSecond = resolve; });
      return pageResult(1, pageSize);
    });
    render(<PaginatedPage kind={kind} />);
    await screen.findByText(/第1页记录/);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(requestedPages()).toEqual([1, 2]));
    expect(screen.getByRole("button", { name: "下一页" }).disabled).toBe(true);
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeTruthy();
    await act(async () => resolveSecond(pageResult(2, pageSize)));
    await screen.findByText(/第2页记录/);
    expect(requestedPages()).toEqual([1, 2]);
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByText(/第1页记录/);
    expect(requestedPages()).toEqual([1, 2, 1]);
  });

  it(`${kind}: only a successful response can clamp a page after deletion`, async () => {
    let rejectRefresh;
    fetchJson.mockImplementation(async (path) => {
      const page = Number(new URL(path, "http://test").searchParams.get("page"));
      return pageResult(page, pageSize);
    });
    const { rerender } = render(<PaginatedPage kind={kind} />);
    await screen.findByText(/第1页记录/);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText(/第2页记录/);
    fetchJson.mockImplementation(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    rerender(<PaginatedPage kind={kind} revision={1} />);
    await waitFor(() => expect(requestedPages()).toEqual([1, 2, 2]));
    await act(async () => rejectRefresh(new Error("网络断开")));
    expect(requestedPages()).toEqual([1, 2, 2]);
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeTruthy();
    fetchJson.mockImplementation(async (path) => {
      const page = Number(new URL(path, "http://test").searchParams.get("page"));
      return pageResult(page, pageSize, pageSize);
    });
    rerender(<PaginatedPage kind={kind} revision={2} />);
    await screen.findByText(/第1页记录/);
    expect(requestedPages()).toEqual([1, 2, 2, 2, 1]);
  });

  it(`${kind}: ignores an earlier login response when scope is unchanged`, async () => {
    const pending = [];
    fetchJson.mockImplementation((path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }));
    const { rerender } = render(<PaginatedPage kind={kind} identityKey="session-1:family" />);
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender(<PaginatedPage kind={kind} identityKey="session-2:family" />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1].resolve(pageResult(1, pageSize, 1)));
    await screen.findByText(/第1页记录/);
    await act(async () => pending[0].resolve({
      ...pageResult(1, pageSize, 1),
      items: [{ ...pageResult(1, pageSize, 1).items[0], merchant: "旧身份记录", holding_name: "旧身份记录" }],
    }));
    expect(screen.queryByText("旧身份记录")).toBeNull();
  });
}
