// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchJson } from "../api";
import useSession from "./useSession";
import { configureBusinessTimezone, currentMonthValue } from "../shared/businessDate";

let generation = 0;

vi.mock("../api", () => ({
  AUTH_TOKEN_KEY: "investAuthToken",
  DATA_SCOPE_KEY: "investDataScope",
  DATA_SCOPE_VERSION_KEY: "investDataScopeVersion",
  DATA_SCOPE_STORAGE_VERSION: "2",
  DEFAULT_DATA_SCOPE: "personal",
  apiUrl: (path) => path,
  fetchJson: vi.fn(),
  getRequestGeneration: () => generation,
  invalidateRequestGeneration: () => {
    generation += 1;
    return generation;
  },
  isStaleRequestError: (error) => error?.stale === true,
  normalizeDataScope: (scope) => scope === "family" ? "family" : "personal",
  getStoredDataScope: () => localStorage.getItem("investDataScopeVersion") === "2"
    && localStorage.getItem("investDataScope") === "family" ? "family" : "personal",
  storeDataScope: (scope) => {
    const normalized = scope === "family" ? "family" : "personal";
    localStorage.setItem("investDataScope", normalized);
    localStorage.setItem("investDataScopeVersion", "2");
    return normalized;
  },
  clearStoredDataScope: () => {
    localStorage.removeItem("investDataScope");
    localStorage.removeItem("investDataScopeVersion");
  },
}));

beforeEach(() => {
  generation = 0;
  localStorage.clear();
  localStorage.setItem("investAuthToken", "token");
  localStorage.setItem("investDataScope", "family");
  localStorage.setItem("investDataScopeVersion", "2");
  fetchJson.mockReset();
});

afterEach(() => {
  cleanup();
  configureBusinessTimezone();
  vi.unstubAllGlobals();
});

it("defaults missing scope preferences to personal", async () => {
  localStorage.removeItem("investDataScope");
  fetchJson.mockImplementation(async (path, options) => path === "/auth/session"
    ? {
        user: { id: 1 },
        family: { id: 1 },
        scope: options.scope,
        business_timezone: "Asia/Shanghai",
      }
    : { id: 1, members: [] });
  const { result } = renderHook(() => useSession());
  expect(result.current.dataScope).toBe("personal");
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(
    "/auth/session",
    { scope: "personal" },
  ));
});

it("does not preserve the unversioned family default from older clients", () => {
  localStorage.setItem("investDataScope", "family");
  localStorage.removeItem("investDataScopeVersion");
  const { result } = renderHook(() => useSession());
  expect(result.current.dataScope).toBe("personal");
});

it("starts every new login in personal scope", async () => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, access_token: "new-token" }),
  }));
  const { result } = renderHook(() => useSession());
  act(() => result.current.setPassword("123456"));
  await act(() => result.current.login());
  expect(result.current.dataScope).toBe("personal");
  expect(localStorage.getItem("investDataScope")).toBe("personal");
});

it("applies the server calendar before exposing the loaded session", async () => {
  fetchJson.mockImplementation(async (path) => path === "/auth/session"
    ? { user: { id: 1 }, family: { id: 1 }, business_timezone: "America/Los_Angeles" }
    : { id: 1, members: [] });
  const { result } = renderHook(() => ({
    ...useSession(),
    month: currentMonthValue(new Date("2026-09-30T16:00:00Z")),
  }));
  await waitFor(() => expect(result.current.authSession).not.toBeNull());
  expect(result.current.month).toBe("2026-09");
});

it("clears identity, family data, errors and scope on logout", async () => {
  fetchJson.mockRejectedValue(new Error("identity failed"));
  const { result } = renderHook(() => useSession());
  await waitFor(() => expect(result.current.identityError).toContain("identity failed"));

  act(() => result.current.logout());

  expect(result.current.loggedIn).toBe(false);
  expect(result.current.authSession).toBeNull();
  expect(result.current.familyData.members).toEqual([]);
  expect(result.current.identityError).toBe("");
  expect(result.current.dataScope).toBe("personal");
  expect(localStorage.getItem("investAuthToken")).toBeNull();
});

it("does not apply identity responses from the previous scope", async () => {
  const pending = [];
  fetchJson.mockImplementation((path, options) => new Promise((resolve) => {
    pending.push({ path, scope: options.scope, resolve });
  }));
  const { result } = renderHook(() => useSession());
  await waitFor(() => expect(pending).toHaveLength(2));

  act(() => result.current.changeScope("personal"));
  await waitFor(() => expect(pending).toHaveLength(4));
  await act(async () => {
    pending[2].resolve({
      user: { id: 2, display_name: "新用户" },
      family: { id: 20 },
      business_timezone: "America/Los_Angeles",
    });
    pending[3].resolve({
      id: 20,
      name: "新家庭",
      members: [{ id: 202, display_name: "新用户" }],
    });
  });
  await waitFor(() => expect(result.current.familyData.name).toBe("新家庭"));

  await act(async () => {
    pending[0].resolve({
      user: { id: 1, display_name: "旧用户" },
      family: { id: 10 },
      business_timezone: "Asia/Shanghai",
    });
    pending[1].resolve({
      id: 10,
      name: "旧家庭",
      members: [{ id: 101, display_name: "旧用户" }],
    });
  });
  expect(result.current.authSession.user.id).toBe(2);
  expect(result.current.familyData.name).toBe("新家庭");
  expect(result.current.dataScope).toBe("personal");
  expect(currentMonthValue(new Date("2026-09-30T16:00:00Z"))).toBe("2026-09");
});
