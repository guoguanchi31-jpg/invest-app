import { useRef, useState } from "react";
import { Check, Equal } from "lucide-react";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";
import { isValidBusinessDate } from "../shared/businessDate";
import AppFieldNumberPad from "../app/AppFieldNumberPad";
import {
  AppNumberFieldProvider,
  AppNumberInput,
} from "../app/AppNumberFieldContext";

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const almostEqual = (left, right) => Math.abs(left - right) <= 0.01;

const distribute = (total, members) => {
  const cents = Math.round(numberValue(total) * 100);
  if (!members.length) return {};
  const base = Math.floor(cents / members.length);
  let remainder = cents - base * members.length;
  return Object.fromEntries(members.map((member) => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(remainder - 1, 0);
    return [member.id, String(value / 100)];
  }));
};

const planField = (key, label, options = {}) => ({
  allowNegative: false,
  decimalScale: 2,
  key,
  label,
  maxLength: 16,
  prefix: "¥",
  suffix: "",
  ...options,
});

function PlanNumberInput({
  appMode,
  fieldKey,
  fieldLabel,
  ...inputProps
}) {
  if (!appMode) return <input {...inputProps} />;
  return (
    <AppNumberInput
      {...inputProps}
      fieldKey={fieldKey}
      label={fieldLabel}
      prefix="¥"
    />
  );
}

function AllocationSummary({
  label,
  total,
  expected,
  formatMoney,
  zeroMessage = "请先填写总额",
}) {
  const hasExpected = expected > 0;
  const balanced = hasExpected && almostEqual(total, expected);
  const difference = expected - total;
  return (
    <div className={`plan-allocation-summary${balanced ? " balanced" : ""}${hasExpected ? "" : " empty"}`} role="status">
      <span>{label}</span>
      <strong>{formatMoney(total)} / {formatMoney(expected)}</strong>
      <small>
        {!hasExpected
          ? zeroMessage
          : balanced
          ? "已分配完整"
          : difference > 0
            ? `还需分配 ${formatMoney(difference)}`
            : `超出 ${formatMoney(Math.abs(difference))}`}
      </small>
    </div>
  );
}

