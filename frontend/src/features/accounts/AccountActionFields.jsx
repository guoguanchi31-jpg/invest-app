import FormField from "../../components/FormField";


export default function AccountActionFields({
  actionMode,
  dataScope,
  editTarget,
  familyData,
  form,
  getAccountById,
  handleChange,
  renderAllAccountOptions,
  renderDateButton,
}) {
  const adjustmentAccount = actionMode === "adjustment"
    ? getAccountById?.(form.account_id)
    : null;

  if (actionMode === "account") {
    const currency = (form.currency || "CNY").trim().toUpperCase() || "CNY";
    return (
      <>
        <FormField label="账户名称">
          <input name="name" autoComplete="off" placeholder="例如：招商储蓄卡" value={form.name} onChange={handleChange} />
        </FormField>
        <FormField label="所属成员" help="账户会计入该成员的个人数据，同时汇总到家庭。">
          <select name="member_id" value={form.member_id} onChange={handleChange}>
            <option value="">选择家庭成员</option>
            {familyData.members
              .filter((member) => (
                (dataScope === "family" && familyData.can_manage)
                || member.is_current
              ))
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
          </select>
        </FormField>
        <FormField label="账户类型">
          <select name="type" value={form.type} onChange={handleChange}>
            <option value="debit_card">储蓄卡</option>
            <option value="wallet">电子钱包</option>
            <option value="investment">投资账户</option>
            <option value="deposit">定期存款</option>
            <option value="credit_card">信用卡</option>
          </select>
        </FormField>
        {!editTarget ? (
          <FormField
            label={
              form.type === "investment"
                ? `当前现金可投（${currency}）`
                : form.type === "credit_card"
                  ? `当前待还（${currency}）`
                  : `当前余额（${currency}）`
            }
          >
            <input
              name="balance"
              inputMode="decimal"
              data-number-suffix={` ${currency}`}
              placeholder="0.00"
              value={form.balance}
              onChange={handleChange}
            />
          </FormField>
        ) : null}
        {!editTarget
          ? renderDateButton({ field: "opening_date", label: "建账日期" })
          : null}
        <FormField label="账户币种">
          <input name="currency" maxLength="3" placeholder="CNY" value={form.currency} onChange={handleChange} />
        </FormField>
        {form.currency.trim().toUpperCase() !== "CNY" ? (
          <FormField label="兑人民币汇率">
            <input
              name="exchange_rate_to_base"
              inputMode="decimal"
              data-decimal-scale={6}
              placeholder="例如：7.12"
              value={form.exchange_rate_to_base}
              onChange={handleChange}
            />
          </FormField>
        ) : null}
        <div className="form-hint-card wide">
          <strong>
            {form.type === "investment"
              ? "总额 = 持仓市值 + 现金可投"
              : form.type === "credit_card"
                ? "信用卡自动作为负债账户"
                : "后续余额由流水联动"}
          </strong>
          <span>期初余额和核对调整会单独留痕，不计入收入与支出。</span>
        </div>
        <FormField label="账户尾号">
          <input
            name="last4"
            autoComplete="off"
            inputMode="numeric"
            maxLength="8"
            placeholder="例如：8888"
            value={form.last4}
            onChange={handleChange}
          />
        </FormField>
        {form.type === "credit_card" ? (
          <>
            <FormField label="信用额度">
              <input
                name="credit_limit"
                autoComplete="off"
                inputMode="decimal"
                data-number-suffix={` ${currency}`}
                placeholder="例如：50000"
                value={form.credit_limit}
                onChange={handleChange}
              />
            </FormField>
            <FormField label="账单日">
              <input name="statement_day" autoComplete="off" inputMode="numeric" maxLength="2" placeholder="例如：10" value={form.statement_day} onChange={handleChange} />
            </FormField>
            <FormField label="还款日">
              <input name="repayment_day" autoComplete="off" inputMode="numeric" maxLength="2" placeholder="例如：25" value={form.repayment_day} onChange={handleChange} />
            </FormField>
          </>
        ) : null}
      </>
    );
  }

  if (actionMode === "adjustment") {
    const currency = (adjustmentAccount?.currency || "CNY").trim().toUpperCase() || "CNY";
    const isInvestment = adjustmentAccount?.type === "investment";
    return (
      <>
        <FormField label="账户">
          <select name="account_id" value={form.account_id} onChange={handleChange}>
            <option value="">选择账户</option>
            {renderAllAccountOptions()}
          </select>
        </FormField>
        <FormField
          label={`${isInvestment ? "核对后现金可投" : "核对后余额"}（${currency}）`}
          help={currency === "CNY" ? "" : "请输入账户原币余额；系统按账户汇率折算为人民币。"}
        >
          <input
            name="actual_balance"
            inputMode="decimal"
            data-allow-negative
            data-number-suffix={` ${currency}`}
            value={form.actual_balance}
            onChange={handleChange}
          />
        </FormField>
        {renderDateButton({ field: "occurred_at", label: "核对日期" })}
        <FormField label="调整原因">
          <input name="reason" placeholder="例如：银行余额核对" value={form.reason} onChange={handleChange} />
        </FormField>
      </>
    );
  }

  return null;
}
