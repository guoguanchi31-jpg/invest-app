// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
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

  await expect(postJson("/transactions", { amount: 100 })).rejects.toThrow("network lost");
  await expect(postJson("/transactions", { amount: 100 })).resolves.toEqual({ id: 1 });
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("operation-1");
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("operation-1");
});
