// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { patchJson } from "../../api";
import { resetOperationStoreForTests } from "../../operations/operationStore";
import useGoalWorkspace from "../goals/useGoalWorkspace";
import useScopedDataResource from "./useScopedDataResource";
import { useCommandActions } from "./useSubmission";

const EMPTY = Object.freeze([]);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  localStorage.clear();
  resetOperationStoreForTests();
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ id: 1 }),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function useHarness(load, identityKey = "family", resourceKey = "goals:2026-09") {
  const selectedMonth = resourceKey.split(":")[1] || "2026-09";
  const resource = useScopedDataResource({
    enabled: true, loggedIn: true, identityKey, resourceKey, initialValue: EMPTY, load,
  });
  const confirmations = [resource.confirmation];
  const command = useCommandActions(identityKey, confirmations);
  const workspace = useGoalWorkspace({
    dataIdentityKey: identityKey, dataScope: "family", selectedMonth,
    loadData: resource.refresh, resourceConfirmations: confirmations, requestOptions: {},
  });
  return { resource, command, workspace };
}

it("allows complete → manual reload → restore → complete after a committed write's failed GET", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useHarness(load));
  await act(async () => {});
  load.mockRejectedValueOnce(new Error("GET failed"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(() => result.current.resource.refresh());
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "active"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  expect(fetch).toHaveBeenCalledTimes(3);
  const keys = fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]);
  expect(new Set(keys).size).toBe(3);
});

it("keeps a confirmed September completion released after switching to October", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ month }) => useHarness(load, "family", `goals:${month}`),
    { initialProps: { month: "2026-09" } },
  );
  await act(async () => {});
  load.mockRejectedValueOnce(new Error("GET failed"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  await act(() => result.current.resource.refresh());
  rerender({ month: "2026-10" });
  await act(async () => {});
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "active"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new Set(fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"])).size)
    .toBe(3);
});

it("lets a confirmed entity-state write supersede a failed September view refresh", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ month }) => useHarness(load, "family", `goals:${month}`),
    { initialProps: { month: "2026-09" } },
  );
  await act(async () => {});
  load.mockRejectedValueOnce(new Error("GET failed"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  rerender({ month: "2026-10" });
  await act(async () => {});
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "active"));
  await act(() => result.current.workspace.handleGoalStatus({ id: 1 }, "completed"));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new Set(fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"])).size)
    .toBe(3);
});

it("retires an older committed state while its September refresh is still pending", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ month }) => useHarness(load, "family", `goals:${month}`),
    { initialProps: { month: "2026-09" } },
  );
  await act(async () => {});
  const oldRefresh = deferred();
  const statusOptions = (status, resourceKey, refresh) => ({
    resourceKey,
    stateKey: "goal:1:status",
    write: (options) => patchJson(
      "/goals/1/status",
      { status },
      options,
    ),
    refresh,
  });
  let oldCompletion;
  act(() => {
    oldCompletion = result.current.command(
      "goal:1:completed",
      statusOptions("completed", "goals:2026-09", () => oldRefresh.promise),
    );
  });
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(1);

  rerender({ month: "2026-10" });
  await act(async () => {});
  await act(() => result.current.command(
    "goal:1:active",
    statusOptions("active", "goals:2026-10", async () => true),
  ));
  await act(() => result.current.command(
    "goal:1:completed",
    statusOptions("completed", "goals:2026-10", async () => true),
  ));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new Set(
    fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]),
  ).size).toBe(3);

  await act(async () => {
    oldRefresh.resolve(true);
    await oldCompletion;
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("keeps commit ordering correct when the older refresh finishes first", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ month }) => useHarness(load, "family", `goals:${month}`),
    { initialProps: { month: "2026-09" } },
  );
  await act(async () => {});
  const firstRefresh = deferred();
  const secondRefresh = deferred();
  const runStatus = (key, status, resourceKey, refresh) => result.current.command(key, {
    resourceKey,
    stateKey: "goal:1:status",
    write: (options) => patchJson("/goals/1/status", { status }, options),
    refresh,
  });
  let first;
  act(() => {
    first = runStatus(
      "goal:1:completed",
      "completed",
      "goals:2026-09",
      () => firstRefresh.promise,
    );
  });
  await act(async () => {});
  rerender({ month: "2026-10" });
  await act(async () => {});
  let second;
  act(() => {
    second = runStatus(
      "goal:1:active",
      "active",
      "goals:2026-10",
      () => secondRefresh.promise,
    );
  });
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(2);

  await act(async () => {
    firstRefresh.resolve(true);
    await first;
  });
  await act(async () => {
    secondRefresh.resolve(true);
    await second;
  });
  await act(() => runStatus(
    "goal:1:completed",
    "completed",
    "goals:2026-10",
    async () => true,
  ));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new Set(
    fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]),
  ).size).toBe(3);
});

it("never supersedes an unknown state intent without server confirmation", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useHarness(load));
  await act(async () => {});
  const unresolved = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error("lost"), { resultUnknown: true }))
    .mockResolvedValue({});
  const replacement = vi.fn().mockResolvedValue({});
  const common = {
    resourceKey: "goals:2026-09",
    stateKey: "goal:1:status",
    refresh: async () => false,
  };
  await act(() => result.current.command("completed", {
    ...common, write: unresolved,
  }));
  await act(() => result.current.command("active", {
    ...common, write: replacement,
  }));
  await act(() => result.current.command("completed", {
    ...common, write: unresolved,
  }));
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(unresolved).toHaveBeenCalledTimes(2);
});

