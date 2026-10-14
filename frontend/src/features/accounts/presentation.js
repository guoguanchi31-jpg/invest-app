const ACCOUNT_CARD_PALETTE = [
  "forest",
  "sunset",
  "indigo",
  "teal",
  "plum",
  "coral",
  "ocean",
  "copper",
];

const ACCOUNT_TYPE_ICONS = {
  debit_card: "💳",
  wallet: "👛",
  investment: "📈",
  deposit: "🏛️",
  credit_card: "💎",
};

const ACCOUNT_TYPE_LABELS = {
  debit_card: "储蓄卡",
  wallet: "电子钱包",
  investment: "投资账户",
  deposit: "定期存款",
  credit_card: "信用卡",
};


export function buildAccountViews({
  accountsData,
  colors,
  formatMoney,
  normalizeOwner,
}) {
  const accounts = accountsData?.accounts || [];
  const assetAccounts = accounts
    .filter((account) => !account.is_liability)
    .map((account, index) => ({
      id: account.id,
      member_id: account.member_id,
      can_edit: account.can_edit !== false,
      name: account.name,
      type: account.type,
      owner: normalizeOwner(account.owner || account.institution),
      currency: account.currency || "CNY",
      exchange_rate_to_base: account.exchange_rate_to_base ?? 1,
      cash_available: account.cash_available || 0,
      cash_available_original:
        account.cash_available_original ?? account.cash_available ?? 0,
      holdings_value: account.holdings_value || 0,
      bank: account.type === "investment"
        ? `持仓 ${formatMoney(account.holdings_value || 0)} · 现金可投 ${formatMoney(account.cash_available || 0)}`
        : `${ACCOUNT_TYPE_LABELS[account.type] || "账户"}${account.last4 ? ` ···· ${account.last4}` : ""}`,
      balance: account.balance,
      original_balance: account.original_balance ?? account.balance,
      opened_at: account.opened_at,
      last4: account.last4,
      credit_limit: account.credit_limit,
      statement_day: account.statement_day,
      repayment_day: account.repayment_day,
      is_liability: account.is_liability,
      color: ACCOUNT_CARD_PALETTE[index % ACCOUNT_CARD_PALETTE.length],
      icon: ACCOUNT_TYPE_ICONS[account.type] || "🏦",
    }));
  const creditAccounts = accounts
    .filter((account) => account.is_liability)
    .map((account) => ({
      id: account.id,
      member_id: account.member_id,
      can_edit: account.can_edit !== false,
      name: account.name,
      type: account.type,
      owner: normalizeOwner(account.owner || account.institution),
      currency: account.currency || "CNY",
      exchange_rate_to_base: account.exchange_rate_to_base ?? 1,
      code: `··· ${account.last4 || "----"} · 额度${Math.round((account.credit_limit || 0) / 10000)}万`,
      bill: account.balance,
      balance: account.balance,
      original_balance: account.original_balance ?? account.balance,
      opened_at: account.opened_at,
      last4: account.last4,
      credit_limit: account.credit_limit,
      statement_day: account.statement_day,
      repayment_day: account.repayment_day,
      is_liability: account.is_liability,
      due: account.repayment_day ? `${account.repayment_day}日` : "待设置",
    }));
  const ownerGroups = assetAccounts.reduce((groups, account) => {
    const owner = normalizeOwner(account.owner);
    const group = groups.find((item) => item.owner === owner);
    if (group) {
      group.accounts.push(account);
      group.total += Number(account.balance || 0);
      return groups;
    }
    groups.push({
      owner,
      total: Number(account.balance || 0),
      accounts: [account],
    });
    return groups;
  }, []);
  const distribution = (accountsData?.distribution || []).map(
    (item, index) => ({
      ...item,
      color: colors[index % colors.length],
    }),
  );
  return {
    accountDistributionView: distribution,
    accountOwnerGroups: ownerGroups,
    assetAccountsView: assetAccounts,
    creditAccountsView: creditAccounts,
  };
}


export { ACCOUNT_TYPE_LABELS };
