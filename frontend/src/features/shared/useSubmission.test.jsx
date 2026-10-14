// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postJson } from "../../api";
import { resetOperationStoreForTests } from "../../operations/operationStore";
import useActionWorkspace from "../../app/useActionWorkspace";
import { createSubmission, executeSubmission } from "./useSubmission";

beforeEach(() => {
  localStorage.clear();
  resetOperationStoreForTests();
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ id: 1 }),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const config = () => ({
  accountsData: { accounts: [{ id: 1, owner: "大宝", type: "debit_card" }] },
  authSession: {},
  dataIdentityKey: "user:family",
  defaultOwner: "大宝",
  familyData: { members: [] },
  loadData: vi.fn().mockResolvedValue(false),
  normalizeOwner: (value) => value || "大宝",
  onDataChanged: vi.fn(),
  refreshInvestmentQuotes: vi.fn(),
  requestOptions: {},
  selectedMonth: "2026-09",
});

it("ends the real action form before a failed GET can turn success into another write", async () => {
  const { result } = renderHook(() => useActionWorkspace(config()));
  act(() => result.current.openAction("transaction", { amount: "100" }));
  await act(() => result.current.submitAction());
  expect(result.current.isAdding).toBe(false);
  await act(() => result.current.submitAction());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("已保存，数据刷新失败"));
});

it("submits a one-time form snapshot from the App amount calculator", async () => {
  const { result } = renderHook(() => useActionWorkspace(config()));
  act(() => result.current.openAction("transaction", { amount: "20" }));
  await act(() => result.current.submitAction({
    formOverride: { ...result.current.form, amount: "25.5" },
  }));

  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    account_id: 1,
    amount: 25.5,
    direction: "expense",
  });
});

it("creates a new intent only for an explicit next entry, including identical amounts", async () => {
  const settings = config();
  const { result } = renderHook(() => useActionWorkspace(settings));
  act(() => result.current.openAction("transaction", { amount: "100" }));
  await act(() => result.current.submitAction({ keepOpen: true }));
  expect(result.current.isAdding).toBe(true);
  expect(result.current.form.amount).toBe("");
  act(() => result.current.setForm((form) => ({ ...form, amount: "100" })));
  await act(() => result.current.submitAction());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"])
    .not.toBe(fetch.mock.calls[1][1].headers["Idempotency-Key"]);
});

it.each(["/budgets", "/goals", "/investments/cash-available", "/transactions/import", "/accounts/transfers/1/reverse", "/warehouse/restore"])(
  "%s shares the confirmed-write contract when refresh throws",
  async (path) => {
    const intent = createSubmission();
    const onCommitted = vi.fn();
    const options = {
      write: (requestOptions) => postJson(path, { amount: 100 }, requestOptions),
      onCommitted,
      refresh: vi.fn().mockRejectedValue(new Error("GET unavailable")),
    };
    expect(await executeSubmission(intent, options)).toMatchObject({ committed: true, refreshed: false });
    expect(await executeSubmission(intent, options)).toMatchObject({ committed: true, duplicate: true });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("finishes an expired confirmed operation without offering the original write again", async () => {
  fetch.mockResolvedValue({
    ok: false, status: 409,
    clone: () => ({ json: async () => ({ code: "COMMAND_RESULT_EXPIRED", detail: "已处理" }) }),
  });
  const intent = createSubmission();
  const onCommitted = vi.fn();
  const options = { write: (opts) => postJson("/transactions", { amount: 100 }, opts), onCommitted };
  expect(await executeSubmission(intent, options)).toMatchObject({ committed: true });
  await executeSubmission(intent, options);
  expect(onCommitted).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
