const SOURCE_LABELS = {
  transfer: "账户划转",
  opening: "期初余额",
  adjustment: "余额调整",
};

const SYSTEM_SOURCES = new Set(["opening", "adjustment"]);

function accountCanBeEdited(canEditAccount, accountId) {
  return Boolean(accountId) && canEditAccount(accountId);
}

export function ledgerRecordScope(typeFilter) {
  if (typeFilter === "all_records") return "all_records";
  if (typeFilter === "voided") return "voided";
  return "effective";
}

export function ledgerSourceFilter(typeFilter) {
  if (typeFilter === "income" || typeFilter === "expense") return "manual";
  if (["transfer", "opening", "adjustment"].includes(typeFilter)) return typeFilter;
  return undefined;
}

export function matchesLedgerTypeFilter(item, typeFilter) {
  const source = item.source || "manual";
  if (typeFilter === "all_records") return true;
  if (typeFilter === "voided") return Boolean(item.voided_at);
  if (item.voided_at) return false;
  if (typeFilter === "all") return !SYSTEM_SOURCES.has(source);
  if (typeFilter === "income" || typeFilter === "expense") {
    return source === "manual" && item.direction === typeFilter;
  }
  return source === typeFilter;
}

export function ledgerSummaryNote(typeFilter, totals, filteredCount) {
  if (typeFilter === "voided") {
    return `已撤销记录 ${filteredCount} 笔，仅供追溯，不计入合计。`;
  }
  if (typeFilter === "adjustment" || typeFilter === "opening") {
    return `当前为${SOURCE_LABELS[typeFilter]}记录，共 ${filteredCount} 笔，不计入收支合计。`;
  }
  if (typeFilter === "all_records") {
    return `另有转账 / 期初 / 调整 ${totals.other} 笔；已撤销 ${totals.voided} 笔不计入合计。`;
  }
  if (typeFilter === "transfer") {
    return "账户划转仅移动账户间资金，不计入收入、支出与结余。";
  }
  return totals.other
    ? "账户划转不计入收入、支出与结余。"
    : "合计覆盖全部筛选结果。";
}

export function ledgerResultCountLabel(typeFilter, totals, filteredCount) {
  if (typeFilter === "all") {
    const transferCount = Number(totals.other || 0);
    const cashflowCount = Math.max(Number(filteredCount || 0) - transferCount, 0);
    return `筛选结果 · 收支 ${cashflowCount} 笔${transferCount ? ` · 划转 ${transferCount} 笔` : ""}`;
  }
  const label = {
    all_records: "全部记录",
    expense: "支出",
    income: "收入",
    transfer: "划转",
    adjustment: "余额调整",
    opening: "期初余额",
    voided: "已撤销",
  }[typeFilter] || "筛选结果";
  return `${label} · ${filteredCount} 笔`;
}

export function buildTransferDetail(item, accounts = []) {
  const accountById = (accountId) => accounts.find(
    (account) => String(account.id) === String(accountId),
  );
  const legs = Array.isArray(item.legs) ? item.legs : [];
  const outgoing = legs.find((leg) => leg.direction === "expense");
  const incoming = legs.find((leg) => leg.direction === "income");
  const fromAccount = accountById(item.from_account_id);
  const toAccount = accountById(item.to_account_id);
  const fromCurrency = outgoing?.currency || fromAccount?.currency || item.currency || "CNY";
  const toCurrency = incoming?.currency || toAccount?.currency || item.to_currency || fromCurrency;
  return {
    from: {
      owner: item.from_account_owner || outgoing?.account_owner || fromAccount?.owner || "未知用户",
      name: item.from_account_name || outgoing?.account_name || fromAccount?.name || "未知账户",
      amount: outgoing?.amount ?? item.amount ?? 0,
      currency: fromCurrency,
    },
    to: {
      owner: item.to_account_owner || incoming?.account_owner || toAccount?.owner || "未知用户",
      name: item.to_account_name || incoming?.account_name || toAccount?.name || "未知账户",
      amount: incoming?.amount ?? item.to_amount ?? item.amount ?? 0,
      currency: toCurrency,
    },
    baseAmount: outgoing?.base_amount ?? incoming?.base_amount ?? item.base_amount ?? 0,
    isCrossCurrency: String(fromCurrency).toUpperCase() !== String(toCurrency).toUpperCase(),
  };
}

