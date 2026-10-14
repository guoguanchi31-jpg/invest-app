// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("investDataScopeVersion", "2");
  vi.stubGlobal("crypto", { randomUUID: vi.fn()
    .mockReturnValueOnce("operation-1")
    .mockReturnValueOnce("operation-2")
    .mockReturnValueOnce("operation-3") });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const response = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

function testToken(userId, familyId) {
  return `${btoa(JSON.stringify({ sub: userId, family_id: familyId }))}.signature`;
}

function requestPath(fetchMock, index = 0) {
  return new URL(fetchMock.mock.calls[index][0]).pathname.replace(/^\/api/, "");
}

it("uses the same-origin Vite proxy for unconfigured browser development", async () => {
  const { apiUrl } = await import("./api");
  expect(apiUrl("/healthz")).toBe(`${window.location.origin}/api/healthz`);
});

it("keeps guest reads and writes inside the local adapter", async () => {
  const networkFetch = vi.fn();
  vi.stubGlobal("fetch", networkFetch);
  const { enableGuestMode } = await import("./guest/mode");
  enableGuestMode();
  const { fetchJson, postJson } = await import("./api");

  const session = await fetchJson("/auth/session", { scope: "family" });
  const accounts = await fetchJson("/accounts/overview", { scope: "family" });
  const before = await fetchJson("/ledger?page=1&page_size=30", { scope: "family" });
  await postJson("/transactions", {
    account_id: 101,
    amount: 66,
    direction: "expense",
    category_name: "餐饮",
    occurred_at: "2026-10-13",
    merchant: "游客咖啡",
    note: "",
  });
  const after = await fetchJson("/ledger?page=1&page_size=30", { scope: "family" });

  expect(session.user.display_name).toBe("小白");
  expect(accounts.accounts.some((account) => account.owner === "小白")).toBe(true);
  expect(accounts.accounts.some((account) => account.owner === "冠池")).toBe(false);
  expect(after.total).toBe(before.total + 1);
  expect(after.items.some((item) => item.merchant === "游客咖啡")).toBe(true);
  await expect(postJson("/warehouse/restore", {})).rejects.toThrow("游客模式暂不支持");
  expect(networkFetch).not.toHaveBeenCalled();
});

async function seedLegacyOperation({
  id = "legacy-operation",
  identity = "1:1",
  method = "POST",
  path = "/transactions",
  payload = { amount: 10 },
  status = "unknown",
} = {}) {
  const { operationIntent } = await import("./operations/operationStore");
  localStorage.setItem("investPendingOperations:v1", JSON.stringify([{
    id,
    identity,
    intent: operationIntent(method, path, payload),
    method,
    path,
    status,
  }]));
  return { id, method, path, payload };
}

it("coalesces concurrent identical writes but gives a later real write a new key", async () => {
  let finish;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(response({ id: 2 }));
  vi.stubGlobal("fetch", fetch);
  const { postJson } = await import("./api");

  const first = postJson("/transactions", { amount: 100 });
  const duplicateClick = postJson("/transactions", { amount: 100 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(first).toBe(duplicateClick);
  finish(response({ id: 1 }));
  await expect(first).resolves.toEqual({ id: 1 });

  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 2 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-2");
});

it("reuses the operation key after an ambiguous network failure", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("network lost"))
    .mockResolvedValueOnce(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  const { postJson } = await import("./api");

  await expect(postJson("/transactions", { amount: 100 })).rejects.toMatchObject({
    resultUnknown: true,
    originalMessage: "network lost",
  });
  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 1 });
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-1");
});


it("does not reuse an unresolved operation key in another data scope", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ id: 2 }));
  vi.stubGlobal("fetch", fetch);
  const {
    AUTH_TOKEN_KEY,
    DATA_SCOPE_KEY,
    invalidateRequestGeneration,
    postJson,
  } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "opaque-user-token");
  localStorage.setItem(DATA_SCOPE_KEY, "family");

  await expect(postJson("/transactions", { amount: 100 })).rejects.toMatchObject({
    resultUnknown: true,
    operationId: "operation-1",
  });
  localStorage.setItem(DATA_SCOPE_KEY, "personal");
  invalidateRequestGeneration();
  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 2 });

  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-2");
});


