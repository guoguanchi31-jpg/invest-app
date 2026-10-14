import { ArrowRightLeft, ChevronRight, CircleDollarSign, Download, LockKeyhole, ReceiptText, RefreshCw, Upload, WalletCards } from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";
import DateRangeFilter from "../components/DateRangeFilter";
import FilterPanel, { FilterField, FilterSearch } from "../components/FilterPanel";
import MetricValue from "../components/MetricValue";
import SegmentedTabs from "../components/SegmentedTabs";
import { createDateRange, formatDateRange } from "../dateRanges";
import {
  buildLedgerRowPresentation,
  ledgerRecordScope,
  ledgerResultCountLabel,
  ledgerSourceFilter,
  ledgerSummaryNote,
  matchesLedgerTypeFilter,
} from "../features/ledger/presentation";
import {
  joinDisplayText,
  normalizeDisplayText,
} from "../shared/displayContent";
import { parseStatementRows } from "../statementImport";
import LedgerMonthlyOverview from "../features/ledger/LedgerMonthlyOverview";
import TransferDetailDialog from "../features/ledger/TransferDetailDialog";

const typeFilterLabels = {
  all_records: "全部记录",
  expense: "支出",
  income: "收入",
  transfer: "转账",
  adjustment: "余额调整",
  opening: "期初余额",
  voided: "已撤销",
};
const ledgerTabs = [
  { value: "ledger", label: "流水明细" },
  { value: "analysis", label: "月度概览" },
];

function ledgerTitle(item) {
  if (item.source === "transfer") {
    return `${normalizeDisplayText(item.from_account_name) || "转出账户"} → ${normalizeDisplayText(item.to_account_name) || "转入账户"}`;
  }
  if (item.source === "opening") return "期初余额";
  if (item.source === "adjustment") return "余额核对";
  return normalizeDisplayText(item.merchant)
    || normalizeDisplayText(item.note)
    || normalizeDisplayText(item.category_name)
    || "未命名流水";
}

function ledgerAccount(item) {
  if (item.source === "transfer") {
    const from = joinDisplayText([item.from_account_owner, item.from_account_name]);
    const to = joinDisplayText([item.to_account_owner, item.to_account_name]);
    return `${from || "未知账户"} → ${to || "未知账户"}`;
  }
  return joinDisplayText([item.account_owner, item.account_name]) || "未知账户";
}

function compactTransferMeta(item) {
  const fromOwner = normalizeDisplayText(item.from_account_owner);
  const toOwner = normalizeDisplayText(item.to_account_owner);
  const ownerPath = fromOwner && toOwner && fromOwner !== toOwner
    ? `${fromOwner} → ${toOwner}`
    : fromOwner || toOwner;
  return joinDisplayText([ownerPath, item.note]) || "账户划转";
}

function ledgerIcon(item) {
  if (item.source === "transfer") return <ArrowRightLeft size={17} />;
  if (item.source === "opening") return <WalletCards size={17} />;
  if (item.source === "adjustment") return <RefreshCw size={17} />;
  if (item.icon && item.icon !== "•") {
    return <span className="ledger-category-glyph" aria-hidden="true">{item.icon}</span>;
  }
  return item.direction === "income" ? <CircleDollarSign size={17} /> : <ReceiptText size={17} />;
}

