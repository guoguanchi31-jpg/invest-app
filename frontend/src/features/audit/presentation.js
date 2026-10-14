const FIELDS = {
  name: "名称", code: "标的代码", type: "账户类型",
  account_id: "账户", member_id: "成员", category_id: "分类",
  owner: "所属成员", currency: "币种",
  direction: "收支方向", amount: "金额", base_amount: "本位币金额",
  exchange_rate_to_base: "历史汇率", occurred_at: "发生日期",
  recorded_at: "记录日期", merchant: "商户 / 来源", note: "备注",
  source: "记录来源", balance: "账户余额", cash_available: "现金可投",
  quantity: "数量", buy_price: "持仓成本价", current_price: "估值价格",
  trade_type: "交易方向", price: "成交价格", fee: "手续费",
  cash_amount: "结算金额", settlement_rate: "结算汇率",
  quantity_before: "交易前数量", quantity_after: "交易后数量",
  cost_before: "交易前成本价", cost_after: "交易后成本价",
  month: "预算月份", total_amount: "预算总额", target_amount: "目标金额",
  current_amount: "已存金额", monthly_saving: "每月计划储蓄",
  due_date: "目标日期", status: "状态", is_active: "账户启用",
  is_liability: "负债账户", voided_at: "撤销时间", void_reason: "撤销原因",
  balance_applied: "余额应用",
};

const LABELS = {
  direction: { income: "收入", expense: "支出" },
  trade_type: { buy: "买入", sell: "卖出" },
  source: { manual: "收支", transfer: "转账", opening: "期初余额", adjustment: "余额调整" },
  type: { debit_card: "储蓄卡", credit_card: "信用卡", investment: "投资账户", wallet: "电子钱包", deposit: "定期存款" },
  status: { active: "进行中", paused: "已暂停", completed: "已完成", archived: "已归档" },
  is_active: { 0: "已归档", 1: "已启用" },
  is_liability: { 0: "否", 1: "是", false: "否", true: "是" },
  balance_applied: { 0: "未应用", 1: "已应用", false: "未应用", true: "已应用" },
};

export function parseAuditSnapshot(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function inferredKind(row) {
  if (row?.trade_type) return "投资交易";
  if (row?.direction && row?.source) return "流水";
  if (row?.asset_type || row?.market) return "持仓";
  if (row?.type && ("balance" in row || "cash_available" in row)) return "账户";
  return "记录";
}

function namedId(resources, resource, value) {
  const collection = resources[resource] || [];
  const item = collection.find((entry) => String(entry.id) === String(value));
  return item?.display_name || item?.name || null;
}

function semanticRow(key, label, row, embeddedBefore = null) {
  return row && typeof row === "object" && !Array.isArray(row)
    ? { key, label, row, embeddedBefore }
    : null;
}

function genericRows(snapshot, showKind = false) {
  const values = Array.isArray(snapshot) ? snapshot : [snapshot];
  return values.flatMap((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const kind = inferredKind(row);
    return [semanticRow(
      `${kind}:${row.id ?? index}`,
      values.length > 1 || showKind ? `${kind} ${index + 1}` : "",
      row,
    )];
  });
}

function goalRows(snapshot, resources) {
  if (!("goal" in snapshot) && !("allocations" in snapshot)) return genericRows(snapshot);
  const rows = [semanticRow("goal", "", snapshot.goal)];
  for (const allocation of snapshot.allocations || []) {
    const member = namedId(resources, "members", allocation.member_id);
    rows.push(semanticRow(
      `goal-allocation:${allocation.member_id}`,
      `成员分配：${member || `成员 #${allocation.member_id}`}`,
      allocation,
    ));
  }
  return rows.filter(Boolean);
}

function goalRecordRows(snapshot, resources) {
  if (!("goal" in snapshot) && !("allocation" in snapshot) && !("record" in snapshot)) {
    return genericRows(snapshot);
  }
  const memberId = snapshot.allocation?.member_id || snapshot.record?.member_id;
  const member = namedId(resources, "members", memberId);
  return [
    semanticRow("goal", "目标汇总", snapshot.goal),
    semanticRow(
      `goal-allocation:${memberId ?? "unknown"}`,
      `成员进度：${member || (memberId ? `成员 #${memberId}` : "未知成员")}`,
      snapshot.allocation,
    ),
    semanticRow("goal-record", "本次进度记录", snapshot.record),
  ].filter(Boolean);
}

function budgetRows(snapshot, resources) {
  const collections = ["categories", "member_allocations", "category_allocations"];
  if (!collections.some((key) => key in snapshot)) return genericRows(snapshot);
  const plan = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !collections.includes(key) && key !== "allocations"),
  );
  const memberAllocations = snapshot.member_allocations || snapshot.allocations || [];
  const rows = [semanticRow("budget-plan", "", plan)];
  for (const category of snapshot.categories || []) {
    const name = namedId(resources, "categories", category.category_id);
    rows.push(semanticRow(
      `budget-category:${category.category_id}`,
      `分类预算：${name || `分类 #${category.category_id}`}`,
      category,
    ));
  }
  for (const allocation of memberAllocations) {
    const member = namedId(resources, "members", allocation.member_id);
    rows.push(semanticRow(
      `budget-member:${allocation.member_id}`,
      `成员预算：${member || `成员 #${allocation.member_id}`}`,
      allocation,
    ));
  }
  for (const allocation of snapshot.category_allocations || []) {
    const member = namedId(resources, "members", allocation.member_id);
    const category = namedId(resources, "categories", allocation.category_id);
    rows.push(semanticRow(
      `budget-category-member:${allocation.category_id}:${allocation.member_id}`,
      `分类承担：${category || `分类 #${allocation.category_id}`} · ${member || `成员 #${allocation.member_id}`}`,
      allocation,
    ));
  }
  return rows.filter(Boolean);
}