export function buildLedgerRowPresentation(item, canEditAccount) {
  const source = item.source || "manual";
  const isManual = source === "manual";
  const isTransfer = source === "transfer";
  const isSystemRecord = source === "opening" || source === "adjustment";
  const isVoided = Boolean(item.voided_at);
  const needsReview = !isVoided && (
    item.application?.marker_consistent === false
    || (Number(item.balance_applied) === 0 && !item.application)
  );
  const isHistorical = isManual && Number(item.balance_applied) === 0
    && item.application?.marker_consistent === true;
  const isIncome = isManual && item.direction === "income";
  const isExpense = isManual && item.direction === "expense";

  const canReverse = !isVoided
    && isTransfer
    && accountCanBeEdited(canEditAccount, item.from_account_id)
    && accountCanBeEdited(canEditAccount, item.to_account_id);
  let action = isTransfer ? "detail" : "readonly";
  if (!isVoided && isManual && accountCanBeEdited(canEditAccount, item.account_id)) {
    action = "edit";
  }

  const readonlyReason = isVoided
    ? "已撤销记录仅供追溯"
    : source === "adjustment"
      ? "余额调整为系统留痕；如需修正，请再次核对余额"
      : source === "opening"
        ? "期初余额由账户创建流程生成，不能直接编辑"
        : "账户已归档或当前身份无权操作";

  return {
    action: needsReview ? "review" : action,
    canReverse,
    amountHint: isVoided
      ? "原金额，已撤销且不计入统计"
      : needsReview
        ? "流水余额应用待核对，请查看账本诊断"
      : isTransfer
        ? "账户间划转金额，不计入收支"
        : isSystemRecord
          ? `${SOURCE_LABELS[source]}金额，不计入收支`
          : isHistorical
            ? "历史补录金额，不影响当前账户余额"
            : isIncome ? "收入金额" : isExpense ? "支出金额" : "流水金额",
    amountPrefix: isIncome ? "+" : isExpense ? "-" : "",
    amountTone: isVoided ? "voided" : isIncome ? "positive" : isExpense ? "negative" : "neutral",
    iconTone: isVoided ? "voided" : isIncome ? "income" : isExpense ? "expense" : isTransfer ? "transfer" : "system",
    readonlyReason: action === "readonly" ? readonlyReason : "",
    rowTone: isVoided ? "voided" : needsReview ? "review" : isSystemRecord ? "system" : isTransfer ? "transfer" : isHistorical ? "historical" : "cashflow",
    statusHint: isVoided
      ? "该记录已撤销，不影响余额或收支统计"
      : needsReview
        ? "余额应用标记尚未核实，请逐笔核对后更正"
      : isTransfer
        ? "仅在账户之间移动资金，不计入收入或支出"
        : isSystemRecord
          ? "账户余额留痕，不计入收入或支出"
          : isHistorical
            ? "计入收支统计，但不回写当前账户余额"
            : "",
    statusLabel: isVoided
      ? "已撤销"
      : needsReview
        ? "余额应用待核对"
      : isHistorical
        ? "历史补录"
        : isManual
          ? item.category_name || "未分类"
          : SOURCE_LABELS[source] || "系统记录",
    statusTone: isVoided
      ? "voided"
      : needsReview
        ? "review"
      : isHistorical
        ? "historical"
        : isTransfer
          ? "transfer"
          : isSystemRecord ? "system" : "category",
  };
}
