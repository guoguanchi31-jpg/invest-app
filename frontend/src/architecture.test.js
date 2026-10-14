import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";


const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const financeDataSource = readFileSync(
  new URL("./app/useFinanceData.js", import.meta.url),
  "utf8",
);
const viteSource = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));


describe("frontend feature boundaries", () => {
  it("keeps session and server-data lifecycles outside the app shell", () => {
    expect(appSource).toContain("useSession()");
    expect(appSource).toContain("useFinanceData({");
    expect((appSource.match(/useState\(/g) || []).length).toBeLessThanOrEqual(35);
  });

  it("uses page-specific view contracts instead of one universal prop bag", () => {
    expect(appSource).toContain("const pageViews = {");
    expect(appSource).toContain("const pageView = pageViews[activePage]");
    expect(appSource).not.toContain("transactionData");
  });

  it("does not retain superseded income and expense page implementations", () => {
    expect(existsSync(new URL("./pages/IncomePage.jsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("./pages/ExpensePage.jsx", import.meta.url))).toBe(false);
  });

  it("keeps each main feature's server state behind its own hook", () => {
    for (const path of [
      "./features/accounts/useAccountsData.js",
      "./features/budget/useBudgetData.js",
      "./features/dashboard/useDashboardData.js",
      "./features/family/useReferenceData.js",
      "./features/goals/useGoalsData.js",
      "./features/investments/useInvestmentData.js",
      "./features/ledger/useLedgerAnalysisData.js",
    ]) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(true);
    }
    expect(financeDataSource).not.toContain("fetchJson(");
  });

  it("keeps business writes and form state outside the app shell", () => {
    for (const path of [
      "./features/accounts/actions.js",
      "./features/budget/actions.js",
      "./features/goals/actions.js",
      "./features/investments/actions.js",
      "./features/ledger/actions.js",
      "./app/useActionWorkspace.js",
      "./features/shared/useSubmission.js",
    ]) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(true);
    }
    for (const transport of [
      "fetchJson(",
      "postJson(",
      "patchJson(",
      "deleteJson(",
      "downloadFile(",
    ]) {
      expect(appSource).not.toContain(transport);
    }
  });

  it("keeps shared lifecycle modules independent of feature dispatch and app composition", () => {
    const shared = new URL("./features/shared/", import.meta.url);
    for (const file of readdirSync(shared).filter((name) => !name.includes(".test."))) {
      const source = readFileSync(new URL(file, shared), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)];
      for (const [, specifier] of imports) {
        if (!specifier.startsWith(".")) continue;
        const target = new URL(specifier, new URL(file, shared)).pathname;
        expect(target).not.toContain("/src/app/");
        if (target.includes("/src/features/")) expect(target).toContain("/src/features/shared/");
      }
    }
    for (const feature of ["accounts", "ledger", "investments", "goals"]) {
      expect(existsSync(new URL(`./features/${feature}/drafts.js`, import.meta.url))).toBe(true);
    }
  });

  it("only includes the simulator in an explicit simulator build", () => {
    expect(viteSource).toContain("VITE_INCLUDE_SIMULATOR");
    expect(viteSource).toContain(": fileURLToPath(new URL('./index.html'");
    expect(packageJson.scripts.simulator).toContain("VITE_INCLUDE_SIMULATOR=1");
    expect(packageJson.scripts.simulator).toContain("--open /simulator.html");
    expect(viteSource).toContain("'/api':");
    expect(viteSource).toContain("target: 'http://127.0.0.1:8000'");
  });
});
