import { describe, expect, it } from "vitest";
import {
  buildLedgerRowPresentation,
  buildTransferDetail,
  ledgerRecordScope,
  ledgerResultCountLabel,
  ledgerSourceFilter,
  ledgerSummaryNote,
  matchesLedgerTypeFilter,
} from "./presentation";


const canEditAccount = (accountId) => Number(accountId) !== 9;


describe("ledger row presentation", () => {
  it("requires semantic evidence before labeling an unapplied record as historical", () => {
    const row = { source: "manual", direction: "expense", account_id: 1, balance_applied: 0 };
    expect(buildLedgerRowPresentation(row, canEditAccount)).toMatchObject({
      action: "review", statusLabel: "余额应用待核对",
    });
    expect(buildLedgerRowPresentation({
      ...row, application: { marker_consistent: false },
    }, canEditAccount)).toMatchObject({ action: "review", rowTone: "review" });
    expect(buildLedgerRowPresentation({
      ...row, application: { marker_consistent: true, expected_balance_applied: false },
    }, canEditAccount)).toMatchObject({
      action: "edit", statusLabel: "历史补录",
    });
    expect(buildLedgerRowPresentation({
      ...row, application: { marker_consistent: false }, voided_at: "2026-09-28",
    }, canEditAccount)).toMatchObject({ action: "readonly", statusLabel: "已撤销" });
  });

  it("hides audit-only records from the default view without losing explicit filters", () => {
    const adjustment = { source: "adjustment" };
    const voided = { source: "transfer", voided_at: "2026-09-25" };
    const activeTransfer = { source: "transfer", voided_at: null };

    expect(matchesLedgerTypeFilter(adjustment, "all")).toBe(false);
    expect(matchesLedgerTypeFilter(voided, "all")).toBe(false);
    expect(matchesLedgerTypeFilter(activeTransfer, "all")).toBe(true);
    expect(matchesLedgerTypeFilter(adjustment, "all_records")).toBe(true);
    expect(matchesLedgerTypeFilter(voided, "voided")).toBe(true);
    expect(ledgerRecordScope("all")).toBe("effective");
    expect(ledgerRecordScope("all_records")).toBe("all_records");
    expect(ledgerRecordScope("voided")).toBe("voided");
    expect(ledgerSourceFilter("adjustment")).toBe("adjustment");
    expect(ledgerSummaryNote("all", { other: 1 }, 3)).toContain("不计入收入、支出与结余");
    expect(ledgerResultCountLabel("all", { other: 1 }, 9))
      .toBe("筛选结果 · 收支 8 笔 · 划转 1 笔");
  });

  it("maps effective cashflow records to signed editable amounts", () => {
    expect(buildLedgerRowPresentation({
      source: "manual",
      direction: "income",
      account_id: 1,
      category_name: "工资",
      balance_applied: 1,
    }, canEditAccount)).toMatchObject({
      action: "edit",
      amountPrefix: "+",
      amountTone: "positive",
      rowTone: "cashflow",
      statusLabel: "工资",
      statusTone: "category",
    });
  });

  it("separates non-cashflow records from editable income and expense", () => {
    expect(buildLedgerRowPresentation({
      source: "adjustment",
      direction: "income",
      account_id: 1,
    }, canEditAccount)).toMatchObject({
      action: "readonly",
      amountPrefix: "",
      amountTone: "neutral",
      rowTone: "system",
      statusLabel: "余额调整",
      statusTone: "system",
    });
    expect(buildLedgerRowPresentation({
      source: "transfer",
      from_account_id: 1,
      to_account_id: 2,
    }, canEditAccount)).toMatchObject({
      action: "detail",
      canReverse: true,
      amountPrefix: "",
      amountTone: "neutral",
      rowTone: "transfer",
      statusLabel: "账户划转",
      statusTone: "transfer",
    });
    expect(buildLedgerRowPresentation({
      source: "transfer",
      from_account_id: 1,
      to_account_id: 9,
    }, canEditAccount)).toMatchObject({
      action: "detail",
      canReverse: false,
    });
  });

  it("makes every voided or unauthorized record read-only", () => {
    expect(buildLedgerRowPresentation({
      source: "manual",
      direction: "expense",
      account_id: 1,
      voided_at: "2026-09-25T10:00:00",
    }, canEditAccount)).toMatchObject({
      action: "readonly",
      amountPrefix: "-",
      amountTone: "voided",
      readonlyReason: "已撤销记录仅供追溯",
      rowTone: "voided",
      statusLabel: "已撤销",
      statusTone: "voided",
    });
    expect(buildLedgerRowPresentation({
      source: "manual",
      direction: "expense",
      account_id: 9,
    }, canEditAccount)).toMatchObject({
      action: "readonly",
      readonlyReason: "账户已归档或当前身份无权操作",
    });
  });

  it("builds two-sided transfer details from captured ledger legs", () => {
    expect(buildTransferDetail({
      amount: 100,
      base_amount: 700,
      from_account_id: 1,
      from_account_owner: "大宝",
      from_account_name: "美元账户",
      to_account_id: 2,
      to_account_owner: "小宝",
      to_account_name: "人民币账户",
      legs: [
        { direction: "expense", amount: 100, currency: "USD", base_amount: 700 },
        { direction: "income", amount: 700, currency: "CNY", base_amount: 700 },
      ],
    })).toEqual({
      from: {
        owner: "大宝", name: "美元账户", amount: 100, currency: "USD",
      },
      to: {
        owner: "小宝", name: "人民币账户", amount: 700, currency: "CNY",
      },
      baseAmount: 700,
      isCrossCurrency: true,
    });
  });
});
