import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";


const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const backendDir = path.resolve(frontendDir, "..", "backend");
const localPython = path.join(backendDir, "venv", "bin", "python");
const viteEntry = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");

export const BACKEND_HEALTH_URL = "http://127.0.0.1:8000/healthz";


export async function isBackendHealthy({
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
  url = BACKEND_HEALTH_URL,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}


export function createBackendSupervisor({
  clearIntervalFn = clearInterval,
  clearTimeoutFn = clearTimeout,
  healthCheck = isBackendHealthy,
  logger = console,
  monitorIntervalMs = 3000,
  restartDelayMs = 1000,
  setIntervalFn = setInterval,
  setTimeoutFn = setTimeout,
  spawnBackend = () => spawn(
    process.env.INVEST_BACKEND_PYTHON
      || (existsSync(localPython) ? localPython : "python3"),
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        ENABLE_SNAPSHOT_SCHEDULER: process.env.ENABLE_SNAPSHOT_SCHEDULER || "0",
        PYTHONUNBUFFERED: "1",
      },
      stdio: "inherit",
    },
  ),
} = {}) {
  let backendProcess = null;
  let healthCheckPromise = null;
  let restartTimer = null;
  let stopped = false;

  const scheduleRestart = () => {
    if (stopped || restartTimer !== null) return;
    restartTimer = setTimeoutFn(() => {
      restartTimer = null;
      void ensureBackend();
    }, restartDelayMs);
  };

  const launchBackend = () => {
    if (stopped || backendProcess) return backendProcess;
    logger.info("[dev] Starting FastAPI on http://127.0.0.1:8000");
    const child = spawnBackend();
    backendProcess = child;
    let finished = false;
    const handleStopped = (reason) => {
      if (finished) return;
      finished = true;
      if (backendProcess === child) backendProcess = null;
      if (stopped) return;
      logger.error(`[dev] FastAPI ${reason}; restarting`);
      scheduleRestart();
    };
    child.once("error", (error) => {
      handleStopped(`failed to start (${error.message})`);
    });
    child.once("exit", (code, signal) => {
      handleStopped(`exited (${signal || code || "unknown"})`);
    });
    return child;
  };

  const ensureBackend = async () => {
    if (stopped || backendProcess) return backendProcess;
    if (healthCheckPromise) return healthCheckPromise;
    healthCheckPromise = (async () => {
      if (await healthCheck()) return null;
      return launchBackend();
    })();
    try {
      return await healthCheckPromise;
    } finally {
      healthCheckPromise = null;
    }
  };

  const monitor = setIntervalFn(() => {
    void ensureBackend();
  }, monitorIntervalMs);

  return {
    ensureBackend,
    getBackendProcess: () => backendProcess,
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(monitor);
      if (restartTimer !== null) clearTimeoutFn(restartTimer);
      if (backendProcess) backendProcess.kill("SIGTERM");
    },
  };
}


export function runDev(args = process.argv.slice(2)) {
  const superviseBackend = process.env.INVEST_SKIP_BACKEND !== "1";
  const supervisor = superviseBackend ? createBackendSupervisor() : null;
  if (supervisor) void supervisor.ensureBackend();

  const frontendProcess = spawn(process.execPath, [viteEntry, ...args], {
    cwd: frontendDir,
    env: process.env,
    stdio: "inherit",
  });
  let stopping = false;

  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    supervisor?.stop();
    if (frontendProcess.exitCode === null) frontendProcess.kill(signal);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  frontendProcess.once("exit", (code) => {
    supervisor?.stop();
    if (!stopping) process.exitCode = code ?? 1;
  });
  frontendProcess.once("error", (error) => {
    console.error(`[dev] Vite failed to start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });

  return { frontendProcess, supervisor, stop };
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDev();
}
