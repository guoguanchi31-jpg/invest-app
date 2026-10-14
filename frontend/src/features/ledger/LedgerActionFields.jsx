import FormField from "../../components/FormField";
import CategoryPicker from "../../components/CategoryPicker";
import {
  accountCurrency,
  originalBalance,
  originalMoney,
} from "../../settlement";


function TransactionFields({
  categoriesData,
  form,
  handleChange,
  renderAllAccountOptions,
  renderDateButton,
}) {
  return (
    <>
      <FormField label="金额">
        <input
          name="amount"
          autoFocus
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={handleChange}
        />
      </FormField>
      <FormField label="类型">
        <select name="direction" value={form.direction} onChange={handleChange}>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
      </FormField>
      <FormField label="分类">
        <CategoryPicker
          categories={categoriesData}
          direction={form.direction}
          value={form.category_name}
          onChange={handleChange}
        />
      </FormField>
      <FormField label="账户">
        <select name="account_id" value={form.account_id} onChange={handleChange}>
          <option value="">选择账户</option>
          {renderAllAccountOptions()}
        </select>
      </FormField>
      {renderDateButton({ field: "occurred_at", label: "日期" })}
      <details className="optional-fields wide" open={Boolean(form.merchant || form.note)}>
        <summary>商户与备注</summary>
        <div>
          <FormField label="商户 / 来源">
            <input name="merchant" placeholder="例如：盒马 / 公司工资" value={form.merchant} onChange={handleChange} />
          </FormField>
          <FormField label="备注">
            <input name="note" placeholder="补充说明" value={form.note} onChange={handleChange} />
          </FormField>
        </div>
      </details>
    </>
  );
}


function TransferFields({
  form,
  getAccountById,
  handleChange,
  renderAccountOptions,
  renderAccountOwnerOptions,
  renderDateButton,
}) {
  const fromAccount = getAccountById(form.from_account_id);
  const toAccount = getAccountById(form.to_account_id);
  const sameCurrency = accountCurrency(fromAccount) === accountCurrency(toAccount);
  const received = Number(sameCurrency ? form.amount : form.to_amount);
  return (
    <>
      <FormField label="转出用户" help="先选择转出账户所属用户。">
        <select name="from_account_owner" value={form.from_account_owner} onChange={handleChange}>
          {renderAccountOwnerOptions()}
        </select>
      </FormField>
      <FormField label="转出账户" help="只展示所选用户的账户。">
        <select name="from_account_id" value={form.from_account_id} onChange={handleChange}>
          <option value="">转出账户</option>
          {renderAccountOptions(form.from_account_owner)}
        </select>
      </FormField>
      <FormField label="转入用户" help="先选择转入账户所属用户。">
        <select name="to_account_owner" value={form.to_account_owner} onChange={handleChange}>
          {renderAccountOwnerOptions()}
        </select>
      </FormField>
      <FormField label="转入账户" help="只展示所选用户的账户。">
        <select name="to_account_id" value={form.to_account_id} onChange={handleChange}>
          <option value="">转入账户</option>
          {renderAccountOptions(form.to_account_owner)}
        </select>
      </FormField>
      <FormField
        label={`付款金额 (${accountCurrency(fromAccount)})`}
        help={
          form.repayment_account_id && !sameCurrency
            ? "按估值汇率预估，请按实际付款修改；金额使用转出账户原币。"
            : "按转出账户原币填写，不计入收入或支出。"
        }
      >
        <input
          name="amount"
          inputMode="decimal"
          data-number-suffix={` ${accountCurrency(fromAccount)}`}
          placeholder="例如：3000"
          value={form.amount}
          onChange={handleChange}
        />
      </FormField>
      {!sameCurrency ? (
        <FormField
          label={`实际到账 (${accountCurrency(toAccount)})`}
          help="填写已扣除换汇费用的实际到账金额，本次结算汇率会单独保存。"
        >
          <input
            name="to_amount"
            inputMode="decimal"
            data-number-suffix={` ${accountCurrency(toAccount)}`}
            placeholder="0.00"
            value={form.to_amount}
            onChange={handleChange}
          />
        </FormField>
      ) : null}
      <div className="form-hint-card wide" aria-live="polite">
        <strong>
          付款 {originalMoney(Number(form.amount || 0), accountCurrency(fromAccount))}
          {" → "}
          到账 {originalMoney(received || 0, accountCurrency(toAccount))}
        </strong>
        <span>
          {sameCurrency
            ? "同币种按原币 1:1 划转。"
            : Number(form.amount) > 0 && received > 0
              ? `本次结算：1 ${accountCurrency(fromAccount)} = ${(received / Number(form.amount)).toFixed(6)} ${accountCurrency(toAccount)}`
              : "请填写两端实际金额，确认后再保存。"}
        </span>
        {fromAccount ? (
          <span>
            转出后{fromAccount.is_liability ? "待还" : fromAccount.type === "investment" ? "现金可投" : "余额"}：
            {originalMoney(
              originalBalance(fromAccount)
                + Number(form.amount || 0) * (fromAccount.is_liability ? 1 : -1),
              accountCurrency(fromAccount),
            )}
          </span>
        ) : null}
        {toAccount ? (
          <span>
            转入后{toAccount.is_liability ? "待还（负数为溢缴款）" : toAccount.type === "investment" ? "现金可投" : "余额"}：
            {originalMoney(
              originalBalance(toAccount)
                + (received || 0) * (toAccount.is_liability ? -1 : 1),
              accountCurrency(toAccount),
            )}
          </span>
        ) : null}
      </div>
      {renderDateButton({
        field: "occurred_at",
        label: "划转日期",
        help: "用于记录本次资金移动发生的日期。",
      })}
      <FormField label="备注" help="可选，例如储蓄转投资、还信用卡等。">
        <input name="note" placeholder="例如：储蓄转入投资账户" value={form.note} onChange={handleChange} />
      </FormField>
    </>
  );
}


export default function LedgerActionFields(props) {
  if (props.actionMode === "transaction") {
    return <TransactionFields {...props} />;
  }
  if (props.actionMode === "transfer") {
    return <TransferFields {...props} />;
  }
  return null;
}
