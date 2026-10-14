// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BackupDialog from "./BackupDialog";
import { previewBackupRestore, restoreFamilyBackup } from "../features/backup/actions";

vi.mock("../features/backup/actions", () => ({
  previewBackupRestore: vi.fn(), restoreFamilyBackup: vi.fn(),
  downloadRecoveryBackup: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("discloses snapshot selection before confirmation and restores the original backup", async () => {
  const backup = { data: { snapshots: [{ id: 1, snapshot_date: "20261001" }, { id: 2, snapshot_date: "2026-10-01" }] } };
  previewBackupRestore.mockResolvedValue({
    counts: { snapshots: 1 }, current_counts: { snapshots: 0 }, expected_fingerprint: "book-version",
    snapshot_compatibility: { collisions: [{
      family_id: 1, member_id: null, snapshot_date: "2026-10-01",
      kept: { id: 2, original_date: "2026-10-01", created_at: "2026-10-01T10:00:00" },
      discarded: [{ id: 1, original_date: "20261001", created_at: "2026-10-01T09:00:00" }],
      reason: "按创建时间、ID选择，不合并金额",
    }] },
  });
  restoreFamilyBackup.mockResolvedValue({});
  const { container } = render(<BackupDialog onClose={vi.fn()} onRestored={vi.fn()} refresh={vi.fn()} />);
  fireEvent.change(container.querySelector("input[type=file]"), {
    target: { files: [{ name: "old.json", size: 100, text: async () => JSON.stringify(backup) }] },
  });
  await screen.findByRole("region", { name: "旧快照兼容处理" });
  expect(screen.getByText(/保留 #2/)).toBeTruthy();
  expect(screen.getByText(/舍弃 #1/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "确认恢复" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  await waitFor(() => expect(restoreFamilyBackup).toHaveBeenCalledTimes(1));
  expect(restoreFamilyBackup.mock.calls[0][0]).toEqual({
    backup, confirmReplace: true, expectedFingerprint: "book-version",
  });
});
