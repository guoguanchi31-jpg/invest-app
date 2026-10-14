import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { createBackendSupervisor, isBackendHealthy } from "./dev.mjs";


function fakeChild() {
  const child = new EventEmitter();
  child.kill = vi.fn();
  return child;
}


describe("local development backend supervisor", () => {
  it("does not start a duplicate backend when port 8000 is healthy", async () => {
    const spawnBackend = vi.fn();
    const supervisor = createBackendSupervisor({
      healthCheck: vi.fn().mockResolvedValue(true),
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
      spawnBackend,
    });

    await supervisor.ensureBackend();

    expect(spawnBackend).not.toHaveBeenCalled();
    supervisor.stop();
  });

  it("starts a missing backend and restarts it after an unexpected exit", async () => {
    const children = [fakeChild(), fakeChild()];
    const spawnBackend = vi.fn(() => children.shift());
    let restart;
    const supervisor = createBackendSupervisor({
      healthCheck: vi.fn().mockResolvedValue(false),
      logger: { info: vi.fn(), error: vi.fn() },
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
      setTimeoutFn: vi.fn((callback) => {
        restart = callback;
        return 2;
      }),
      clearTimeoutFn: vi.fn(),
      spawnBackend,
    });

    const first = await supervisor.ensureBackend();
    expect(spawnBackend).toHaveBeenCalledTimes(1);

    first.emit("exit", 1, null);
    restart();
    await vi.waitFor(() => expect(spawnBackend).toHaveBeenCalledTimes(2));

    supervisor.stop();
  });

  it("treats network failures as an unhealthy backend", async () => {
    await expect(isBackendHealthy({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("connection refused")),
    })).resolves.toBe(false);
  });

  it("retries when the backend executable cannot start", async () => {
    const children = [fakeChild(), fakeChild()];
    const spawnBackend = vi.fn(() => children.shift());
    let restart;
    const supervisor = createBackendSupervisor({
      healthCheck: vi.fn().mockResolvedValue(false),
      logger: { info: vi.fn(), error: vi.fn() },
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
      setTimeoutFn: vi.fn((callback) => {
        restart = callback;
        return 2;
      }),
      clearTimeoutFn: vi.fn(),
      spawnBackend,
    });

    const first = await supervisor.ensureBackend();
    first.emit("error", new Error("python missing"));
    restart();
    await vi.waitFor(() => expect(spawnBackend).toHaveBeenCalledTimes(2));

    supervisor.stop();
  });
});
