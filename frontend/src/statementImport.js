export function rowValue(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find((item) => item.trim().toLowerCase() === alias);
    if (key && String(row[key] ?? "").trim()) return String(row[key]).trim();
  }
  return "";
}

export function parseStatementRows(data, accounts) {
  const rows = [];
  let skipped = 0;
  for (const [index, row] of data.entries()) {
    const source = rowValue(row, ["来源", "source"]);
    const status = rowValue(row, ["状态", "status"]);
    const type = rowValue(row, ["类型", "type"]);
    if (["transfer", "opening", "adjustment"].includes(source)
      || ["转账", "期初余额", "余额调整"].includes(type)
      || ["已撤销", "voided"].includes(status)) {
      skipped += 1;
      continue;
    }
    const accountValue = rowValue(row, ["账户", "account"]);
    const accountId = rowValue(row, ["账户id", "account_id"]);
    const owner = rowValue(row, ["所属人", "owner", "account_owner"]);
    // Names and owner are portable between books; IDs alone are only a fallback.
    const matches = accounts.filter((account) => {
      if (accountValue) return (account.name === accountValue || `${account.owner} · ${account.name}` === accountValue)
        && (!owner || owner === account.owner);
      return String(account.id) === accountId;
    });
    if (matches.length !== 1) throw new Error(`第 ${index + 2} 行账户“${accountValue || accountId}”${matches.length ? "不唯一，请补充所属人" : "不存在，请先建立账户"}`);
    const account = matches[0];
    const amountValue = rowValue(row, ["金额", "amount"]).replace(/[¥￥,$,\s]/g, "");
    const amount = Number(amountValue.replace(/[()]/g, ""));
    if (!Number.isFinite(amount) || amount === 0) throw new Error(`第 ${index + 2} 行金额无效`);
    const directionValue = rowValue(row, ["方向", "direction", "收支", "收支类型", "类型"]).toLowerCase();
    const direction = ["收入", "income", "入"].includes(directionValue) ? "income"
      : ["支出", "expense", "出"].includes(directionValue) || amount < 0 || amountValue.startsWith("(") ? "expense" : null;
    if (!direction) throw new Error(`第 ${index + 2} 行需填写收入或支出方向`);
    const occurredAt = rowValue(row, ["日期", "交易日期", "date", "occurred_at"]).replaceAll("/", "-");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))
      || new Date(occurredAt).toISOString().slice(0, 10) !== occurredAt) throw new Error(`第 ${index + 2} 行日期需为有效的 YYYY-MM-DD`);
    const currency = rowValue(row, ["币种", "currency"]).toUpperCase() || account.currency || "CNY";
    const rateValue = rowValue(row, ["汇率", "exchange_rate_to_base"]);
    const rate = rateValue ? Number(rateValue) : currency === "CNY" ? 1 : null;
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error(`第 ${index + 2} 行必须提供发生时的有效汇率`);
    rows.push({
      account_id: account.id, amount: Math.abs(amount), direction, occurred_at: occurredAt,
      category_name: rowValue(row, ["分类", "category", "category_name"]) || null,
      merchant: rowValue(row, ["商户/来源", "商户", "merchant"]) || null,
      note: rowValue(row, ["备注", "note"]) || null,
      external_id: rowValue(row, ["交易号", "流水号", "external_id"]) || null,
      currency, exchange_rate_to_base: rate,
    });
  }
  return { rows, skipped };
}
