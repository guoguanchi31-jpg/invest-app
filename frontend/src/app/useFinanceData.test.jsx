// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchJson } from "../api";
import useFinanceData from "./useFinanceData";

vi.mock("../api", () => ({
  DATA_SCOPE_KEY: "investDataScope",
  fetchJson: vi.fn(),
  isStaleRequestError: (error) => error?.stale === true,
}));

const cashDirtyAccountIdsRef = { current: new Set() };
const cashDraftBaselinesRef = { current: new Map() };
const setCashDrafts = vi.fn();

function hookProps(overrides = {}) {
  return {
    activePage: "dashboard",
    assetSection: "accounts",
    cashDraftBaselinesRef,
    cashDirtyAccountIdsRef,
    dashboardTrendRange: "12m",
    dataScope: "family",
    dataIdentityKey: "1:1:family",
    goalPlanRange: "12m",
    investmentTrendRange: "12m",
    loggedIn: true,
    planSection: "budget",
    selectedMonth: "2026-09",
    setCashDrafts,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("investDataScope", "family");
  cashDraftBaselinesRef.current.clear();
  cashDirtyAccountIdsRef.current.clear();
  setCashDrafts.mockReset();
  fetchJson.mockReset();
});

afterEach(cleanup);

it("clears family data while a personal-scope reload is pending and keeps it empty on failure", async () => {
  fetchJson.mockImplementation(async (path) => {
    if (path.startsWith("/dashboard/summary")) return { net_worth: 3900 };
    if (path === "/accounts/overview") return { accounts: [{ id: 1, balance: 3900 }] };
    if (path.startsWith("/investments/summary")) return { total_value: 3900 };
    if (path.startsWith("/goals")) return { goals: [] };
    if (path === "/categories") return [];
    return {};
  });
  const { result, rerender } = renderHook(
    (props) => useFinanceData(props),
    { initialProps: hookProps() },
  );
  await waitFor(() => expect(result.current.dashboardData.net_worth).toBe(3900));

  const pendingRejects = [];
  fetchJson.mockImplementation(() => new Promise((_, reject) => {
    pendingRejects.push(reject);
  }));
  localStorage.setItem("investDataScope", "personal");
  rerender(hookProps({
    dataScope: "personal",
    dataIdentityKey: "1:1:personal",
  }));

  await waitFor(() => {
    expect(result.current.dataLoading).toBe(true);
    expect(result.current.dashboardData.net_worth).toBe(0);
    expect(result.current.accountsData.accounts).toEqual([]);
  });

  await act(async () => {
    pendingRejects.forEach((reject) => reject(new Error("个人数据加载失败")));
  });
  await waitFor(() => expect(result.current.dataLoading).toBe(false));
  expect(result.current.dashboardData.net_worth).toBe(0);
  expect(result.current.dataLoadError).toContain("个人数据加载失败");
});

it("invalidates loaded data and cash drafts on logout", async () => {
  fetchJson.mockImplementation(async (path) => {
    if (path.startsWith("/dashboard/summary")) return { net_worth: 3900 };
    if (path === "/accounts/overview") return { accounts: [] };
    if (path.startsWith("/investments/summary")) return { total_value: 3900 };
    if (path.startsWith("/goals")) return { goals: [] };
    if (path === "/categories") return [];
    return {};
  });
  const { result, rerender } = renderHook(
    (props) => useFinanceData(props),
    { initialProps: hookProps() },
  );
  await waitFor(() => expect(result.current.dashboardData.net_worth).toBe(3900));

  rerender(hookProps({ dataIdentityKey: "logged-out", loggedIn: false }));

  await waitFor(() => expect(result.current.dashboardData.net_worth).toBe(0));
  expect(result.current.accountsData.accounts).toEqual([]);
  expect(setCashDrafts).toHaveBeenCalledWith({});
});

it("ignores an old login response after logout and a new login in the same scope", async () => {
  const pending = [];
  fetchJson.mockImplementation((path) => new Promise((resolve) => {
    pending.push({ path, resolve });
  }));
  const { result, rerender } = renderHook(
    (props) => useFinanceData(props),
    { initialProps: hookProps({ dataIdentityKey: "session-1:user-1:family" }) },
  );
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));

  rerender(hookProps({
    dataIdentityKey: "session-2:logged-out",
    loggedIn: false,
  }));
  rerender(hookProps({ dataIdentityKey: "session-3:user-2:family" }));

  await waitFor(() => expect(pending.length).toBeGreaterThan(5));
  await act(async () => {
    for (const request of pending.filter((_, index) => index >= 5)) {
      if (request.path.startsWith("/dashboard/summary")) {
        request.resolve({ net_worth: 222 });
      } else if (request.path === "/accounts/overview") {
        request.resolve({ accounts: [] });
      } else if (request.path.startsWith("/investments/summary")) {
        request.resolve({ total_value: 222 });
      } else if (request.path.startsWith("/goals")) {
        request.resolve({ goals: [] });
      } else {
        request.resolve([]);
      }
    }
  });
  await waitFor(() => expect(result.current.dashboardData.net_worth).toBe(222));

  await act(async () => {
    for (const request of pending.slice(0, 5)) {
      request.resolve(
        request.path.startsWith("/dashboard/summary")
          ? { net_worth: 111 }
          : request.path === "/accounts/overview"
            ? { accounts: [{ id: 1, balance: 111 }] }
            : [],
      );
    }
  });
  expect(result.current.dashboardData.net_worth).toBe(222);
});

it("keeps the original cash baseline while a dirty draft survives background refresh", async () => {
  let currentCash = 1000;
  fetchJson.mockImplementation(async (path) => {
    if (path.startsWith("/dashboard/summary")) return { net_worth: currentCash };
    if (path === "/accounts/overview") return { accounts: [] };
    if (path.startsWith("/investments/summary")) {
      return {
        total_value: currentCash,
        cash_accounts: [{
          id: 7,
          cash_available_original: currentCash,
        }],
      };
    }
    if (path.startsWith("/goals")) return { goals: [] };
    if (path === "/categories") return [];
    return {};
  });
  const { result } = renderHook(
    (props) => useFinanceData(props),
    { initialProps: hookProps() },
  );
  await waitFor(() => {
    expect(cashDraftBaselinesRef.current.get(7)).toBe(1000);
  });

  cashDirtyAccountIdsRef.current.add(7);
  currentCash = 200;
  await act(async () => {
    await result.current.loadData();
  });

  expect(cashDraftBaselinesRef.current.get(7)).toBe(1000);
});