it("keeps the same business operation across scope generations", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  const {
    AUTH_TOKEN_KEY,
    DATA_SCOPE_KEY,
    invalidateRequestGeneration,
    postJson,
  } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "opaque-user-token");
  localStorage.setItem(DATA_SCOPE_KEY, "family");

  await expect(postJson("/transactions", { amount: 100 })).rejects.toMatchObject({
    resultUnknown: true,
    operationId: "operation-1",
  });
  localStorage.setItem(DATA_SCOPE_KEY, "personal");
  invalidateRequestGeneration();
  localStorage.setItem(DATA_SCOPE_KEY, "family");
  invalidateRequestGeneration();
  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 1 });

  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-1");
});

it.each(["committed", "expired"])(
  "confirms a legacy %s operation without replaying its write",
  async (status) => {
    const legacy = await seedLegacyOperation();
    const fetch = vi.fn().mockResolvedValue(response({
      status,
      protocol_version: 1,
      scope_known: false,
    }));
    vi.stubGlobal("fetch", fetch);
    const { AUTH_TOKEN_KEY, DATA_SCOPE_KEY, postJson } = await import("./api");
    localStorage.setItem(AUTH_TOKEN_KEY, testToken(1, 1));
    localStorage.setItem(DATA_SCOPE_KEY, "family");

    await expect(postJson(legacy.path, legacy.payload)).rejects.toMatchObject({
      code: "COMMAND_RESULT_EXPIRED",
      committed: true,
      operationId: legacy.id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(fetch)).toBe(`/commands/${legacy.id}`);
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    expect(localStorage.getItem("investPendingOperations:v1")).toContain(legacy.id);
    expect(localStorage.getItem("investPendingOperations:v2")).toBeNull();
  },
);

it.each([
  ["unsubmitted", "unknown"],
  ["unknown", "unknown"],
  ["unknown", "processing"],
])(
  "keeps a legacy %s operation for explicit review when the receipt is %s",
  async (storedStatus, receiptStatus) => {
    const legacy = await seedLegacyOperation({ status: storedStatus });
    const fetch = vi.fn().mockResolvedValue(response({
      status: receiptStatus,
      protocol_version: receiptStatus === "processing" ? 1 : null,
      scope_known: false,
    }));
    vi.stubGlobal("fetch", fetch);
    const { AUTH_TOKEN_KEY, DATA_SCOPE_KEY, postJson } = await import("./api");
    localStorage.setItem(AUTH_TOKEN_KEY, testToken(1, 1));
    localStorage.setItem(DATA_SCOPE_KEY, "personal");

    await expect(postJson(legacy.path, legacy.payload)).rejects.toMatchObject({
      code: "OPERATION_SCOPE_REVIEW_REQUIRED",
      resultUnknown: true,
      operationId: legacy.id,
      receiptStatus,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(fetch)).toBe(`/commands/${legacy.id}`);
    expect(localStorage.getItem("investPendingOperations:v1")).toContain(legacy.id);
    expect(localStorage.getItem("investPendingOperations:v2")).toBeNull();
  },
);

it("keeps an invalidated legacy operation terminal after a restore", async () => {
  const legacy = await seedLegacyOperation();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
    status: "invalidated",
    protocol_version: 1,
    scope_known: false,
  })));
  const { AUTH_TOKEN_KEY, postJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, testToken(1, 1));

  await expect(postJson(legacy.path, legacy.payload)).rejects.toMatchObject({
    code: "COMMAND_INVALIDATED",
    operationId: legacy.id,
  });
  expect(localStorage.getItem("investPendingOperations:v1")).toContain(legacy.id);
});

it("never adopts another user's legacy operation", async () => {
  const legacy = await seedLegacyOperation({ identity: "1:1" });
  const fetch = vi.fn().mockResolvedValue(response({ id: 2 }));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, postJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, testToken(2, 1));

  await expect(postJson(legacy.path, legacy.payload)).resolves.toEqual({ id: 2 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestPath(fetch)).toBe(legacy.path);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(localStorage.getItem("investPendingOperations:v1")).toContain(legacy.id);
});

