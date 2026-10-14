import FormField from "../../components/FormField";


export default function GoalRecordFields({
  actionMode,
  canManageFamily,
  form,
  handleChange,
  renderDateButton,
}) {
  if (actionMode !== "goal_record") return null;
  return (
    <>
      <div className="form-hint-card wide">
        <strong>{form.name}</strong>
        <span>目标资金是已有资产的用途分配，不会改变总资产。</span>
      </div>
      <FormField label="操作">
        <select name="goal_record_type" value={form.goal_record_type} onChange={handleChange}>
          <option value="deposit">存入</option>
          <option value="withdraw">取出</option>
        </select>
      </FormField>
      {canManageFamily ? (
        <FormField label="记录成员" help="本次存取只计入所选成员的目标份额。">
          <select name="member_id" value={form.member_id} onChange={handleChange}>
            {(form.goal_allocations || []).map((allocation) => (
              <option key={allocation.member_id} value={allocation.member_id}>
                {allocation.member_name}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      <FormField label="金额">
        <input name="amount" autoFocus inputMode="decimal" placeholder="0.00" value={form.amount} onChange={handleChange} />
      </FormField>
      {renderDateButton({ field: "occurred_at", label: "日期" })}
      <FormField label="备注">
        <input name="note" placeholder="可选" value={form.note} onChange={handleChange} />
      </FormField>
    </>
  );
}
