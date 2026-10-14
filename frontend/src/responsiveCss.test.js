import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

function blocksStartingWith(prefix) {
  const blocks = [];
  let cursor = 0;
  while (cursor < css.length) {
    const start = css.indexOf(prefix, cursor);
    if (start === -1) break;
    const opening = css.indexOf("{", start);
    let depth = 1;
    let end = opening + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
      end += 1;
    }
    blocks.push(css.slice(start, end));
    cursor = end;
  }
  return blocks;
}

describe("responsive CSS ownership", () => {
  it("keeps section tabs on one line and overview selectors in the shared filter style", () => {
    expect(css).toMatch(/\.section-tabs\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.section-tabs button\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ledger-overview-controls \.filter-field select\s*\{[^}]*min-height:\s*42px/);
    const overview = readFileSync(
      new URL("./features/ledger/LedgerMonthlyOverview.jsx", import.meta.url), "utf8",
    );
    expect(overview.match(/<label className="filter-field">/g)).toHaveLength(2);
    expect(overview).toContain('className="segmented ledger-overview-mode"');
    expect(css).toMatch(
      /\.ledger-overview-mode\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.ledger-overview-controls \.ledger-overview-mode button\.active\s*\{[^}]*background:\s*var\(--green\);[^}]*color:\s*#ffffff/,
    );
    const phone = blocksStartingWith("@media (max-width: 620px)").join("\n");
    expect(phone).toMatch(
      /\.ledger-overview-controls > \.segmented\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0/,
    );
  });

  it("keeps ledger responsive layout exclusively in ledger container queries", () => {
    const forbidden = /\.(ledger-row|ledger-source|ledger-secondary|ledger-filter-summary|compact-filter-panel--ledger|analysis-category-list)\b/;
    blocksStartingWith("@media").forEach((block) => expect(block).not.toMatch(forbidden));

    const ledgerContainers = blocksStartingWith("@container ledger-panel").join("\n");
    expect(css).toMatch(/\.ledger-analysis-panel\s*\{[^}]*container:\s*ledger-panel \/ inline-size;/);
    expect(ledgerContainers).toMatch(/\.compact-filter-panel--ledger/);
    expect(ledgerContainers).toMatch(/\.compact-filter-toggle/);
    expect(ledgerContainers).toMatch(/\.is-expanded \.compact-filter-controls/);
    expect(ledgerContainers).toMatch(/\.ledger-row/);
    expect(ledgerContainers).toMatch(/\.ledger-secondary/);
    expect(ledgerContainers).toMatch(/\.ledger-tail\s*\{[^}]*grid-area:\s*tail/);
    expect(ledgerContainers).toMatch(
      /\.ledger-summary-values\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(ledgerContainers).toMatch(
      /\.analysis-category-list button\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 72px 42px;[^}]*column-gap:\s*8px/,
    );
    expect(ledgerContainers).toMatch(
      /\.analysis-category-list button\s*\{[^}]*grid-template-columns:\s*minmax\(90px,\s*1fr\) minmax\(100px,\s*1fr\) 110px 50px/,
    );
    expect(ledgerContainers).not.toMatch(
      /\.analysis-category-list button\s*\{[^}]*grid-template-columns:[^;}]*auto auto/,
    );
    expect(css).toMatch(
      /\.analysis-category-list b,\s*\.analysis-category-list small\s*\{[^}]*font-variant-numeric:\s*tabular-nums;[^}]*text-align:\s*right;[^}]*white-space:\s*nowrap/,
    );
    expect(css).toMatch(/\.ledger-amount\.voided\s*\{[^}]*text-decoration:\s*line-through/);
    expect(css).toMatch(/\.ledger-row\.is-voided\s*\{/);
    expect(css).toMatch(
      /\.ledger-main \.ledger-transfer-meta-compact\s*\{[^}]*display:\s*none/,
    );
    expect(ledgerContainers).toMatch(
      /\.ledger-main \.ledger-transfer-meta-full\s*\{[^}]*display:\s*none/,
    );
    expect(ledgerContainers).toMatch(
      /\.ledger-main \.ledger-transfer-meta-compact\s*\{[^}]*display:\s*block/,
    );
  });

  it("collapses detailed income and expense filters within their own panel", () => {
    const forbidden = /\.compact-filter-panel--payment\b/;
    blocksStartingWith("@media").forEach((block) => expect(block).not.toMatch(forbidden));

    const paymentContainers = blocksStartingWith("@container payment-panel").join("\n");
    expect(paymentContainers).toMatch(/\.compact-filter-panel--payment/);
    expect(paymentContainers).toMatch(/\.compact-filter-toggle/);
    expect(paymentContainers).toMatch(/\.is-expanded \.compact-filter-controls/);
  });

  it("keeps credit and budget table layout out of viewport media queries", () => {
    const forbidden = /\.(credit-table|credit-head|credit-row|budget-table|budget-head|budget-row)\b/;
    blocksStartingWith("@media").forEach((block) => expect(block).not.toMatch(forbidden));

    expect(blocksStartingWith("@container credit-panel").join("\n")).toMatch(/\.credit-row/);
    const budgetContainers = blocksStartingWith("@container budget-panel").join("\n");
    expect(budgetContainers).toMatch(/\.budget-row/);
    expect(budgetContainers).toMatch(/\.budget-limit/);
    expect(budgetContainers).toMatch(/\.budget-change-state/);
  });

  it("keeps the account page and asset cards intrinsically responsive", () => {
    const forbidden = /\.(account-page|asset-account-grid|credit-panel|distribution-panel)\b/;
    blocksStartingWith("@media").forEach((block) => expect(block).not.toMatch(forbidden));

    expect(css).toMatch(/\.account-page\s*\{[^}]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*420px\),\s*1fr\)\)/);
    const accountContainers = blocksStartingWith("@container account-owner").join("\n");
    expect(accountContainers).toMatch(/\.asset-account-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(accountContainers).toMatch(/\.account-card\s*\{/);
  });

  it("keeps holding tools and metrics owned by the holdings container", () => {
    const forbidden = /\.(holdings-panel-title|holdings-toolbar)\b/;
    blocksStartingWith("@media").forEach((block) => expect(block).not.toMatch(forbidden));

    expect(css).toMatch(/\.holdings-table-panel\s*\{[^}]*container:\s*holdings-panel \/ inline-size;/);
    expect(css).toMatch(/\.investment-identity\s*\{[^}]*display:\s*contents;/);
    expect(css).toMatch(/\.holding-list-summary\s*\{[^}]*display:\s*none;/);
    const collapsedHoldings = blocksStartingWith("@container holdings-panel (max-width: 1040px)").join("\n");
    expect(collapsedHoldings).toMatch(
      /\.investment-row\s*\{[^}]*display:\s*block;[^}]*min-height:\s*0;[^}]*padding:\s*0;/,
    );
    expect(collapsedHoldings).toMatch(
      /\.holding-list-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto 20px;/,
    );
    expect(collapsedHoldings).toMatch(
      /\.investment-row > \.investment-identity,[\s\S]*\.investment-row > \.readonly-label\s*\{[^}]*display:\s*none;/,
    );
    const compactHoldings = blocksStartingWith("@container holdings-panel (max-width: 580px)").join("\n");
    expect(compactHoldings).toMatch(
      /\.holdings-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(160px,\s*1\.35fr\) repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    const narrowHoldings = blocksStartingWith("@container holdings-panel (max-width: 400px)").join("\n");
    expect(narrowHoldings).toMatch(
      /\.holdings-toolbar \.segmented\s*\{[^}]*grid-column:\s*1 \/ -1;/,
    );
    expect(css).toMatch(/\.holding-detail-dialog\s*\{[^}]*width:\s*min\(620px,\s*100%\)/);
  });

  it("uses an intrinsic donut layout and balanced trade history header", () => {
    expect(css).toMatch(
      /\.allocation-panel\s*\{[^}]*container:\s*allocation-panel\s*\/\s*inline-size;/,
    );
    expect(css).toMatch(
      /\.allocation-chart-layout\s*\{[^}]*grid-template-columns:\s*minmax\(210px,\s*0\.95fr\) minmax\(170px,\s*1\.05fr\)/,
    );
    const allocationContainers = blocksStartingWith("@container allocation-panel").join("\n");
    expect(allocationContainers).toMatch(
      /\.allocation-chart-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/\.allocation-legend-row\s*\{[^}]*grid-template-columns:\s*9px minmax\(0,\s*1fr\) auto/);
    expect(css).toMatch(
      /\.trade-history-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(190px,\s*220px\)/,
    );
    expect(css).toMatch(/\.trade-history-filter\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*190px/);
    expect(css).toMatch(
      /\.trade-history-filter select\.filter-button\s*\{[^}]*height:\s*48px;[^}]*border-radius:\s*var\(--radius-control\);[^}]*font-size:\s*13px/,
    );
    expect(css).toMatch(/\.trade-history-panel \.empty-state\s*\{[^}]*min-height:\s*68px/);
  });

  it("uses one content-independent column model for each table header and its rows", () => {
    const creditColumns = css.match(/--credit-columns:\s*([^;]+);/)?.[1] ?? "";
    const budgetColumns = css.match(/--budget-columns:\s*([^;]+);/)?.[1] ?? "";

    expect(css.match(/--credit-columns:/g)).toHaveLength(1);
    expect(css).toMatch(/\.credit-table\s*\{[^}]*--credit-columns:[^;}]+;/);
    expect(css).toMatch(/\.credit-head,\s*\.credit-row\s*\{[^}]*grid-template-columns:\s*var\(--credit-columns\)/);
    expect(creditColumns).not.toMatch(/\bauto\b/);
    expect(css.match(/--budget-columns:/g)).toHaveLength(1);
    expect(css).toMatch(/\.budget-table\s*\{[^}]*--budget-columns:[^;}]+;/);
    expect(css).toMatch(/\.budget-head,\s*\.budget-row\s*\{[^}]*grid-template-columns:\s*var\(--budget-columns\)/);
    expect(budgetColumns).not.toMatch(/\bauto\b/);
  });

  it("keeps the budget pace label in flow and the track marker text-free", () => {
    expect(css).toMatch(/\.budget-master-meta\s*\{/);
    expect(css).toMatch(/\.budget-master-track i\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;/);
    expect(css).not.toMatch(/\.budget-master-track i\s*\{[^}]*font-size:/);
  });

  it("keeps monthly member budget controls responsive inside the budget dialog", () => {
    expect(css).toMatch(/\.budget-member-allocation-row\s*\{[^}]*grid-template-columns:\s*minmax\(100px,\s*1fr\) auto minmax\(150px,\s*210px\)/);
    const mobile = blocksStartingWith("@media (max-width: 640px)").join("\n");
    expect(mobile).toMatch(/\.budget-member-allocation-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
    expect(mobile).toMatch(/\.budget-member-allocation-row input\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%/);
  });

  it("keeps both guest access actions on one line without forcing overflow", () => {
    expect(css).toMatch(/\.guest-access-banner \.filter-button\s*\{[^}]*white-space:\s*nowrap/);
    const mobile = blocksStartingWith("@media screen and (max-width: 760px)").join("\n");
    expect(mobile).toMatch(/\.guest-access-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobile).toMatch(/\.guest-access-banner \.filter-button\s*\{[^}]*min-width:\s*0;[^}]*font-size:\s*12px;[^}]*white-space:\s*nowrap/);
  });

  it("keeps every dialog exit visible while only the middle body scrolls", () => {
    expect(css).toMatch(/\.modal-card\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.date-picker-card\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.dialog-panel-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.dialog-panel-header\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/\.dialog-panel-footer\s*\{[^}]*padding:/);
    expect(css).toMatch(/max-height:\s*min\(calc\(100dvh - 48px\),\s*780px\)/);
    expect(css).toMatch(/env\(safe-area-inset-top\)/);
    expect(css).toMatch(/\.import-review-list\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/);
    expect(css).toMatch(/\.app-download-dialog\s*\{[^}]*width:\s*min\(440px,\s*100%\)/);
    expect(css).toMatch(/\.app-download-qr\s*\{[^}]*width:\s*min\(248px,\s*100%\);[^}]*aspect-ratio:\s*1/);
    expect(css).toMatch(/\.app-download-dialog \.dialog-action-bar\s*\{[^}]*margin-inline:\s*auto/);
  });

  it("uses a stable calendar grid and compact date presets across viewports", () => {
    expect(css).toMatch(
      /\.date-range-filter-trigger\s*\{[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\) 15px;[^}]*background:\s*var\(--panel\)/,
    );
    expect(css).toMatch(
      /\.date-range-filter-trigger:hover,\s*\.date-range-filter-trigger\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--panel\)/,
    );
    expect(css).toMatch(/\.date-range-presets\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.date-range-weekdays,\s*\.date-range-days\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
    const mobile = blocksStartingWith("@media (max-width: 640px)").join("\n");
    expect(mobile).toMatch(/\.date-range-presets\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobile).toMatch(/\.date-range-days button\s*\{[^}]*min-height:\s*44px/);
  });

  it("keeps the App transaction composer stable in portrait and landscape", () => {
    expect(css).toMatch(
      /\.app-transaction-dialog\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-height:\s*none;[^}]*border-radius:\s*0/,
    );
    expect(css).toMatch(
      /\.app-transaction-category-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.app-transaction-keypad\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.app-transaction-amount strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums;[^}]*white-space:\s*nowrap/,
    );
    const landscape = blocksStartingWith(
      "@media (orientation: landscape) and (max-height: 560px)",
    ).join("\n");
    expect(landscape).toMatch(
      /\.app-transaction-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(340px,\s*43%\)/,
    );
    expect(landscape).toMatch(
      /\.app-transaction-dialog \.dialog-panel-footer\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2/,
    );
    expect(css).toMatch(
      /\.app-transfer-amount-targets\s*\{[^}]*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.app-goal-record-target\s*\{[^}]*grid-template-columns:\s*42px minmax\(0,\s*1fr\) auto/,
    );
    expect(css).toMatch(
      /\.app-action-dialog\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-height:\s*none;[^}]*border-radius:\s*0/,
    );
    expect(css).toMatch(
      /\.app-action-dialog\s*\{[^}]*--app-editor-scroll-reserve:\s*min\(var\(--dialog-footer-height,\s*0px\),\s*42dvh\)/,
    );
    expect(css).toMatch(
      /\.app-action-dialog \.dialog-panel-body\s*\{[^}]*padding:[^}]*scroll-padding-block:[^}]*var\(--app-editor-scroll-reserve\)/,
    );
    expect(css).toMatch(
      /\.app-transaction-dialog \.dialog-panel-body::after,\s*\.app-action-dialog \.dialog-panel-body::after\s*\{[^}]*block-size:\s*var\(--app-editor-scroll-reserve\)/,
    );
    expect(css).toMatch(
      /\.app-transaction-dialog\s*\{[^}]*--app-editor-scroll-reserve:\s*min\(var\(--dialog-footer-height,\s*0px\),\s*42dvh\)/,
    );
    expect(css).toMatch(
      /\.app-field-number-keypad\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(4,\s*minmax\(44px,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.app-field-number-keypad \.submit-key\s*\{[^}]*grid-area:\s*3 \/ 4 \/ span 2 \/ 5;[^}]*background:\s*var\(--green\)/,
    );
    expect(css).toMatch(
      /\.app-plan-dialog \.app-number-field-input\.is-active\s*\{[^}]*border-color:\s*var\(--green\)/,
    );
    const mobile = blocksStartingWith("@media (max-width: 640px)").join("\n");
    expect(mobile).toMatch(
      /\.app-action-dialog \.quick-add\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(mobile).toMatch(
      /\.budget-member-allocation-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
    );
    expect(landscape).toMatch(
      /\.app-complex-action-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(340px,\s*43%\)/,
    );
    expect(landscape).toMatch(
      /\.app-plan-dialog \.dialog-panel-footer\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2/,
    );
    expect(landscape).toMatch(
      /\.app-transaction-dialog,\s*\.app-action-dialog\s*\{[^}]*--app-editor-scroll-reserve:\s*0px/,
    );
  });

  it("keeps family goal fields labeled and dialog actions equal-sized on phones", () => {
    expect(css).toMatch(/\.goal-allocation-field > span\s*\{[^}]*font-size:\s*10px/);
    expect(css).toMatch(/\.modal-actions\.dialog-action-bar\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.modal-actions\.dialog-action-bar\.action-count-3\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.dialog-action-bar > \.dialog-action-button\s*\{[^}]*width:\s*100%;[^}]*height:\s*46px/);

    const mobile = blocksStartingWith("@media (max-width: 640px)").join("\n");
    expect(mobile).toMatch(/\.goal-member-allocation-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobile).toMatch(/\.goal-member-allocation-row \.goal-allocation-field:last-child\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(mobile).not.toMatch(/\.goal-member-allocation-head\s*\{[^}]*display:\s*none/);
  });

  it("keeps modals above mobile navigation and the floating record action", () => {
    const modalZ = Number(css.match(/\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/)?.[1] || 0);
    const pickerZ = Number(css.match(/\.date-picker-layer\s*\{[^}]*z-index:\s*(\d+)/)?.[1] || 0);
    const mobileLayers = [...css.matchAll(/z-index:\s*(100|110)\s*;/g)].map((match) => Number(match[1]));
    expect(modalZ).toBeGreaterThan(Math.max(...mobileLayers));
    expect(pickerZ).toBeGreaterThan(modalZ);
  });

  it("centers the only visible child inside the mobile record action", () => {
    const mobile = blocksStartingWith("@media (max-width: 760px)").join("\n");
    expect(mobile).toMatch(/\.sidebar nav\s*\{[^}]*padding-right:\s*64px/);
    expect(mobile).toMatch(/\.top-actions \.record-button\s*\{[^}]*bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
    expect([...css.matchAll(/\.top-actions \.record-button\s*\{[^}]*bottom:/g)]).toHaveLength(1);
    expect(mobile).toMatch(
      /\.top-actions \.record-button\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*gap:\s*0;/,
    );
    expect(mobile).toMatch(
      /\.top-actions \.record-button-label\s*\{[^}]*display:\s*none;/,
    );
    expect(mobile).toMatch(
      /\.top-actions \.record-button svg\s*\{[^}]*display:\s*block;/,
    );
    expect(mobile).not.toMatch(
      /\.top-actions \.record-button\s*\{[^}]*font-size:\s*0;/,
    );
  });

  it("moves intermediate topbar actions below a single-line page title", () => {
    const intermediate = blocksStartingWith("@media (max-width: 900px)").join("\n");
    expect(intermediate).toMatch(/\.topbar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(intermediate).toMatch(/\.topbar h1\s*\{[^}]*white-space:\s*nowrap/);
    expect(intermediate).toMatch(/\.top-actions\s*\{[^}]*width:\s*100%/);
  });

  it("lets the available ledger utilities fill the row evenly on narrow screens", () => {
    expect(css).toMatch(
      /\.ledger-page-actions > \.filter-button\s*\{[^}]*min-height:\s*38px;[^}]*border-radius:\s*8px;/,
    );
    const mobile = blocksStartingWith("@media (max-width: 760px)").join("\n");
    expect(mobile).toMatch(
      /\.section-toolbar \.ledger-page-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\);[^}]*gap:\s*8px;/,
    );
    expect(mobile).toMatch(
      /\.section-toolbar \.ledger-page-actions > \.filter-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*44px;/,
    );
    expect(blocksStartingWith("@media (max-width: 520px)").join("\n")).toMatch(
      /\.section-toolbar \.ledger-page-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(css).not.toMatch(/\.import-button\b/);
  });

  it("keeps expanded audit tables contained on narrow screens", () => {
    expect(css).toMatch(/\.audit-details table\s*\{[^}]*width:\s*100%;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.audit-details th,\s*\.audit-details td\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.audit-details\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/);
  });

  it("uses a compact, two-column information hierarchy below the sidebar breakpoint", () => {
    const mobile = blocksStartingWith("@media (max-width: 760px)").join("\n");
    const largerScreens = blocksStartingWith("@media (min-width: 761px)").join("\n");

    expect(css).toMatch(/\.metric-card\s*\{[^}]*flex-direction:\s*column;[^}]*justify-content:\s*flex-start;/);
    expect(css).toMatch(
      /\.metric-card strong\s*\{[^}]*--metric-value-min-font-size:\s*15px;[^}]*white-space:\s*nowrap;[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/,
    );
    expect(largerScreens).toMatch(/\.metric-card\s*\{[^}]*min-height:\s*104px;/);
    expect(mobile).toMatch(
      /\.summary-grid,[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*170px\),\s*1fr\)\)/,
    );
    expect(mobile).toMatch(/\.summary-grid > \.metric-card:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(mobile).toMatch(/\.metric-card\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*13px 12px/);
    expect(mobile).toMatch(/\.panel,[\s\S]*\.placeholder-card\s*\{[^}]*padding:\s*16px/);
    expect(mobile).toMatch(/\.investment-grid,[\s\S]*\.expense-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(mobile).toMatch(/\.chart-panel,[\s\S]*\.goal-plan-panel\s*\{[^}]*min-height:\s*0/);

    const accountContainers = blocksStartingWith("@container account-owner").join("\n");
    expect(accountContainers).toMatch(/\.account-card\s*\{[^}]*min-height:\s*92px;[^}]*padding:\s*13px 14px/);
  });

  it("keeps dashboard cards balanced across intermediate and wide desktops", () => {
    const intermediate = blocksStartingWith(
      "@media (min-width: 901px) and (max-width: 1180px)",
    ).join("\n");
    const wide = blocksStartingWith("@media (min-width: 1181px)").join("\n");

    expect(intermediate).toMatch(
      /\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*align-items:\s*start/,
    );
    expect(intermediate).toMatch(
      /\.dashboard-grid \.chart-panel\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1/,
    );
    expect(wide).toMatch(
      /\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*7fr\) minmax\(360px,\s*5fr\);[^}]*align-items:\s*stretch/,
    );
    expect(wide).toMatch(
      /\.dashboard-stack\s*\{[^}]*display:\s*grid;[^}]*height:\s*100%;[^}]*align-content:\s*stretch;[^}]*gap:\s*14px/,
    );
    expect(wide).toMatch(
      /\.dashboard-stack-primary\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/,
    );
    expect(wide).toMatch(
      /\.dashboard-wide-panel\s*\{[^}]*grid-column:\s*1 \/ -1/,
    );
    const dashboardPage = readFileSync(
      new URL("./pages/DashboardPage.jsx", import.meta.url),
      "utf8",
    );
    const primary = dashboardPage.indexOf("dashboard-stack dashboard-stack-primary");
    const goal = dashboardPage.indexOf('className="panel goal-panel"');
    const secondary = dashboardPage.indexOf("dashboard-stack dashboard-stack-secondary");
    const transaction = dashboardPage.indexOf('className="panel transaction-panel"');
    const budget = dashboardPage.indexOf('className="panel budget-panel dashboard-wide-panel"');
    expect(primary).toBeLessThan(goal);
    expect(goal).toBeLessThan(secondary);
    expect(secondary).toBeLessThan(transaction);
    expect(transaction).toBeLessThan(budget);
  });

  it("keeps every three-metric summary equal without an orphaned wide card", () => {
    const compactTablet = blocksStartingWith(
      "@media (min-width: 560px) and (max-width: 760px)",
    ).join("\n");
    const narrowDesktop = blocksStartingWith(
      "@media (min-width: 761px) and (max-width: 900px)",
    ).join("\n");
    const narrowPhone = blocksStartingWith("@media (max-width: 559px)").join("\n");

    expect(css).toMatch(
      /\.summary-grid--three\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(compactTablet).toMatch(
      /\.summary-grid--three\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(compactTablet).toMatch(
      /\.summary-grid--three > \.metric-card:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*auto/,
    );
    expect(narrowDesktop).toMatch(
      /\.summary-grid--three\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(narrowPhone).toMatch(
      /\.summary-grid--three\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(narrowPhone).toMatch(
      /\.summary-grid--three > \.metric-card:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*auto/,
    );
    [
      "./pages/AccountsPage.jsx",
      "./pages/BudgetPage.jsx",
      "./pages/GoalsPage.jsx",
      "./pages/LedgerPage.jsx",
    ].forEach((path) => {
      expect(readFileSync(new URL(path, import.meta.url), "utf8"))
        .toContain("summary-grid summary-grid--three");
    });
    expect(readFileSync(new URL("./app/GuestPreview.jsx", import.meta.url), "utf8"))
      .toContain('items.length === 3 ? " summary-grid--three"');
  });

  it("uses one continuous navigation breakpoint without the former 520px cliff", () => {
    expect(css.match(/@media \(max-width: 760px\)/g)).toHaveLength(3);
    expect(css).toContain("@media (min-width: 761px)");
    const narrowRules = [
      ...blocksStartingWith("@media (max-width: 520px)"),
      ...blocksStartingWith("@media (min-width: 521px)"),
    ].join("\n");
    expect(narrowRules).not.toMatch(/\.(sidebar|mobile-nav|topbar|app-shell|main-content|mobile-fab)\b/);
  });

  it("keeps secondary text readable and coarse-pointer controls touch sized", () => {
    expect(css).toMatch(/--muted:\s*#62706a/);
    expect(css).toMatch(/--row-control-height:\s*38px/);
    const coarsePointer = blocksStartingWith("@media (pointer: coarse)").join("\n");
    expect(coarsePointer).toMatch(/--row-control-height:\s*44px/);
    expect(coarsePointer).toMatch(/\.chart-range-switch button/);
    expect(coarsePointer).toMatch(/min-height:\s*44px/);
  });

  it("lets the dashboard budget card own its compact progress hierarchy", () => {
    const viewportRules = blocksStartingWith("@media").join("\n");
    const budgetCardContainers = blocksStartingWith("@container dashboard-budget").join("\n");

    expect(viewportRules).not.toMatch(/\.(budget-footer|budget-track)\b/);
    expect(css).toMatch(
      /\.budget-panel\s*\{[^}]*container:\s*dashboard-budget\s*\/\s*inline-size;/,
    );
    expect(css).toMatch(
      /\.budget-footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/,
    );
    expect(css).toMatch(/\.status-pill\s*\{[^}]*min-height:\s*28px;/);
    expect(css).toMatch(/\.budget-track\.is-over span\s*\{[^}]*background:\s*var\(--danger\)/);
    expect(budgetCardContainers).toMatch(/\.budget-footer\s*\{[^}]*font-size:\s*10px;/);
  });

  it("keeps the modern visual foundation explicit and motion accessible", () => {
    expect(css).toMatch(/--paper:\s*#f4f6f5/);
    expect(css).toMatch(/--panel:\s*#ffffff/);
    expect(css).toMatch(/--radius-panel:\s*12px/);
    expect(css).toMatch(/--focus-ring:\s*0 0 0 3px rgba\(23,\s*107,\s*77,\s*0\.18\)/);
    expect(css).toMatch(/\.login-card \.brand-wordmark\s*\{[^}]*color:\s*var\(--green\)/);
    expect(css).toMatch(
      /\.transaction-list \.transaction\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/,
    );
    expect(css).toMatch(
      /\.transaction-list \.transaction-secondary\s*\{[^}]*display:\s*flex;[^}]*gap:\s*7px;/,
    );
    expect(css).toMatch(/\.transaction-list \.transaction\.is-clickable\s*\{[^}]*cursor:\s*pointer;/);
    const reducedMotion = blocksStartingWith("@media (prefers-reduced-motion: reduce)").join("\n");
    expect(reducedMotion).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(reducedMotion).toMatch(/transition-duration:\s*0\.01ms !important/);
  });

  it("keeps goal status tabs as one equal three-column control", () => {
    expect(css).toMatch(
      /\.section-tabs\.goal-status-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[^}]*border-radius:\s*var\(--radius-control\)/,
    );
    expect(css).toMatch(
      /\.section-tabs\.goal-status-tabs button\s*\{[^}]*min-width:\s*0;[^}]*justify-content:\s*center;[^}]*white-space:\s*nowrap;/,
    );
    expect(css).toMatch(/\.goal-status-tabs b\s*\{[^}]*min-width:\s*20px;[^}]*height:\s*20px;/);
  });

  it("lets chart cards own their compact header layout", () => {
    const viewportRules = blocksStartingWith("@media").join("\n");
    const chartContainers = blocksStartingWith("@container chart-card").join("\n");

    expect(css).toMatch(
      /\.chart-panel,\s*\.investment-chart-panel,\s*\.goal-plan-panel\s*\{[^}]*container:\s*chart-card\s*\/\s*inline-size;/,
    );
    expect(viewportRules).not.toMatch(/\.chart-panel-title\b/);
    expect(chartContainers).toMatch(
      /\.chart-panel-title\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(chartContainers).toMatch(
      /\.chart-panel-title > \.chart-title-actions\s*\{[^}]*width:\s*100%;[^}]*margin-left:\s*0/,
    );
    expect(chartContainers).toMatch(
      /\.chart-panel-title \.chart-range-switch\s*\{[^}]*width:\s*100%;[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-auto-flow:\s*column/,
    );
  });

  it("keeps the filing links centered and wrapping at the bottom of the workspace", () => {
    expect(css).toMatch(
      /\.workspace\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*100vh;[^}]*flex-direction:\s*column/,
    );
    expect(css).toMatch(
      /\.site-footer\s*\{[^}]*margin-top:\s*auto;[^}]*text-align:\s*center/,
    );
    expect(css).toMatch(
      /\.site-footer-records\s*\{[^}]*justify-content:\s*center;[^}]*flex-wrap:\s*wrap/,
    );
    expect(css).toMatch(
      /\.site-footer a\s*\{[^}]*display:\s*inline-flex;[^}]*white-space:\s*nowrap/,
    );
    expect(css).toMatch(
      /\.site-footer-record-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*flex:\s*0 0 20px/,
    );
  });
});