it.each(["old-first", "new-first"])(
  "advances state at commit while an unrelated GET is pending (%s)",
  async (order) => {
    const load = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ month }) => useHarness(load, "family", `goals:${month}`),
      { initialProps: { month: "2026-09" } },
    );
    await act(async () => {});
    const oldGet = deferred();
    const unrelatedGet = deferred();
    const run = (status, resourceKey, refresh) => result.current.command(`goal:1:${status}`, {
      resourceKey, stateKey: "goal:1:status",
      write: (options) => patchJson("/goals/1/status", { status }, options),
      refresh,
    });
    let first;
    act(() => { first = run("completed", "goals:2026-09", () => oldGet.promise); });
    await act(async () => {});
    rerender({ month: "2026-10" });
    await act(async () => {});
    let second;
    act(() => {
      second = run("active", "goals:2026-10", async () => {
        await result.current.resource.refresh();
        return unrelatedGet.promise;
      });
    });
    await act(async () => {});
    if (order === "old-first") {
      await act(async () => { oldGet.resolve(true); await first; });
    }
    // The goal read confirmed the second write. Another page's pending GET
    // must not prevent a third goal transition or leave the first intent alive.
    await act(() => run("completed", "goals:2026-10", () => result.current.resource.refresh()));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Set(fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"])).size).toBe(3);
    await act(async () => { unrelatedGet.resolve(true); await second; });
    if (order === "new-first") {
      await act(async () => { oldGet.resolve(true); await first; });
    }
    // An old completion must not delete a newer same-key intent.
    await act(() => run("active", "goals:2026-10", async () => false));
    await act(() => run("active", "goals:2026-10", async () => false));
    expect(fetch).toHaveBeenCalledTimes(4);
  },
);

it("releases from the relevant read even when another page's refresh still fails", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useHarness(load));
  await act(async () => {});
  const write = vi.fn().mockResolvedValue({});
  const options = {
    resourceKey: "goals:2026-09", write,
    refresh: async () => { await result.current.resource.refresh(); return false; },
  };
  await act(() => result.current.command("status", options));
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(2);
});

it("does not release on a GET begun before commit or an unrelated month or identity", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ month }) => useHarness(load, "family", `goals:${month}`),
    { initialProps: { month: "2026-09" } },
  );
  await act(async () => {});
  const oldRead = deferred();
  load.mockReturnValueOnce(oldRead.promise);
  let reading;
  act(() => { reading = result.current.resource.refresh(); });
  const write = vi.fn().mockResolvedValue({});
  const options = { write, resourceKey: "goals:2026-09", refresh: async () => false };
  await act(() => result.current.command("status", options));
  await act(async () => { oldRead.resolve([]); await reading; });
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(1);
  rerender({ month: "2026-10" });
  await act(async () => {});
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(1);
  rerender({ month: "2026-09" });
  await act(async () => {});
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(2);
});

it("retains the operation key for an unknown result despite a successful manual refresh", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useHarness(load));
  await act(async () => {});
  fetch.mockRejectedValueOnce(new TypeError("connection lost"));
  const options = {
    resourceKey: "goals:2026-09",
    write: (requestOptions) => patchJson("/goals/1/status", { status: "completed" }, requestOptions),
    refresh: async () => false,
  };
  await act(() => result.current.command("status", options));
  await act(() => result.current.resource.refresh());
  await act(() => result.current.command("status", options));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"])
    .toBe(fetch.mock.calls[1][1].headers["Idempotency-Key"]);
});

it("blocks double clicks while write or refresh is pending and ignores the old identity's completion", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result, rerender } = renderHook(({ identity }) => useHarness(load, identity), {
    initialProps: { identity: "one" },
  });
  await act(async () => {});
  const committed = deferred();
  const write = vi.fn().mockReturnValueOnce(committed.promise).mockResolvedValue({});
  const options = { write, resourceKey: "goals:2026-09", refresh: async () => false };
  let first;
  act(() => { first = result.current.command("status", options); });
  await act(() => result.current.command("status", options));
  await act(() => result.current.resource.refresh());
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(1);
  rerender({ identity: "two" });
  await act(() => result.current.command("status", options));
  await act(async () => { committed.resolve({}); await first; });
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(2);
});

it("requires a post-invalidation read before creating a replacement intent", async () => {
  const load = vi.fn().mockResolvedValue([]);
  const { result } = renderHook(() => useHarness(load));
  await act(async () => {});
  const write = vi.fn().mockRejectedValueOnce(
    Object.assign(new Error("restored"), { code: "COMMAND_INVALIDATED" }),
  ).mockResolvedValue({});
  const options = { write, resourceKey: "goals:2026-09", refresh: async () => false };
  await act(() => result.current.command("status", options));
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(1);
  await act(() => result.current.resource.refresh());
  await act(() => result.current.command("status", options));
  expect(write).toHaveBeenCalledTimes(2);
});
