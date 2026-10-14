import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import ModalBackdrop from "../components/ModalBackdrop";
import ModalPanel from "../components/ModalPanel";
import { todayInputValue } from "../shared/businessDate";
import AppAmountPad from "./AppAmountPad";

export default function AppGoalRecordComposer({
  canManageFamily,
  form,
  handleChange,
  handleSubmitAction,
  isDatePickerOpen,
  isSubmitting,
  onClose,
  renderDateButton,
}) {
  const [moreOpen, setMoreOpen] = useState(
    Boolean(form.occurred_at !== todayInputValue()),
  );
  const selectedAllocation = (form.goal_allocations || []).find(
    (allocation) => String(allocation.member_id) === String(form.member_id),
  );

  const changeField = (name, value) => {
    handleChange({ target: { name, value } });
  };

  return (
    <ModalBackdrop
      className={`modal-backdrop app-transaction-layer${isDatePickerOpen ? " modal-backdrop-muted" : ""}`}
      closeDisabled={isDatePickerOpen || isSubmitting}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName="app-transaction-body app-goal-record-body"
        className="app-transaction-dialog app-goal-record-dialog"
        closeDisabled={isDatePickerOpen || isSubmitting}
        eyebrow="目标资金不会改变总资产"
        footer={(
          <AppAmountPad
            amount={form.amount || ""}
            currencySymbol="¥"
            dateValue={form.occurred_at}
            disabled={isSubmitting}
            note={form.note || ""}
            notePlaceholder="添加目标存取备注"
            onAmountChange={(value) => changeField("amount", value)}
            onDateToday={() => changeField("occurred_at", todayInputValue())}
            onNoteChange={handleChange}
            onSubmit={(finalAmount) => {
              void handleSubmitAction({
                formOverride: { ...form, amount: finalAmount },
              });
            }}
            submitDisabled={!form.goal_id}
            submitLabel={form.goal_record_type === "withdraw" ? "取出" : "存入"}
          />
        )}
        onClose={onClose}
        title={form.goal_record_type === "withdraw" ? "从目标取出" : "存入目标"}
      >
        <section className="app-goal-record-target">
          <span><Target size={21} aria-hidden="true" /></span>
          <div>
            <small>当前目标</small>
            <strong>{form.name || "储蓄目标"}</strong>
          </div>
          {selectedAllocation ? (
            <div>
              <small>{selectedAllocation.member_name}</small>
              <strong>¥{Number(selectedAllocation.current_amount || 0).toLocaleString("zh-CN")}</strong>
            </div>
          ) : null}
        </section>

        <div className="app-transaction-direction" role="tablist" aria-label="目标存取类型">
          {[
            { value: "deposit", label: "存入" },
            { value: "withdraw", label: "取出" },
          ].map((option) => (
            <button
              type="button"
              role="tab"
              aria-selected={form.goal_record_type === option.value}
              className={form.goal_record_type === option.value ? "active" : ""}
              disabled={isSubmitting}
              key={option.value}
              onClick={() => changeField("goal_record_type", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {canManageFamily ? (
          <label className="app-goal-record-member">
            <span>记录成员</span>
            <select
              name="member_id"
              aria-label="目标记录成员"
              disabled={isSubmitting}
              value={form.member_id || ""}
              onChange={handleChange}
            >
              {(form.goal_allocations || []).map((allocation) => (
                <option key={allocation.member_id} value={allocation.member_id}>
                  {allocation.member_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <section className={`app-transaction-more${moreOpen ? " is-open" : ""}`}>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span>更多信息</span>
            <ChevronDown size={17} aria-hidden="true" />
          </button>
          {moreOpen ? <div className="single">
            {renderDateButton({ field: "occurred_at", label: "日期" })}
          </div> : null}
        </section>
      </ModalPanel>
    </ModalBackdrop>
  );
}