function investmentTradeRows(snapshot) {
  const nested = ["account_before", "account_after", "holding_before", "holding_after"];
  if (!nested.some((key) => key in snapshot)) return genericRows(snapshot);
  const trade = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !nested.includes(key)),
  );
  return [
    semanticRow("investment-trade", "交易事实", trade),
    semanticRow("investment-account", "结算账户", snapshot.account_after, snapshot.account_before),
    semanticRow("investment-holding", "关联持仓", snapshot.holding_after, snapshot.holding_before),
  ].filter(Boolean);
}

function normalizedRows(snapshot, entityType, resources) {
  if (!snapshot) return { historical: false, rows: [] };
  if (snapshot._id_namespace === "historical") return { historical: true, rows: [] };
  if (entityType === "transaction" && ("transaction" in snapshot || "account" in snapshot)) {
    return {
      historical: false,
      rows: [
        semanticRow("transaction", "原流水", snapshot.transaction),
        semanticRow("account", "关联账户", snapshot.account),
      ].filter(Boolean),
    };
  }
  const rows = entityType === "goal"
    ? goalRows(snapshot, resources)
    : entityType === "goal_record"
      ? goalRecordRows(snapshot, resources)
      : entityType === "budget_plan"
        ? budgetRows(snapshot, resources)
        : entityType === "investment_trade"
          ? investmentTradeRows(snapshot)
          : genericRows(snapshot, entityType === "transfer");
  return { historical: false, rows };
}

function displayValue(key, value, snapshot, resources) {
  if (value === undefined || value === null || value === "") return "—";
  if (key === "account_id") {
    const account = resources.accounts.find((item) => String(item.id) === String(value));
    const label = snapshot?.account_name
      ? [snapshot.account_owner, snapshot.account_name].filter(Boolean).join(" · ")
      : account ? [account.owner, account.name].filter(Boolean).join(" · ") : "";
    return label ? `${label}（#${value}）` : `账户 #${value}`;
  }
  if (key === "member_id") {
    return namedId(resources, "members", value) || `成员 #${value}`;
  }
  if (key === "category_id") {
    return namedId(resources, "categories", value) || `分类 #${value}`;
  }
  return LABELS[key]?.[value] ?? String(value);
}

export function auditFieldChanges(event, resources = {}) {
  const before = parseAuditSnapshot(event.before_value);
  const after = parseAuditSnapshot(event.after_value);
  const normalizedResources = {
    accounts: resources.accounts || [],
    members: resources.members || [],
    categories: resources.categories || [],
  };
  if (event.payload_version != null && ![0, 1].includes(Number(event.payload_version))) {
    return { before, after, historical: true, changes: [] };
  }
  const beforeState = normalizedRows(before, event.entity_type, normalizedResources);
  const afterState = normalizedRows(after, event.entity_type, normalizedResources);
  const pairs = new Map();
  for (const row of beforeState.rows) pairs.set(row.key, { before: row.row, label: row.label });
  for (const row of afterState.rows) {
    const previous = pairs.get(row.key);
    pairs.set(row.key, {
      before: previous?.before || row.embeddedBefore,
      after: row.row,
      label: row.label || previous?.label || "",
    });
  }
  const changes = [...pairs.entries()].flatMap(([rowKey, pair]) =>
    Object.entries(FIELDS).flatMap(([key, label]) => {
      if ((pair.before?.[key] ?? null) === (pair.after?.[key] ?? null)) return [];
      return [{
        key: `${rowKey}:${key}`,
        label: pair.label ? `${label}（${pair.label}）` : label,
        before: displayValue(key, pair.before?.[key], pair.before, normalizedResources),
        after: displayValue(key, pair.after?.[key], pair.after, normalizedResources),
      }];
    }));
  return {
    before,
    after,
    historical: beforeState.historical || afterState.historical,
    changes,
  };
}
