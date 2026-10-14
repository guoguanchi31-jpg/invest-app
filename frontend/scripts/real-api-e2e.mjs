/** Isolated real HTTP/browser regression. Never connects to an existing book. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const frontend = path.resolve(import.meta.dirname, "..");
const backend = path.resolve(frontend, "../backend");
const folder = mkdtempSync(path.join(frontend, ".e2e-tmp-"));
const artifacts = path.join(frontend, "test-results/real-api");
mkdirSync(artifacts, { recursive: true });
const children = [];
const descriptors = [];
const interrupted = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted.abort(new Error(`Real API regression interrupted by ${signal}`));
    for (const child of children) child.kill("SIGTERM");
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function launch(command, args, cwd, env, log) {
  const fd = openSync(path.join(artifacts, log), "w");
  descriptors.push(fd);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd] });
  child.on("error", (error) => { child.startError = error; });
  children.push(child);
  return child;
}

async function waitReady(child, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    interrupted.signal.throwIfAborted();
    if (child.startError) throw child.startError;
    if (child.exitCode !== null) throw new Error(`Test server exited: ${child.exitCode}; see ${artifacts}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Startup readiness polling; not an application request retry. */ }
    await delay(200);
  }
  throw new Error(`Test server did not become ready: ${url}; see ${artifacts}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

try {
  const apiSocket = await reservePort();
  const webSocket = await reservePort();
  const apiPort = apiSocket.address().port;
  const webPort = webSocket.address().port;
  await Promise.all([apiSocket, webSocket].map((socket) =>
    new Promise((resolve) => socket.close(resolve)),
  ));
  const apiURL = `http://127.0.0.1:${apiPort}`;
  const webURL = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    DATABASE_URL: "",
    DB_DIR: folder,
    APP_ENV: "development",
    APP_USERNAME: "admin",
    APP_PASSWORD: "123456",
    APP_USER_NAME: "测试管理员",
    APP_FAMILY_NAME: "浏览器回归家庭",
    APP_AUTH_SECRET: randomUUID() + randomUUID(),
    AUTO_MIGRATE_ON_STARTUP: "1",
    ENABLE_SNAPSHOT_SCHEDULER: "0",
    SEED_DEMO_DATA: "0",
    BUSINESS_TIMEZONE: "Asia/Shanghai",
    ALLOWED_ORIGINS: webURL,
    VITE_API_URL: apiURL,
    INVEST_REAL_E2E: "1",
    INVEST_E2E_API_URL: apiURL,
    INVEST_E2E_DB_DIR: folder,
    INVEST_E2E_BASE_URL: webURL,
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(artifacts, "report.json"),
  };
  const localPython = path.join(backend, "venv/bin/python");
  const python = process.env.INVEST_BACKEND_PYTHON || (existsSync(localPython) ? localPython : "python3");
  env.INVEST_BACKEND_PYTHON = python;
  const api = launch(python, [
    "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(apiPort),
  ], backend, env, "backend.log");
  const web = launch(process.execPath, [
    "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
    "--port", String(webPort), "--strictPort",
  ], frontend, env, "frontend.log");
  await Promise.all([waitReady(api, `${apiURL}/healthz`), waitReady(web, webURL)]);
  interrupted.signal.throwIfAborted();
  const browser = spawn(process.execPath, [
    "node_modules/@playwright/test/cli.js", "test", "--reporter=line,json", "--max-failures=1",
    "--output", path.join(artifacts, "browser"),
  ], { cwd: frontend, env, stdio: "inherit" });
  children.push(browser);
  const code = await new Promise((resolve, reject) => {
    browser.once("error", reject);
    browser.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Real browser tests failed (${code})`);
  const report = JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE, "utf8"));
  if (report.stats.skipped || report.stats.unexpected || report.stats.expected < 18) {
    throw new Error(`Real tests must execute all device workflows: ${JSON.stringify(report.stats)}`);
  }
  console.log(`Real API regression: ${report.stats.expected} passed, 0 skipped. Artifacts: ${artifacts}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(stop));
  for (const fd of descriptors) closeSync(fd);
  rmSync(folder, { recursive: true, force: true });
}
