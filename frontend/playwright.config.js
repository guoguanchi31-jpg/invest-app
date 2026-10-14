import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.INVEST_E2E_BASE_URL || "http://127.0.0.1:4173";
const externalServer = process.env.INVEST_REAL_E2E === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: externalServer ? "./test-results/real-api/browser" : "./test-results/mock-api",
  testMatch: externalServer ? "real-api.spec.js" : "app-smoke.spec.js",
  fullyParallel: !externalServer,
  workers: externalServer ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true,
        viewport: { width: 834, height: 1194 },
      },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalServer
    ? undefined
    : {
        command: "npm run dev:frontend -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
      },
});
