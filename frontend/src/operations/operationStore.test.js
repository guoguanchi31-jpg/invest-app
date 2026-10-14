// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  acknowledgeOperation, LEGACY_OPERATION_STORAGE_KEY, OPERATION_STORAGE_KEY,
  operationIntent, resetOperationStoreForTests, resolveOperation,
} from "./operationStore";

afterEach(() => {
  resetOperationStoreForTests();
  vi.unstubAllGlobals();
});

it("generates a UUID when randomUUID is unavailable on an HTTP origin", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (target) => {
      target.set(Uint8Array.from({ length: 16 }, (_, index) => index));
      return target;
    },
  });

  const operation = resolveOperation({
    identity: "1:2:family",
    method: "PATCH",
    path: "/family/members/1",
    payload: { display_name: "111" },
  });

  expect(operation.id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
});

it.each([
  [LEGACY_OPERATION_STORAGE_KEY, "1:2", "committed"],
  [LEGACY_OPERATION_STORAGE_KEY, "1:2", "invalidated"],
  [OPERATION_STORAGE_KEY, "1:2:family", "committed"],
  [OPERATION_STORAGE_KEY, "1:2:family", "invalidated"],
])("acknowledges %s %s %s without leaving the old key in storage", (key, identity, status) => {
  const request = { identity: "1:2:family", method: "POST", path: "/transactions", payload: { amount: 10 } };
  const old = { id: "old-key", identity, status, intent: operationIntent(request.method, request.path, request.payload) };
  const unrelated = { ...old, id: "other-key", identity: "3:4:family" };
  localStorage.setItem(key, JSON.stringify([old, unrelated]));
  const operation = resolveOperation(request);
  expect(operation.id).toBe("old-key");
  acknowledgeOperation({ operation });
  expect(JSON.parse(localStorage.getItem(key))).toEqual([expect.objectContaining({ id: "other-key" })]);
  expect(resolveOperation(request).id).not.toBe("old-key");
});

it.each(["unknown", "processing"])("retains %s operations when a form closes", (status) => {
  const request = { identity: "1:2:family", method: "POST", path: "/transactions", payload: { amount: 10 } };
  localStorage.setItem(OPERATION_STORAGE_KEY, JSON.stringify([{
    id: "unresolved-key", identity: request.identity, status,
    intent: operationIntent(request.method, request.path, request.payload),
  }]));
  acknowledgeOperation({ operation: resolveOperation(request) });
  expect(resolveOperation(request).id).toBe("unresolved-key");
  expect(JSON.parse(localStorage.getItem(OPERATION_STORAGE_KEY))).toHaveLength(1);
});
