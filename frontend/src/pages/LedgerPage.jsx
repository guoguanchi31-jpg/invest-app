import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Download, Search, Upload } from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { parseStatementRows } from "../statementImport";

const sourceLabels = {
  manual: "收支",
  transfer: "转账",
  opening: "期初",
  adjustment: "调整",
};

function ledgerTitle(item) {
  if (item.source === "transfer") {
    return `${item.from_account_name || "转出账户"} → ${item.to_account_name || "转入账户"}`;
  }
  if (item.source === "opening") return "期初余额";
  if (item.source === "adjustment") return "余额核对";
  return item.merchant || item.note || item.category_name || "未命名流水";
}

function ledgerAccount(item) {
  if (item.source === "transfer") {
    const from = [item.from_account_owner, item.from_account_name].filter(Boolean).join(" · ");
    const to = [item.to_account_owner, item.to_account_name].filter(Boolean).join(" · ");
    return `${from || "未知账户"} → ${to || "未知账户"}`;
  }
  return [item.account_owner, item.account_name].filter(Boolean).join(" · ");
}

export default function LedgerPage({ view }) {
  const {
    accountOwnerOptions,
    accountsData,
    categoriesData,
    expenseData,
    formatDateLabel,
    formatMoney,
    handleDownloadLedger,
    handleStatementImport,
    incomeData,
    ledgerData,
    ledgerAccountFilter,
    setLedgerAccountFilter,
    setReversalTarget,
    monthlyExpense,
    monthlyIncome,
    openAction,
    openEditAction,
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
  const [monthFilter, setMonthFilter] = useState(accountFilter === "all" ? selectedMonth : "all");
  const [page, setPage] = useState(1);
  const pageSize = 30;
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

  useEffect(() => setMonthFilter(accountFilter === "all" ? selectedMonth : "all"), [selectedMonth, accountFilter]);
  useEffect(() => setPage(1), [accountFilter, categoryFilter, monthFilter, ownerFilter, search, typeFilter]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return ledgerData.filter((item) => {
      if (monthFilter !== "all" && item.occurred_at?.slice(0, 7) !== monthFilter) return false;
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
      if (typeFilter === "income" && !(item.source === "manual" && item.direction === "income")) return false;
      if (typeFilter === "expense" && !(item.source === "manual" && item.direction === "expense")) return false;
      if (!["all", "income", "expense"].includes(typeFilter) && item.source !== typeFilter) return false;
      if (!keyword) return true;
      return [
        ledgerTitle(item),
        ledgerAccount(item),
        item.category_name,
        item.note,
        item.amount,
      ].some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [accountFilter, categoryFilter, ledgerData, monthFilter, ownerFilter, search, typeFilter]);
  const totals = filteredRows.reduce((result, row) => {
    if (row.voided_at) { result.voided += 1; return result; }
    if (row.source === "manual") result[row.direction] += Number(row.base_amount ?? row.amount ?? 0);
    else result.other += 1;
    return result;
  }, { income: 0, expense: 0, other: 0, voided: 0 });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedAccount = ledgerAccountOptions.find((account) => String(account.id) === accountFilter);
  const scopeLabel = `${monthFilter === "all" ? "全部日期" : monthFilter} · ${selectedAccount ? `${selectedAccount.owner} · ${selectedAccount.name}` : accountFilter !== "all" ? "所选账户" : ownerFilter === "all" ? "全部账户" : `${ownerFilter}的账户`}`;

  const analysisRows = analysisMode === "expense" ? expenseData.categories : incomeData.categories;
  const analysisTotal = analysisMode === "expense" ? expenseData.total_expense : incomeData.total_income;

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
        <div className="section-tabs" role="tablist" aria-label="账本视图">
          <button type="button" className={section === "ledger" ? "active" : ""} onClick={() => setSection("ledger")}>全部流水</button>
          <button type="button" className={section === "analysis" ? "active" : ""} onClick={() => setSection("analysis")}>收支分析</button>
        </div>
        <div className="panel-actions">
          <button type="button" className="icon-command" title="导出完整流水" aria-label="导出完整流水" onClick={handleDownloadLedger}>
            <Download size={18} />
          </button>
          <label className="filter-button import-button">
            <Upload size={16} /> 导入账单
            <input type="file" accept=".csv,text/csv" onChange={handleStatementFile} />
          </label>
          <button type="button" className="filter-button" onClick={() => openAction("transfer")}>
            <ArrowRightLeft size={16} /> 转账
          </button>
          <button type="button" className="filter-button primary" onClick={() => openAction("transaction")}>记一笔</button>
        </div>
      </div>

      <section className="summary-grid ledger-summary">
        <article className="metric-card">
          <span>本月收入</span>
          <strong className="positive">{formatMoney(monthlyIncome)}</strong>
          <p>{selectedMonth} · 全部账户收入</p>
        </article>
        <article className="metric-card">
          <span>本月支出</span>
          <strong className="negative">{formatMoney(monthlyExpense)}</strong>
          <p>{selectedMonth} · 全部账户支出</p>
        </article>
        <article className="metric-card">
          <span>本月结余</span>
          <strong className={monthlyIncome - monthlyExpense >= 0 ? "positive" : "negative"}>
            {formatMoney(monthlyIncome - monthlyExpense)}
          </strong>
          <p>转账、期初和余额调整不计入收支</p>
        </article>
      </section>

      {section === "ledger" ? (
        <article className="panel ledger-panel">
          <div className="ledger-filter-bar">
            <label className="search-control">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索商户、备注、分类或账户" />
            </label>
            <select aria-label="日期范围" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              <option value={selectedMonth}>当前月份</option>
              <option value="all">全部日期</option>
            </select>
            <select aria-label="流水类型" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">全部类型</option>
              <option value="expense">支出</option>
              <option value="income">收入</option>
              <option value="transfer">转账</option>
              <option value="adjustment">余额调整</option>
              <option value="opening">期初余额</option>
            </select>
            <select aria-label="筛选用户" value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setAccountFilter("all"); }}>
              <option value="all">全部用户</option>
              {ledgerOwnerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
            <select aria-label="筛选账户" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">全部账户</option>
              {ledgerAccountOptions.filter((account) => ownerFilter === "all" || account.owner === ownerFilter).map((account) => (
                <option key={account.id} value={account.id}>{account.owner} · {account.name}{account.archived ? "（已归档）" : ""}</option>
              ))}
            </select>
            <select aria-label="筛选分类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">全部分类</option>
              {categoriesData.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div className="ledger-filter-summary" aria-label="筛选结果合计" aria-live="polite">
            <div><strong>筛选结果 · {filteredRows.length} 笔</strong><span>{scopeLabel} · 金额均为本位币</span></div>
            <span>收入 <b className="positive">{formatMoney(totals.income)}</b></span>
            <span>支出 <b className="negative">{formatMoney(totals.expense)}</b></span>
            <span>结余 <b className={totals.income - totals.expense < 0 ? "negative" : "positive"}>{formatMoney(totals.income - totals.expense)}</b></span>
            <small>另有转账 / 期初 / 调整 {totals.other} 笔；已撤销 {totals.voided} 笔不计入合计。合计覆盖全部筛选结果。</small>
          </div>
          <div className="ledger-list">
            {pagedRows.map((item) => {
              const amount = item.base_amount ?? item.amount ?? 0;
              const isIncome = item.source === "manual" && item.direction === "income";
              const isExpense = item.source === "manual" && item.direction === "expense";
              return (
                <div className="ledger-row" key={`${item.source}-${item.id}`}>
                  <span className={`ledger-direction ${isIncome ? "income" : isExpense ? "expense" : "neutral"}`}>
                    {item.source === "transfer" ? <ArrowRightLeft size={17} /> : isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                  </span>
                  <div className="ledger-main">
                    <strong>{ledgerTitle(item)}</strong>
                    <span>{ledgerAccount(item)}{item.note && item.note !== ledgerTitle(item) ? ` · ${item.note}` : ""}</span>
                  </div>
                  <span className="ledger-source">{item.voided_at ? "已撤销" : item.source === "manual" && item.balance_applied === 0 ? "历史补录" : item.category_name || sourceLabels[item.source] || "流水"}</span>
                  <b className={isIncome ? "positive" : isExpense ? "negative" : ""}>
                    {isIncome ? "+" : isExpense ? "-" : ""}{formatMoney(amount)}
                  </b>
                  <time>{formatDateLabel(item.occurred_at)}</time>
                  {item.source === "manual" && (
                    <button type="button" className="edit-button subtle" onClick={() => openEditAction("transaction", { ...item, rawAmount: item.amount })}>编辑</button>
                  )}
                  {item.source === "transfer" && !item.voided_at && (
                    <button type="button" className="edit-button subtle" onClick={() => setReversalTarget({ type: "transfer", item })}>撤销</button>
                  )}
                  {item.voided_at && <span className="workflow-note" title={item.void_reason}>{item.void_reason}</span>}
                </div>
              );
            })}
            {!filteredRows.length && <div className="empty-state">没有符合筛选条件的流水。</div>}
          </div>
          {pageCount > 1 && <div className="ledger-pagination">
            <button type="button" className="filter-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
            <span>第 {currentPage} / {pageCount} 页 · 每页 {pageSize} 笔</span>
            <button type="button" className="filter-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>}
        </article>
      ) : (
        <article className="panel ledger-analysis-panel">
          <div className="panel-title">
            <div>
              <h3>分类结构</h3>
              <p>点击上方月份可切换统计周期</p>
            </div>
            <div className="segmented">
              <button type="button" className={analysisMode === "expense" ? "active" : ""} onClick={() => setAnalysisMode("expense")}>支出</button>
              <button type="button" className={analysisMode === "income" ? "active" : ""} onClick={() => setAnalysisMode("income")}>收入</button>
            </div>
          </div>
          <div className="analysis-total">
            <span>{analysisMode === "expense" ? "支出合计" : "收入合计"}</span>
            <strong>{formatMoney(analysisTotal)}</strong>
          </div>
          <div className="analysis-category-list">
            {(analysisRows || []).filter((item) => item.amount > 0).map((item) => (
              <button
                type="button"
                key={`${analysisMode}-${item.id || item.name}`}
                onClick={() => {
                  setSection("ledger");
                  setTypeFilter(analysisMode);
                  setCategoryFilter(String(item.id || item.category_id));
                }}
              >
                <span>{item.icon || "·"} {item.name}</span>
                <i><em style={{ width: `${Math.min(item.percent || 0, 100)}%`, background: item.color }} /></i>
                <b>{formatMoney(item.amount)}</b>
                <small>{item.percent || 0}%</small>
              </button>
            ))}
            {!analysisRows?.length && <div className="empty-state">本期暂无可分析的收支流水。</div>}
          </div>
        </article>
      )}
    </>
  );
}
