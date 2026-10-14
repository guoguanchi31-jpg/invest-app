// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DialogActions, { DialogAction } from "./components/DialogActions";
import ModalBackdrop from "./components/ModalBackdrop";
import ModalPanel from "./components/ModalPanel";

const nativeBack = vi.hoisted(() => {
  const listeners = new Set();
  return {
    listeners,
    press() {
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_eventName, listener) => {
      nativeBack.listeners.add(listener);
      return {
        remove: async () => nativeBack.listeners.delete(listener),
      };
    }),
  },
}));

afterEach(() => cleanup());

function FocusHarness() {
  const [open, setOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开弹窗</button>
      {open ? (
        <ModalBackdrop onClose={() => setOpen(false)}>
          <ModalPanel
            footer={<button type="button">最后操作</button>}
            onClose={() => setOpen(false)}
            title="主弹窗"
          >
            <input autoFocus aria-label="金额" />
            <button type="button" onClick={() => setNestedOpen(true)}>选择日期</button>
          </ModalPanel>
        </ModalBackdrop>
      ) : null}
      {nestedOpen ? (
        <ModalBackdrop className="date-picker-layer" onClose={() => setNestedOpen(false)}>
          <ModalPanel
            onClose={() => setNestedOpen(false)}
            title="日期弹窗"
            variant="date-picker"
          >
            <button type="button">选择今天</button>
          </ModalPanel>
        </ModalBackdrop>
      ) : null}
    </>
  );
}

it("closes on the backdrop or Escape, but not inside content or while busy", () => {
  const onClose = vi.fn();
  const originalOverflow = document.body.style.overflow;
  const { container, rerender, unmount } = render(
    <ModalBackdrop onClose={onClose}>
      <section role="dialog">弹窗内容</section>
    </ModalBackdrop>,
  );
  const backdrop = container.querySelector("[data-modal-backdrop]");

  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(container.querySelector('[role="dialog"]'));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);

  rerender(
    <ModalBackdrop onClose={onClose} closeDisabled>
      <section role="dialog">处理中</section>
    </ModalBackdrop>,
  );
  fireEvent.click(backdrop);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);

  unmount();
  expect(document.body.style.overflow).toBe(originalOverflow);
});

it("keeps the close control and actions outside the independently scrolling dialog body", () => {
  const onClose = vi.fn();
  const { container } = render(
    <ModalPanel
      eyebrow="测试弹窗"
      footer={(
        <DialogActions>
          <DialogAction>取消</DialogAction>
          <DialogAction variant="primary">保存</DialogAction>
        </DialogActions>
      )}
      onClose={onClose}
      title="长内容"
    >
      <div style={{ height: 1200 }}>滚动内容</div>
    </ModalPanel>,
  );
  const panel = screen.getByRole("dialog");
  const header = panel.querySelector(".dialog-panel-header");
  const body = panel.querySelector(".dialog-panel-body");
  const footer = panel.querySelector(".dialog-panel-footer");
  const close = screen.getByRole("button", { name: "关闭" });

  expect(panel.children[0]).toBe(header);
  expect(panel.children[1]).toBe(body);
  expect(panel.children[2]).toBe(footer);
  body.scrollTop = 900;
  fireEvent.scroll(body);
  expect(close.closest(".dialog-panel-header")).toBe(header);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledOnce();
  expect(container.querySelector(".dialog-panel-body .dialog-panel-footer")).toBeNull();
});

it("traps focus, restores the trigger and lets only the topmost modal handle Escape", () => {
  render(<FocusHarness />);
  const trigger = screen.getByRole("button", { name: "打开弹窗" });
  trigger.focus();
  fireEvent.click(trigger);

  const amount = screen.getByRole("textbox", { name: "金额" });
  const mainDialog = screen.getByRole("dialog", { name: "主弹窗" });
  const close = mainDialog.querySelector(".modal-close");
  const lastAction = screen.getByRole("button", { name: "最后操作" });
  expect(document.activeElement).toBe(amount);

  close.focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(lastAction);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(close);

  const nestedTrigger = screen.getByRole("button", { name: "选择日期" });
  nestedTrigger.focus();
  fireEvent.click(nestedTrigger);
  expect(screen.getByRole("dialog", { name: "日期弹窗" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "日期弹窗" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "主弹窗" })).toBeTruthy();
  expect(document.activeElement).toBe(nestedTrigger);

  fireEvent.click(close);
  expect(screen.queryByRole("dialog", { name: "主弹窗" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("routes the native Android back action through the topmost modal first", async () => {
  render(<FocusHarness />);
  fireEvent.click(screen.getByRole("button", { name: "打开弹窗" }));
  fireEvent.click(screen.getByRole("button", { name: "选择日期" }));

  await waitFor(() => expect(nativeBack.listeners.size).toBe(1));
  await act(async () => nativeBack.press());
  expect(screen.queryByRole("dialog", { name: "日期弹窗" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "主弹窗" })).toBeTruthy();

  await act(async () => nativeBack.press());
  expect(screen.queryByRole("dialog", { name: "主弹窗" })).toBeNull();
  await waitFor(() => expect(nativeBack.listeners.size).toBe(0));
});

it("routes every application dialog through the shared backdrop and panel", () => {
  const paths = [
    "./App.jsx",
    "./components/BackupDialog.jsx",
    "./components/FamilyDialog.jsx",
    "./components/InvestmentCashDialog.jsx",
    "./components/PlanSetupDialog.jsx",
    "./components/ReversalDialog.jsx",
    "./components/StatementImportDialog.jsx",
  ];
  const sources = paths.map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

  sources.forEach((source) => {
    expect(source).toMatch(/ModalBackdrop/);
    expect(source).toMatch(/ModalPanel/);
  });
  expect(sources.join("\n")).not.toMatch(/<div[^>]+className="modal-backdrop"/);
  expect(sources.join("\n")).not.toMatch(/<section[^>]+className="(?:modal-card|date-picker-card)/);
  expect(sources.join("\n")).not.toMatch(/className="(?:modal-title|date-picker-title)"/);
});

it("uses one equal-width action model for two- and three-button dialogs", () => {
  const { rerender } = render(
    <DialogActions>
      <DialogAction variant="primary">保存</DialogAction>
      <DialogAction>取消</DialogAction>
    </DialogActions>,
  );
  expect(screen.getByText("保存").parentElement.className).toContain("action-count-2");

  rerender(
    <DialogActions>
      <DialogAction variant="primary">完成</DialogAction>
      <DialogAction>再记一笔</DialogAction>
      <DialogAction>取消</DialogAction>
    </DialogActions>,
  );
  expect(screen.getByText("完成").parentElement.className).toContain("action-count-3");
  screen.getAllByRole("button").forEach((button) => {
    expect(button.className).toContain("dialog-action-button");
  });
});