it("keeps the original key for a transitional v1 record that already stores scope", async () => {
  const legacy = await seedLegacyOperation({ identity: "1:1:family" });
  const fetch = vi.fn().mockResolvedValue(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, DATA_SCOPE_KEY, postJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, testToken(1, 1));
  localStorage.setItem(DATA_SCOPE_KEY, "family");

  await expect(postJson(legacy.path, legacy.payload)).resolves.toEqual({ id: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestPath(fetch)).toBe(legacy.path);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(legacy.id);
});


it("recovers an unknown operation after the api module is reloaded", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  let api = await import("./api");
  localStorage.setItem(api.AUTH_TOKEN_KEY, "opaque-user-token");

  await expect(api.postJson("/accounts/transfer", { amount: 100 })).rejects.toMatchObject({
    resultUnknown: true,
    originalMessage: "response lost",
  });
  expect(localStorage.getItem("investPendingOperations:v2")).not.toContain(
    "opaque-user-token",
  );
  expect(localStorage.getItem("investPendingOperations:v2")).not.toContain(
    '"amount":100',
  );
  vi.resetModules();
  api = await import("./api");
  await expect(api.postJson("/accounts/transfer", { amount: 100 })).resolves.toEqual({
    id: 1,
  });

  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(localStorage.getItem("investPendingOperations:v2")).toBeNull();
});


it("does not merge operations from different authenticated identities", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ id: 2 }));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, postJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "first-user-token");
  await expect(postJson("/transactions", { amount: 100 })).rejects.toMatchObject({
    resultUnknown: true,
    originalMessage: "response lost",
  });

  localStorage.setItem(AUTH_TOKEN_KEY, "second-user-token");
  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 2 });
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-2");
});

it("sends the selected family or personal scope with every authenticated request", async () => {
  const fetch = vi.fn().mockResolvedValue(response({}));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, DATA_SCOPE_KEY, fetchJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "token");
  localStorage.setItem(DATA_SCOPE_KEY, "personal");

  await fetchJson("/accounts/overview");

  expect(fetch.mock.calls[0][1].headers).toMatchObject({
    Authorization: "Bearer token",
    "X-Data-Scope": "personal",
  });
});

it("uses personal scope when no preference has been stored", async () => {
  const fetch = vi.fn().mockResolvedValue(response({}));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, fetchJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "token");

  await fetchJson("/accounts/overview");

  expect(fetch.mock.calls[0][1].headers).toMatchObject({
    Authorization: "Bearer token",
    "X-Data-Scope": "personal",
  });
});

it("does not clear a replacement token when an older request returns 401", async () => {
  let finish;
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const { AUTH_TOKEN_KEY, fetchJson } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "old-token");

  const oldRequest = fetchJson("/accounts/overview");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer old-token");
  localStorage.setItem(AUTH_TOKEN_KEY, "new-token");
  finish({ ok: false, status: 401 });

  await expect(oldRequest).rejects.toThrow("登录状态已更新");
  expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe("new-token");
});

it("rejects an old response after the session generation changes", async () => {
  let finish;
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const {
    AUTH_TOKEN_KEY,
    DATA_SCOPE_KEY,
    fetchJson,
    invalidateRequestGeneration,
  } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "same-token");
  localStorage.setItem(DATA_SCOPE_KEY, "family");

  const oldRequest = fetchJson("/accounts/overview", { scope: "family" });
  invalidateRequestGeneration();
  finish(response({ accounts: [{ id: 1 }] }));

  await expect(oldRequest).rejects.toMatchObject({
    name: "StaleRequestError",
    stale: true,
  });
});

it("rejects a response returned for a previous scope", async () => {
  let finish;
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const {
    AUTH_TOKEN_KEY,
    DATA_SCOPE_KEY,
    fetchJson,
  } = await import("./api");
  localStorage.setItem(AUTH_TOKEN_KEY, "token");
  localStorage.setItem(DATA_SCOPE_KEY, "family");

  const familyRequest = fetchJson("/accounts/overview", { scope: "family" });
  localStorage.setItem(DATA_SCOPE_KEY, "personal");
  finish(response({ accounts: [{ id: 1 }] }));

  await expect(familyRequest).rejects.toMatchObject({ stale: true });
});

const errorResponse = (code, status = 409) => ({
  ok: false,
  status,
  clone: () => ({ json: async () => ({ code, detail: "test outcome" }) }),
});

