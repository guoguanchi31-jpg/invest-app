// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableGuestMode } from "./mode";
import {
  getGuestSnapshotForTest,
  guestWriteJson,
  resetGuestData,
} from "./guestApi";

function account(snapshot, accountId) {
  return snapshot.accounts.find((item) => item.id === accountId);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T08:00:00Z"));
  enableGuestMode();
  resetGuestData();
});

afterEach(() => {
  vi.useRealTimers();
});

it("moves guest transfers into investment cash and reverses each transfer once", async () => {
  const before = getGuestSnapshotForTest();
  const bankBefore = account(before, 101).balance;
  const investmentBefore = account(before, 103).cash_available_original;

  const transfer = await guestWriteJson("POST", "/accounts/transfer", {
    from_account_id: 101,
    to_account_id: 103,
    amount: 500,
    to_amount: 500,
    occurred_at: "2026-10-14",
    note: "游客定投",
  });
  let snapshot = getGuestSnapshotForTest();
  expect(account(snapshot, 101).balance).toBe(bankBefore - 500);
  expect(account(snapshot, 103).cash_available_original).toBe(investmentBefore + 500);

  await guestWriteJson(
    "POST",
    `/accounts/transfers/${encodeURIComponent(transfer.reference_id)}/reverse`,
    { reason: "金额填错" },
  );
  snapshot = getGuestSnapshotForTest();
  expect(account(snapshot, 101).balance).toBe(bankBefore);
  expect(account(snapshot, 103).cash_available_original).toBe(investmentBefore);
  const reversed = snapshot.transactions.find(
    (item) => item.reference_id === transfer.reference_id,
  );
  expect(reversed.voided_at).toBeTruthy();
  expect(reversed.void_reason).toBe("金额填错");

  await expect(guestWriteJson(
    "POST",
    `/accounts/transfers/${encodeURIComponent(transfer.reference_id)}/reverse`,
    { reason: "重复撤销" },
  )).rejects.toThrow("已撤销");
  snapshot = getGuestSnapshotForTest();
  expect(account(snapshot, 101).balance).toBe(bankBefore);
  expect(account(snapshot, 103).cash_available_original).toBe(investmentBefore);
});

it("rejects reversal atomically after transferred investment cash is used", async () => {
  const before = getGuestSnapshotForTest();
  const bankBefore = account(before, 101).balance;
  const transfer = await guestWriteJson("POST", "/accounts/transfer", {
    from_account_id: 101,
    to_account_id: 103,
    amount: 500,
    to_amount: 500,
    occurred_at: "2026-10-14",
  });
  await guestWriteJson("PATCH", "/investments/cash-available", {
    account_id: 103,
    cash_available: 100,
  });

  await expect(guestWriteJson(
    "POST",
    `/accounts/transfers/${encodeURIComponent(transfer.reference_id)}/reverse`,
    { reason: "尝试撤销" },
  )).rejects.toThrow("现金可投不足");

  const snapshot = getGuestSnapshotForTest();
  expect(account(snapshot, 101).balance).toBe(bankBefore - 500);
  expect(account(snapshot, 103).cash_available_original).toBe(100);
  expect(snapshot.transactions.find(
    (item) => item.reference_id === transfer.reference_id,
  ).voided_at).toBeUndefined();
});