function GoalAllocationField({
  appMode,
  fieldKey,
  label,
  ariaLabel,
  value,
  disabled = false,
  help,
  onChange,
}) {
  return (
    <label className="goal-allocation-field">
      <span>{label}</span>
      <div className="goal-money-input">
        <span aria-hidden="true">¥</span>
        <PlanNumberInput
          appMode={appMode}
          fieldKey={fieldKey}
          fieldLabel={ariaLabel}
          aria-label={ariaLabel}
          inputMode="decimal"
          placeholder="0"
          disabled={disabled}
          value={value}
          onChange={onChange}
        />
      </div>
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export function BudgetPlanDialog({
  appMode = false,
  budget,
  members,
  formatMoney,
  formatMonthLabel,
  onClose,
  onSave,
}) {
  const [totalAmount, setTotalAmount] = useState(String(budget.family_total_budget || ""));
  const [memberAmounts, setMemberAmounts] = useState(() => Object.fromEntries(
    members.map((member) => {
      const direct = (budget.allocations || []).find(
        (allocation) => allocation.member_id === member.id,
      );
      const legacyTotal = (budget.items || []).reduce((sum, item) => (
        sum + numberValue((item.member_allocations || []).find(
          (allocation) => allocation.member_id === member.id,
        )?.amount)
      ), 0);
      return [member.id, String(direct?.amount ?? (legacyTotal || ""))];
    }),
  ));
  const [activeField, setActiveField] = useState(() => planField(
    "budget-total",
    "家庭总预算",
  ));
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const expected = numberValue(totalAmount);
  const memberTotal = members.reduce(
    (sum, member) => sum + numberValue(memberAmounts[member.id]),
    0,
  );
  const valid = expected > 0
    && members.length > 0
    && almostEqual(memberTotal, expected);
  const budgetProgress = expected > 0
    ? Math.min(Math.max((memberTotal / expected) * 100, 0), 100)
    : 0;
  const budgetStatus = valid
    ? "成员预算已核对"
    : expected <= 0
      ? "请先填写家庭总预算"
      : "成员预算合计需等于家庭总预算";

  const activeBudgetValue = (() => {
    if (activeField?.key === "budget-total") return totalAmount;
    const [, memberId] = String(activeField?.key || "").split(":");
    return memberAmounts[memberId] ?? "";
  })();

  const updateActiveBudgetValue = (value) => {
    if (activeField?.key === "budget-total") {
      setTotalAmount(value);
      return;
    }
    const [, memberId] = String(activeField?.key || "").split(":");
    setMemberAmounts((current) => ({ ...current, [memberId]: value }));
  };

  const submit = async () => {
    if (!valid || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    try {
      await onSave({
        month: budget.month,
        total_amount: expected,
        categories: [],
        member_allocations: members.map((member) => ({
          member_id: member.id,
          amount: numberValue(memberAmounts[member.id]),
        })),
      });
    } catch {
      // The parent reports the API error and keeps the dialog open.
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <AppNumberFieldProvider activeField={activeField} onActivate={setActiveField}>
    <ModalBackdrop
      className={appMode ? "modal-backdrop app-action-layer" : "modal-backdrop"}
      closeDisabled={saving}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName={appMode ? "app-plan-dialog-body" : ""}
        className={[
          "plan-setup-dialog",
          appMode ? "app-action-dialog app-plan-dialog app-budget-plan-dialog" : "",
        ].filter(Boolean).join(" ")}
        closeDisabled={saving}
        eyebrow={formatMonthLabel(budget.month)}
        initialFocusSelector={appMode
          ? ".modal-close"
          : ""}
        footer={appMode ? (
          <AppFieldNumberPad
            activeField={activeField}
            disabled={saving}
            onSubmit={() => { void submit(); }}
            onValueChange={updateActiveBudgetValue}
            status={budgetStatus}
            statusReady={valid}
            submitDisabled={!valid}
            submitLabel="保存预算"
            value={activeBudgetValue}
          />
        ) : (
          <DialogActions>
            <DialogAction variant="primary" disabled={!valid || saving} onClick={submit}>
              <Check size={17} />
              {saving ? "保存中…" : "保存家庭预算"}
            </DialogAction>
            <DialogAction disabled={saving} onClick={onClose}>取消</DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title={budget.id ? "调整家庭预算" : "新建家庭预算"}
      >
        <div className={`plan-total-field${appMode ? " app-plan-total-card" : ""}`}>
          <label htmlFor="budget-total">月度总预算</label>
          <PlanNumberInput
            appMode={appMode}
            fieldKey="budget-total"
            fieldLabel="家庭总预算"
            id="budget-total"
            inputMode="decimal"
            autoFocus={!appMode}
            placeholder="0.00"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
          />
          <span>只需设置每位成员本月可用的总预算，无需再拆分消费分类。</span>
          {appMode ? (
            <div className="app-plan-progress" aria-label={`预算已分配 ${Math.round(budgetProgress)}%`}>
              <div>
                <strong>{Math.round(budgetProgress)}%</strong>
                <span>{formatMoney(memberTotal)} / {formatMoney(expected)}</span>
              </div>
              <i><b style={{ width: `${budgetProgress}%` }} /></i>
            </div>
          ) : null}
        </div>

        <section className="plan-split-section">
          <div className="plan-split-heading">
            <div>
              <h3>成员月度预算</h3>
              <p>每位成员的实际支出按其名下账户统计。</p>
            </div>
            <AllocationSummary
              label="成员合计"
              total={memberTotal}
              expected={expected}
              formatMoney={formatMoney}
            />
          </div>
          <div className="plan-equal-actions">
            <button
              type="button"
              className="plan-equal-button"
              disabled={expected <= 0}
              onClick={() => setMemberAmounts(distribute(totalAmount, members))}
            >
              <Equal size={14} /> 平均分配
            </button>
          </div>
          <div className="budget-member-allocation-list">
            {members.map((member) => (
              <label className="budget-member-allocation-row" key={member.id}>
                <strong>{member.display_name}</strong>
                <span>本月总预算</span>
                <PlanNumberInput
                  appMode={appMode}
                  fieldKey={`budget-member:${member.id}`}
                  fieldLabel={`${member.display_name}月度总预算`}
                  aria-label={`${member.display_name}月度总预算`}
                  inputMode="decimal"
                  value={memberAmounts[member.id] ?? ""}
                  onChange={(event) => setMemberAmounts((current) => ({
                    ...current,
                    [member.id]: event.target.value,
                  }))}
                />
              </label>
            ))}
          </div>
        </section>
      </ModalPanel>
    </ModalBackdrop>
    </AppNumberFieldProvider>
  );
}

export function GoalPlanDialog({
  appMode = false,
  goal,
  members,
  formatMoney,
  onClose,
  onSave,
}) {
  const editing = Boolean(goal?.id);
  const [name, setName] = useState(goal?.name || "");
  const [targetAmount, setTargetAmount] = useState(String(goal?.family_target_amount ?? goal?.target_amount ?? ""));
  const [monthlySaving, setMonthlySaving] = useState(String(goal?.family_monthly_saving ?? goal?.monthly_saving ?? ""));
  const [dueDate, setDueDate] = useState(goal?.due_date || "");
  const [allocations, setAllocations] = useState(() => Object.fromEntries(
    members.map((member) => {
      const existing = (goal?.allocations || []).find((item) => item.member_id === member.id);
      return [member.id, {
        target_amount: String(existing?.target_amount ?? ""),
        current_amount: String(existing?.current_amount ?? ""),
        monthly_saving: String(existing?.monthly_saving ?? ""),
      }];
    }),
  ));
  const [activeField, setActiveField] = useState(() => planField(
    "goal-target",
    "家庭目标总额",
  ));
  const [textEditing, setTextEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const activeAllocations = members.filter((member) => {
    const item = allocations[member.id] || {};
    return numberValue(item.target_amount) > 0
      || numberValue(item.current_amount) > 0
      || numberValue(item.monthly_saving) > 0;
  });
  const targetTotal = activeAllocations.reduce(
    (sum, member) => sum + numberValue(allocations[member.id]?.target_amount),
    0,
  );
  const monthlyTotal = activeAllocations.reduce(
    (sum, member) => sum + numberValue(allocations[member.id]?.monthly_saving),
    0,
  );
  const invalidCurrent = activeAllocations.some((member) => (
    numberValue(allocations[member.id]?.current_amount) > numberValue(allocations[member.id]?.target_amount)
  ));
  const invalidNegative = members.some((member) => (
    numberValue(allocations[member.id]?.target_amount) < 0
    || numberValue(allocations[member.id]?.current_amount) < 0
    || numberValue(allocations[member.id]?.monthly_saving) < 0
  ));
  const normalizedDueDate = dueDate.trim();
  const validDueDate = !normalizedDueDate || isValidBusinessDate(normalizedDueDate);
  const valid = name.trim()
    && numberValue(targetAmount) > 0
    && validDueDate
    && activeAllocations.length > 0
    && !invalidCurrent
    && !invalidNegative
    && almostEqual(targetTotal, numberValue(targetAmount))
    && almostEqual(monthlyTotal, numberValue(monthlySaving));
  const validationMessage = (() => {
    if (!name.trim()) return "请填写目标名称";
    if (numberValue(targetAmount) <= 0) return "请填写大于 0 的家庭目标总额";
    if (!validDueDate) return "计划完成日期必须是有效的 YYYY-MM-DD";
    if (invalidNegative) return "目标份额、已积累和每月计划不能为负数";
    if (!activeAllocations.length) return "请至少为一位成员填写目标份额";
    if (invalidCurrent) return "成员已积累金额不能超过其目标份额";
    if (!almostEqual(targetTotal, numberValue(targetAmount))) {
      return "成员目标份额合计必须等于家庭目标总额";
    }
    if (!almostEqual(monthlyTotal, numberValue(monthlySaving))) {
      return "成员每月计划合计必须等于家庭每月计划";
    }
    return editing ? "分配已核对，可以保存调整" : "分配已核对，可以创建目标";
  })();
  const activeGoalValue = (() => {
    if (activeField?.key === "goal-target") return targetAmount;
    if (activeField?.key === "goal-monthly") return monthlySaving;
    const [, memberId, field] = String(activeField?.key || "").split(":");
    return allocations[memberId]?.[field] ?? "";
  })();

  const updateAllocation = (memberId, field, value) => {
    setAllocations((current) => ({
      ...current,
      [memberId]: { ...current[memberId], [field]: value },
    }));
  };

  const updateActiveGoalValue = (value) => {
    if (activeField?.key === "goal-target") {
      setTargetAmount(value);
      return;
    }
    if (activeField?.key === "goal-monthly") {
      setMonthlySaving(value);
      return;
    }
    const [, memberId, field] = String(activeField?.key || "").split(":");
    updateAllocation(memberId, field, value);
  };

  const submit = async () => {
    if (!valid || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        target_amount: numberValue(targetAmount),
        monthly_saving: numberValue(monthlySaving),
        due_date: normalizedDueDate || null,
        allocations: activeAllocations.map((member) => ({
          member_id: member.id,
          target_amount: numberValue(allocations[member.id].target_amount),
          current_amount: editing ? null : numberValue(allocations[member.id].current_amount),
          monthly_saving: numberValue(allocations[member.id].monthly_saving),
        })),
        ...(!editing ? { status: "active" } : {}),
      });
    } catch {
      // The parent reports the API error and keeps the dialog open.
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const distributeField = (field, total) => {
    const values = distribute(total, members);
    setAllocations((current) => Object.fromEntries(members.map((member) => [
      member.id,
      { ...current[member.id], [field]: values[member.id] },
    ])));
  };

  return (
    <AppNumberFieldProvider
      activeField={activeField}
      onActivate={(field) => {
        setActiveField(field);
        setTextEditing(false);
      }}
    >
    <ModalBackdrop
      className={appMode ? "modal-backdrop app-action-layer" : "modal-backdrop"}
      closeDisabled={saving}
      onClose={onClose}
    >
      <ModalPanel
        bodyClassName={appMode ? "app-plan-dialog-body" : ""}
        className={[
          "plan-setup-dialog goal-setup-dialog",
          appMode ? "app-action-dialog app-plan-dialog app-goal-plan-dialog" : "",
        ].filter(Boolean).join(" ")}
        closeDisabled={saving}
        eyebrow="家庭共同计划"
        initialFocusSelector={appMode
          ? ".modal-close"
          : ""}
        footer={appMode ? (
          <AppFieldNumberPad
            activeField={activeField}
            disabled={saving}
            onSubmit={() => { void submit(); }}
            onValueChange={updateActiveGoalValue}
            status={validationMessage}
            statusReady={valid}
            submitDisabled={!valid}
            submitLabel={editing ? "保存目标" : "创建目标"}
            textEditing={textEditing}
            value={activeGoalValue}
          />
        ) : (
          <DialogActions>
            <DialogAction variant="primary" disabled={!valid || saving} onClick={submit}>
              <Check size={17} />
              {saving ? "保存中…" : editing ? "保存目标调整" : "创建家庭目标"}
            </DialogAction>
            <DialogAction disabled={saving} onClick={onClose}>取消</DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title={editing ? "调整家庭目标" : "创建家庭目标"}
      >
        <div
          className={appMode ? "app-plan-content" : ""}
          onBlurCapture={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof HTMLInputElement) || next.readOnly) {
              setTextEditing(false);
            }
          }}
          onFocusCapture={(event) => {
            const target = event.target;
            setTextEditing(
              appMode
              && target instanceof HTMLInputElement
              && !target.readOnly
              && target.dataset.appNumberField !== "true",
            );
          }}
        >
        <section className="goal-basics-section" aria-labelledby="goal-basics-title">
          <div className="goal-form-section-heading">
            <div>
              <h3 id="goal-basics-title">目标设置</h3>
              <p>先确定家庭总目标，再把目标份额和每月计划分配给成员。</p>
            </div>
          </div>
          <div className="quick-add financial-form goal-basics-grid">
            <label className="form-field goal-name-field">
              <span>目标名称</span>
              <input
                aria-label="目标名称"
                autoFocus={!appMode}
                placeholder="例如：旅行基金"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>家庭目标总额（元）</span>
              <PlanNumberInput
                appMode={appMode}
                fieldKey="goal-target"
                fieldLabel="家庭目标总额"
                aria-label="家庭目标总额"
                inputMode="decimal"
                placeholder="0.00"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>家庭每月计划（元）</span>
              <PlanNumberInput
                appMode={appMode}
                fieldKey="goal-monthly"
                fieldLabel="家庭每月计划"
                aria-label="家庭每月计划"
                inputMode="decimal"
                placeholder="0.00"
                value={monthlySaving}
                onChange={(event) => setMonthlySaving(event.target.value)}
              />
            </label>
            <label className="form-field goal-date-field">
              <span>计划完成日期（可选）</span>
              <input
                aria-label="目标日期"
                aria-invalid={!validDueDate}
                inputMode="numeric"
                maxLength={10}
                placeholder="例如：2027-12-31"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="plan-split-section goal-allocation-section">
          <div className="plan-split-heading">
            <div>
              <h3>成员分配</h3>
              <p>目标份额与每月计划的成员合计，必须分别等于上方家庭金额。</p>
            </div>
            <div className="goal-allocation-summaries">
              <AllocationSummary label="目标份额" total={targetTotal} expected={numberValue(targetAmount)} formatMoney={formatMoney} zeroMessage="请先填写家庭目标总额" />
              <AllocationSummary label="每月计划" total={monthlyTotal} expected={numberValue(monthlySaving)} formatMoney={formatMoney} zeroMessage="暂未设置每月计划" />
            </div>
          </div>
          <div className="plan-equal-actions">
            <button
              type="button"
              className="plan-equal-button"
              disabled={numberValue(targetAmount) <= 0}
              onClick={() => distributeField("target_amount", targetAmount)}
            >
              <Equal size={15} /> 平均分配目标额
            </button>
            <button
              type="button"
              className="plan-equal-button"
              disabled={numberValue(monthlySaving) <= 0}
              onClick={() => distributeField("monthly_saving", monthlySaving)}
            >
              <Equal size={15} /> 平均分配每月计划
            </button>
          </div>
          <div className="goal-member-allocation-list">
            {members.map((member) => (
              <div className="goal-member-allocation-row" key={member.id}>
                <div className="goal-member-identity">
                  <strong>{member.display_name}</strong>
                  <small>成员目标分配</small>
                </div>
                <GoalAllocationField
                  appMode={appMode}
                  fieldKey={`goal-member:${member.id}:target_amount`}
                  label="目标份额"
                  ariaLabel={`${member.display_name}目标额`}
                  value={allocations[member.id]?.target_amount ?? ""}
                  onChange={(event) => updateAllocation(member.id, "target_amount", event.target.value)}
                />
                <GoalAllocationField
                  appMode={appMode}
                  fieldKey={`goal-member:${member.id}:monthly_saving`}
                  label="每月计划"
                  ariaLabel={`${member.display_name}每月计划`}
                  value={allocations[member.id]?.monthly_saving ?? ""}
                  onChange={(event) => updateAllocation(member.id, "monthly_saving", event.target.value)}
                />
                <GoalAllocationField
                  appMode={appMode}
                  fieldKey={`goal-member:${member.id}:current_amount`}
                  label={editing ? "当前已积累" : "初始已积累"}
                  ariaLabel={`${member.display_name}${editing ? "当前已存" : "初始已存"}`}
                  disabled={editing}
                  value={allocations[member.id]?.current_amount ?? ""}
                  help={editing ? "由存取记录自动计算" : "只记录进度，不扣减账户余额"}
                  onChange={(event) => updateAllocation(member.id, "current_amount", event.target.value)}
                />
              </div>
            ))}
          </div>
          <p className={`goal-form-status${valid ? " ready" : ""}`} role="status">
            {validationMessage}
          </p>
        </section>
        </div>
      </ModalPanel>
    </ModalBackdrop>
    </AppNumberFieldProvider>
  );
}
