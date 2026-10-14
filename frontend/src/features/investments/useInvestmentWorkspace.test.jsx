// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetOperationStoreForTests } from "../../operations/operationStore";
import { useInvestmentDrafts, useInvestmentMutations } from "./useInvestmentWorkspace";

beforeEach(() => {
  localStorage.clear();
  resetOperationStoreForTests();
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ message: "saved" }),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains a cash submission after refresh failure and starts another only on user editing", async () => {
  const refresh = vi.fn().mockResolvedValue(false);
  const { result } = renderHook(() => {
    const drafts = useInvestmentDrafts();
    const mutations = useInvestmentMutations({
      ...drafts, dataIdentityKey: "family", dataScope: "family",
      loadData: refresh, setInvestmentData: vi.fn(),
    });
    return { ...drafts, ...mutations };
  });
  const account = { id: 1, cash_available_original: 50 };
  act(() => result.current.updateInvestmentCashDraft(account, "100"));
  await act(() => result.current.saveInvestmentCash(1));
  await act(() => result.current.saveInvestmentCash(1));
  expect(fetch).toHaveBeenCalledTimes(1);

  // Another transaction changes available cash; the user explicitly reconciles
  // back to the same amount. This is a new intent even with identical input.
  act(() => {
    result.current.cashDraftBaselinesRef.current.set(1, 90);
    result.current.updateInvestmentCashDraft({ ...account, cash_available_original: 90 }, "100");
  });
  await act(() => result.current.saveInvestmentCash(1));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).expected_cash_available).toBe(90);
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"])
    .not.toBe(fetch.mock.calls[1][1].headers["Idempotency-Key"]);
});
