// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storeDataScope } from "../../api";
import { resetOperationStoreForTests } from "../../operations/operationStore";
import ReconciliationDialog from "./ReconciliationDialog";

const report = {
  items: [{
    account_id: 7, owner: "成员甲", account_name: "测试账户", currency: "USD",
    healthy: false, can_correct: true, actual: 100, expected: 100, matches: true,
    state_field: "balance", history: { status: "complete" },
    limitation: "余额吻合仍需核对应用标记",
    application: { marker_consistent: false, issues: [{
      transaction_id: 9, occurred_at: "2026-09-28", amount: 10, direction: "expense",
      actual_balance_applied: false, expected_balance_applied: true,
      requires_correction: true, correction_delta: -10,
    }] },
  }],
};
const response = (body) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  resetOperationStoreForTests();
  storeDataScope("family");
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(report)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const requestOptions = { operationIdentity: "1:2:family", scope: "family" };
function mount() {
  const refresh = vi.fn().mockResolvedValue(true);
  const onCorrected = vi.fn();
  render(<ReconciliationDialog identityKey="1:2:family" requestOptions={requestOptions}
    refresh={refresh} onCorrected={onCorrected} onClose={vi.fn()} />);
  return { refresh, onCorrected };
}
async function select() {
  fireEvent.click(await screen.findByRole("button", { name: "核对并更正流水 #9" }));
  fireEvent.change(screen.getByLabelText("更正原因"), { target: { value: "已核对银行账单" } });
  fireEvent.click(screen.getByLabelText("我已核对原流水和账单，确认以上余额变化"));
}

it("keeps a matching sum visibly unhealthy and sends an explicit guarded correction once", async () => {
  const { onCorrected, refresh } = mount();
  await select();
  expect(screen.getByText("需要核对")).toBeTruthy();
  expect(screen.queryByText("核对正常")).toBeNull();
  const commit = screen.getByRole("button", { name: "确认更正" });
  fireEvent.click(commit);
  fireEvent.click(commit);
  await waitFor(() => expect(onCorrected).toHaveBeenCalledTimes(1));
  const writes = fetch.mock.calls.filter(([, options]) => options.method === "PATCH");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toContain("/transactions/9/application");
  expect(JSON.parse(writes[0][1].body)).toEqual({
    expected_account_balance: 100, expected_balance_applied: false, reason: "已核对银行账单",
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("freezes an unknown correction and retries the same content and operation key", async () => {
  mount();
  await select();
  fetch.mockRejectedValueOnce(new TypeError("connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "确认更正" }));
  const retry = await screen.findByRole("button", { name: "按原内容重试" });
  expect(screen.getByLabelText("更正原因").disabled).toBe(true);
  fireEvent.click(retry);
  await screen.findByText("更正已提交，原流水与余额变更已记入审计。");
  const writes = fetch.mock.calls.filter(([, options]) => options.method === "PATCH");
  expect(writes).toHaveLength(2);
  expect(writes[0][1].headers["Idempotency-Key"]).toBe(writes[1][1].headers["Idempotency-Key"]);
  expect(writes[0][1].body).toBe(writes[1][1].body);
});

it("shows revoked and archived issues without offering a correction", async () => {
  fetch.mockResolvedValue(response({
    items: [{ ...report.items[0], can_correct: false }],
  }));
  mount();
  await screen.findByText("需要核对");
  expect(screen.queryByRole("button", { name: "核对并更正流水 #9" })).toBeNull();
  expect(fetch.mock.calls.every(([, options]) => options.method !== "PATCH")).toBe(true);
});