export default function LedgerPage({ view }) {
  const {
    accountOwnerOptions,
    accountsData,
    categoriesData,
    dataIdentityKey,
    dataRevision,
    dataScope,
    formatDateLabel,
    formatMoney,
    handleDownloadLedger,
    handleStatementImport,
    isGuestMode = false,
    ledgerData,
    ledgerAccountFilter,
    ledgerMeta,
    ledgerRequest = {},
    loadLedgerPage,
    setLedgerAccountFilter,
    setReversalTarget,
    monthlyExpense,
    monthlyIncome,
    openAction,
    openEditAction,
    openReconciliation,
    selectedMonth,
  } = view;
  const [section, setSection] = useState("ledger");
  const [analysisMode, setAnalysisMode] = useState("expense");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const accountFilter = ledgerAccountFilter;
  const setAccountFilter = setLedgerAccountFilter;
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [transferDetail, setTransferDetail] = useState(null);
  const [dateRange, setDateRange] = useState(() => createDateRange(
    accountFilter === "all" ? "selected_month" : "all",
    selectedMonth,
  ));
  const statementFileRef = useRef(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const serverPagination = typeof loadLedgerPage === "function";
  const ledgerAccountOptions = useMemo(() => {
    const options = new Map((accountsData.accounts || []).map((account) => [
      String(account.id), { id: account.id, owner: account.owner, name: account.name, archived: false },
    ]));
    ledgerData.forEach((item) => {
      const candidates = item.source === "transfer" ? [
        [item.from_account_id, item.from_account_owner, item.from_account_name],
        [item.to_account_id, item.to_account_owner, item.to_account_name],
      ] : [[item.account_id, item.account_owner, item.account_name]];
      candidates.forEach(([id, owner, name]) => {
        if (id && !options.has(String(id))) options.set(String(id), { id, owner, name, archived: true });
      });
    });
    return [...options.values()];
  }, [accountsData.accounts, ledgerData]);
  const ledgerOwnerOptions = useMemo(() => Array.from(new Set([
    ...accountOwnerOptions,
    ...ledgerAccountOptions.map((account) => account.owner).filter(Boolean),
  ])), [accountOwnerOptions, ledgerAccountOptions]);

  useEffect(() => {
    setDateRange(createDateRange(
      accountFilter === "all" ? "selected_month" : "all",
      selectedMonth,
    ));
    setPage(1);
  }, [selectedMonth, accountFilter]);

  useEffect(() => {
    if (!serverPagination || section !== "ledger") return undefined;
    const timeout = window.setTimeout(() => {
      loadLedgerPage({
        page,
        page_size: pageSize,
        date_from: dateRange.dateFrom,
        date_to: dateRange.dateTo,
        account_id: accountFilter,
        owner: ownerFilter,
        direction: ["income", "expense"].includes(typeFilter) ? typeFilter : undefined,
        source: ledgerSourceFilter(typeFilter),
        record_scope: ledgerRecordScope(typeFilter),
        category_id: categoryFilter,
        search: search.trim(),
      });
    }, search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [
    accountFilter,
    categoryFilter,
    dateRange.dateFrom,
    dateRange.dateTo,
    loadLedgerPage,
    ownerFilter,
    page,
    search,
    section,
    serverPagination,
    typeFilter,
    dataRevision,
  ]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return ledgerData.filter((item) => {
      if (!matchesLedgerTypeFilter(item, typeFilter)) return false;
      if (serverPagination) return true;
      if (dateRange.dateFrom && item.occurred_at < dateRange.dateFrom) return false;
      if (dateRange.dateTo && item.occurred_at > dateRange.dateTo) return false;
      if (ownerFilter !== "all" && ![
        item.account_owner,
        item.from_account_owner,
        item.to_account_owner,
      ].includes(ownerFilter)) return false;
      if (accountFilter !== "all" && ![
        item.account_id,
        item.from_account_id,
        item.to_account_id,
      ].map(String).includes(accountFilter)) return false;
      if (categoryFilter !== "all" && String(item.category_id) !== categoryFilter) return false;
      if (!keyword) return true;
      return [
        ledgerTitle(item),
        ledgerAccount(item),
        item.category_name,
        item.note,
        item.amount,
      ].some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [
    accountFilter,
    categoryFilter,
    dateRange.dateFrom,
    dateRange.dateTo,
    ledgerData,
    ownerFilter,
    search,
    serverPagination,
    typeFilter,
  ]);
  const clientTotals = filteredRows.reduce((result, row) => {
    if (row.voided_at) { result.voided += 1; return result; }
    if (row.source === "manual") result[row.direction] += Number(row.base_amount ?? row.amount ?? 0);
    else result.other += 1;
    return result;
  }, { income: 0, expense: 0, other: 0, voided: 0 });
  const totals = serverPagination && ledgerMeta?.summary ? ledgerMeta.summary : clientTotals;
  const filteredCount = serverPagination ? (ledgerMeta?.total || 0) : filteredRows.length;
  const resultCountLabel = ledgerResultCountLabel(typeFilter, totals, filteredCount);
  const summaryNote = ledgerSummaryNote(typeFilter, totals, filteredCount);
  const showSummaryNote = summaryNote !== "合计覆盖全部筛选结果。";
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
  const currentPage = serverPagination ? page : Math.min(page, pageCount);
  useEffect(() => {
    if (serverPagination && !ledgerRequest.loading && !ledgerRequest.error
        && ledgerMeta?.page === page && page > pageCount) setPage(pageCount);
  }, [ledgerMeta?.page, ledgerRequest.error, ledgerRequest.loading, page, pageCount, serverPagination]);
  const pagedRows = serverPagination
    ? filteredRows
    : filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedAccount = ledgerAccountOptions.find((account) => String(account.id) === accountFilter);
  const selectedCategory = categoriesData.find((category) => String(category.id) === categoryFilter);
  const dateRangeLabel = formatDateRange(dateRange, selectedMonth);
  const scopeLabel = `${dateRangeLabel} · ${selectedAccount ? `${selectedAccount.owner} · ${selectedAccount.name}` : accountFilter !== "all" ? "所选账户" : ownerFilter === "all" ? "全部账户" : `${ownerFilter}的账户`}`;
  const resetLedgerFilters = () => {
    setSearch("");
    setDateRange(createDateRange("selected_month", selectedMonth));
    setTypeFilter("all");
    setOwnerFilter("all");
    setAccountFilter("all");
    setCategoryFilter("all");
    setPage(1);
  };
  const activeFilters = [
    dateRange.preset !== "selected_month" ? {
      key: "date",
      label: `日期 · ${dateRangeLabel}`,
      onRemove: () => {
        setDateRange(createDateRange("selected_month", selectedMonth));
        setPage(1);
      },
    } : null,
    typeFilter !== "all" ? {
      key: "type",
      label: `类型 · ${typeFilterLabels[typeFilter] || typeFilter}`,
      onRemove: () => {
        setTypeFilter("all");
        setPage(1);
      },
    } : null,
    ownerFilter !== "all" ? {
      key: "owner",
      label: `用户 · ${ownerFilter}`,
      onRemove: () => {
        setOwnerFilter("all");
        setPage(1);
      },
    } : null,
    accountFilter !== "all" ? {
      key: "account",
      label: `账户 · ${selectedAccount?.name || "所选账户"}`,
      onRemove: () => {
        setAccountFilter("all");
        setPage(1);
      },
    } : null,
    categoryFilter !== "all" ? {
      key: "category",
      label: `分类 · ${selectedCategory?.name || "所选分类"}`,
      onRemove: () => {
        setCategoryFilter("all");
        setPage(1);
      },
    } : null,
  ].filter(Boolean);

  const canEditAccount = (accountId) => {
    const account = (accountsData.accounts || []).find((item) => String(item.id) === String(accountId));
    return Boolean(account) && account.can_edit !== false;
  };

  const handleStatementFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: ({ data, errors }) => {
        if (errors.length) {
          alert(`账单解析失败：${errors[0].message}`);
          return;
        }
        try {
          const { rows, skipped } = parseStatementRows(data, accountsData.accounts || []);
          handleStatementImport(rows, skipped);
        } catch (error) {
          alert(error.message);
        }
      },
    });
  };

  return (
    <>
      <div className="section-toolbar">
        <SegmentedTabs
          ariaLabel="账本视图"
          idPrefix="ledger"
          onChange={setSection}
          options={ledgerTabs}
          value={section}
        />
        <div className="panel-actions ledger-page-actions" role="group" aria-label="账本操作">
          {openReconciliation && <button type="button" className="filter-button" onClick={() => openReconciliation()}>
            <RefreshCw size={16} /> 账本诊断
          </button>}
          <button type="button" className="filter-button" onClick={() => openAction("transfer")}>
            <ArrowRightLeft size={16} /> 转账
          </button>
          {!isGuestMode ? (
            <>
              <button type="button" className="filter-button" onClick={() => statementFileRef.current?.click()}>
                <Upload size={16} /> 导入账单
              </button>
              <input
                ref={statementFileRef}
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={handleStatementFile}
              />
            </>
          ) : null}
          <button type="button" className="filter-button" onClick={handleDownloadLedger}>
            <Download size={16} /> 导出流水
          </button>
        </div>
      </div>

      {section === "ledger" ? <section className="summary-grid summary-grid--three ledger-summary">
        <article className="metric-card">
          <span>本月收入</span>
          <MetricValue className="positive">{formatMoney(monthlyIncome)}</MetricValue>
        </article>
        <article className="metric-card">
          <span>本月支出</span>
          <MetricValue className="negative">{formatMoney(monthlyExpense)}</MetricValue>
        </article>
        <article className="metric-card">
          <span>本月结余</span>
          <MetricValue className={monthlyIncome - monthlyExpense >= 0 ? "positive" : "negative"}>
            {formatMoney(monthlyIncome - monthlyExpense)}
          </MetricValue>
        </article>
      </section> : null}

      <div
        id={`ledger-panel-${section}`}
        role="tabpanel"
        aria-labelledby={`ledger-tab-${section}`}
      >
      {section === "ledger" ? (
        <article className="panel ledger-panel">
          <FilterPanel
            className="compact-filter-panel--ledger"
            activeFilters={activeFilters}
            searchActive={Boolean(search.trim())}
            onReset={resetLedgerFilters}
            search={
              <FilterSearch
                label="搜索流水"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="搜索流水"
              />
            }
          >
            <FilterField label="日期">
              <DateRangeFilter
                anchorMonth={selectedMonth}
                value={dateRange}
                onChange={(value) => {
                  setDateRange(value);
                  setPage(1);
                }}
              />
            </FilterField>
            <FilterField label="类型">
              <select aria-label="流水类型" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
                <option value="all">有效流水</option>
                <option value="expense">支出</option>
                <option value="income">收入</option>
                <option value="transfer">转账</option>
                <option value="all_records">全部记录</option>
                <option value="adjustment">余额调整</option>
                <option value="opening">期初余额</option>
                <option value="voided">已撤销</option>
              </select>
            </FilterField>
            <FilterField label="用户">
              <select aria-label="筛选用户" value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setAccountFilter("all"); setPage(1); }}>
                <option value="all">全部用户</option>
                {ledgerOwnerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              </select>
            </FilterField>
            <FilterField label="账户">
              <select aria-label="筛选账户" value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setPage(1); }}>
                <option value="all">全部账户</option>
                {ledgerAccountOptions.filter((account) => ownerFilter === "all" || account.owner === ownerFilter).map((account) => (
                  <option key={account.id} value={account.id}>{account.owner} · {account.name}{account.archived ? "（已归档）" : ""}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="分类">
              <select aria-label="筛选分类" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}>
                <option value="all">全部分类</option>
                {categoriesData.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </FilterField>
          </FilterPanel>
          <div className="ledger-filter-summary" aria-label="筛选结果合计" aria-live="polite">
            {ledgerRequest.loading ? <span role="status">正在更新筛选结果...</span> : <>
            <div className="ledger-summary-context">
              <strong>{resultCountLabel}</strong>
              <span>{scopeLabel} · 本位币</span>
            </div>
            <div className="ledger-summary-values">
              <span>收入 <b className="positive">{formatMoney(totals.income)}</b></span>
              <span>支出 <b className="negative">{formatMoney(totals.expense)}</b></span>
              <span>结余 <b className={totals.income - totals.expense < 0 ? "negative" : "positive"}>{formatMoney(totals.income - totals.expense)}</b></span>
            </div>
            {showSummaryNote && <small>{summaryNote}</small>}
            </>}
          </div>
          <div className="ledger-list">
            {pagedRows.map((item) => {
              const amount = item.base_amount ?? item.amount ?? 0;
              const presentation = buildLedgerRowPresentation(item, canEditAccount);
              const title = ledgerTitle(item);
              const amountText = `${presentation.amountPrefix}${formatMoney(amount)}`;
              const editItem = { ...item, rawAmount: item.amount };
              const openTransactionEditor = () => openEditAction("transaction", editItem);
              const rowAction = presentation.action === "edit"
                ? openTransactionEditor
                : presentation.action === "detail"
                  ? () => setTransferDetail({ item, canReverse: presentation.canReverse })
                  : undefined;
              const rowLabel = presentation.action === "edit"
                ? `编辑${title}`
                : presentation.action === "detail"
                  ? `查看转账详情：${title}`
                  : undefined;
              return (
                <div
                  className={`ledger-row is-${presentation.rowTone}${rowAction ? " is-clickable" : ""}`}
                  key={`${item.source}-${item.id}`}
                  role={rowAction ? "button" : undefined}
                  tabIndex={rowAction ? 0 : undefined}
                  aria-label={rowLabel}
                  onClick={rowAction}
                  onKeyDown={rowAction ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      rowAction();
                    }
                  } : undefined}
                >
                  <span className={`ledger-direction ${presentation.iconTone}`}>
                    {ledgerIcon(item)}
                  </span>
                  <div className="ledger-main">
                    <strong>{title}</strong>
                    {item.source === "transfer" ? (
                      <>
                        <span className="ledger-transfer-meta-full">
                          {ledgerAccount(item)}{item.note && item.note !== title ? ` · ${item.note}` : ""}
                        </span>
                        <span className="ledger-transfer-meta-compact">
                          {compactTransferMeta(item)}
                        </span>
                      </>
                    ) : (
                      <span>{ledgerAccount(item)}{item.note && item.note !== title ? ` · ${item.note}` : ""}</span>
                    )}
                    {item.voided_at && (
                      <small className="ledger-state-note">
                        撤销原因：{item.void_reason || "未填写"}
                      </small>
                    )}
                  </div>
                  <div className="ledger-secondary">
                    <span
                      className={`ledger-source tone-${presentation.statusTone}`}
                      title={presentation.statusHint || undefined}
                    >
                      {presentation.statusLabel}
                    </span>
                    <time>{formatDateLabel(item.occurred_at)}</time>
                  </div>
                  <div className="ledger-tail">
                    <b
                      className={`ledger-amount ${presentation.amountTone}`}
                      title={presentation.amountHint}
                      aria-label={`${presentation.amountHint}：${amountText}`}
                    >
                      {amountText}
                    </b>
                    {["edit", "detail"].includes(presentation.action) && (
                      <ChevronRight className="ledger-row-chevron" size={17} aria-hidden="true" />
                    )}
                    {presentation.action === "review" && (
                      <button type="button" className="filter-button" onClick={() => openReconciliation?.(item.account_id)}>
                        查看诊断
                      </button>
                    )}
                    {presentation.action === "readonly" && (
                      <span
                        className="ledger-readonly-indicator"
                        role="img"
                        aria-label={presentation.readonlyReason}
                        title={presentation.readonlyReason}
                      >
                        <LockKeyhole size={14} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {ledgerRequest.loading
              ? <div className="empty-state" role="status">正在加载流水...</div>
              : !filteredRows.length && <div className="empty-state">没有符合筛选条件的流水。</div>}
          </div>
          {pageCount > 1 && <div className="ledger-pagination">
            <button type="button" className="filter-button" disabled={ledgerRequest.loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
            <span>第 {currentPage} / {pageCount} 页 · 每页 {pageSize} 笔</span>
            <button type="button" className="filter-button" disabled={ledgerRequest.loading || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>}
        </article>
      ) : (
        <LedgerMonthlyOverview
          accountId={accountFilter}
          accountOptions={ledgerAccountOptions}
          dataRevision={dataRevision}
          dataScope={dataScope}
          formatMoney={formatMoney}
          identityKey={dataIdentityKey}
          mode={analysisMode}
          month={selectedMonth}
          onAccountChange={setAccountFilter}
          onCategoryOpen={(categoryId) => {
            setSearch("");
            setDateRange(createDateRange("selected_month", selectedMonth));
            setSection("ledger");
            setTypeFilter(analysisMode);
            setCategoryFilter(String(categoryId));
            setPage(1);
          }}
          onModeChange={setAnalysisMode}
          onOwnerChange={(value) => {
            setOwnerFilter(value);
            setAccountFilter("all");
          }}
          owner={ownerFilter}
          ownerOptions={ledgerOwnerOptions}
        />
      )}
      </div>
      {transferDetail ? (
        <TransferDetailDialog
          accounts={accountsData.accounts || []}
          canReverse={transferDetail.canReverse}
          formatDateLabel={formatDateLabel}
          formatMoney={formatMoney}
          item={transferDetail.item}
          onClose={() => setTransferDetail(null)}
          onReverse={(item) => {
            setTransferDetail(null);
            setReversalTarget({ type: "transfer", item });
          }}
        />
      ) : null}
    </>
  );
}