it("retains committed tombstones across retries and reloads after response expiry", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("lost"))
    .mockResolvedValueOnce(errorResponse("COMMAND_RESULT_EXPIRED"));
  vi.stubGlobal("fetch", fetch);
  let api = await import("./api");
  localStorage.setItem(api.AUTH_TOKEN_KEY, "same-user");
  await expect(api.postJson("/transactions", { amount: 100 })).rejects.toMatchObject({ resultUnknown: true });
  await expect(api.postJson("/transactions", { amount: 100 })).rejects.toMatchObject({
    committed: true, code: "COMMAND_RESULT_EXPIRED",
  });
  vi.resetModules();
  api = await import("./api");
  await expect(api.postJson("/transactions", { amount: 100 })).rejects.toMatchObject({ committed: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]))
    .toEqual(["operation-1", "operation-1"]);
});

it.each(["COMMAND_PROCESSING", "COMMAND_INVALIDATED", "COMMAND_CONTENT_CONFLICT"])(
  "never replaces the original key for %s",
  async (code) => {
    const fetch = vi.fn().mockResolvedValue(errorResponse(code));
    vi.stubGlobal("fetch", fetch);
    const { postJson } = await import("./api");
    for (let i = 0; i < 2; i += 1) {
      await expect(postJson("/transactions", { amount: 100 })).rejects.toBeInstanceOf(Error);
    }
    expect(new Set(fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"])))
      .toEqual(new Set(["operation-1"]));
  },
);

it("binds a successful submission to its result while allowing a fresh explicit intent", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  const { postJson } = await import("./api");
  const submission = {};
  await postJson("/transactions", { amount: 100 }, { submission });
  await postJson("/transactions", { amount: 100 }, { submission });
  expect(fetch).toHaveBeenCalledTimes(1);
  await postJson("/transactions", { amount: 100 }, { submission: {} });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("blocks payload changes while the same intent has an unknown result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("lost")));
  const { postJson } = await import("./api");
  const submission = {};
  await expect(postJson("/transactions", { amount: 100 }, { submission }))
    .rejects.toMatchObject({ resultUnknown: true });
  expect(() => postJson("/transactions", { amount: 200 }, { submission }))
    .toThrow("保留原内容");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("confirms an older unknown state command before sending its opposite", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ status: "committed" }))
    .mockResolvedValueOnce(response({ status: "active" }));
  vi.stubGlobal("fetch", fetch);
  const { patchJson } = await import("./api");
  const path = "/goals/1/status";
  await expect(patchJson(
    path, { status: "completed" }, { conflictKey: path },
  )).rejects.toMatchObject({ resultUnknown: true });
  await expect(patchJson(
    path, { status: "active" }, { conflictKey: path },
  )).resolves.toEqual({ status: "active" });

  expect(fetch.mock.calls.map(([url, options]) => [
    new URL(url).pathname.replace(/^\/api/, ""), options.method || "GET",
  ])).toEqual([
    [path, "PATCH"],
    ["/commands/operation-1", "GET"],
    [path, "PATCH"],
  ]);
  expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe("operation-2");
});

it("blocks a new state while the old command is absent and preserves the old retry key", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ status: "unknown" }))
    .mockResolvedValueOnce(response({ status: "completed" }));
  vi.stubGlobal("fetch", fetch);
  const { patchJson } = await import("./api");
  const path = "/goals/1/status";
  await expect(patchJson(
    path, { status: "completed" }, { conflictKey: path },
  )).rejects.toMatchObject({ resultUnknown: true });
  await expect(patchJson(
    path, { status: "active" }, { conflictKey: path },
  )).rejects.toMatchObject({ code: "OPERATION_UNRESOLVED" });
  await expect(patchJson(
    path, { status: "completed" }, { conflictKey: path },
  )).resolves.toEqual({ status: "completed" });
  expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe("operation-1");
});

it("shares one conflict group across account archive and restore paths", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(response({ status: "committed" }))
    .mockResolvedValueOnce(response({ message: "restored" }));
  vi.stubGlobal("fetch", fetch);
  const { deleteJson, postJson } = await import("./api");
  const account = "/accounts/1";
  const options = {
    conflictKey: account,
    conflictPaths: [account, `${account}/restore`],
  };
  await expect(deleteJson(account, options)).rejects.toMatchObject({
    resultUnknown: true,
  });
  await expect(postJson(`${account}/restore`, undefined, options)).resolves.toEqual({
    message: "restored",
  });
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname.replace(/^\/api/, ""))).toEqual([
    account, "/commands/operation-1", `${account}/restore`,
  ]);
});
