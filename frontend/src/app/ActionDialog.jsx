import { lazy, Suspense } from "react";
import { Check, Plus } from "lucide-react";
import DialogActions, { DialogAction } from "../components/DialogActions";
import ModalBackdrop from "../components/ModalBackdrop";
import ModalPanel from "../components/ModalPanel";
import { BudgetPlanDialog, GoalPlanDialog } from "../components/PlanSetupDialog";
import { actionDefinitions } from "./actionDefinitions";

const AppTransactionComposer = lazy(() => import("./AppTransactionComposer"));
const AppTransferComposer = lazy(() => import("./AppTransferComposer"));
const AppGoalRecordComposer = lazy(() => import("./AppGoalRecordComposer"));
const AppComplexActionComposer = lazy(() => import("./AppComplexActionComposer"));

export default function ActionDialog({
  actionMode, budgetData, categoriesData, dataScope, editTarget,
  familyData, form, formatMoney, formatMonthLabel, handleDelete,
  handleSubmitAction, isDatePickerOpen, isOpen, isSubmitting,
  onClose, onSaveBudget, onSaveGoal, selectedMonth, ...fieldProps
}) {
  if (!isOpen) return null;
  const members = familyData.members.filter((member) => member.login_enabled !== false);
  const useAppExperience = fieldProps.useAppExperience;
  if (actionMode === "budget") {
    return (
      <BudgetPlanDialog
        appMode={useAppExperience}
        budget={{ ...budgetData, month: selectedMonth }}
        categories={categoriesData}
        members={members}
        formatMoney={formatMoney}
        formatMonthLabel={formatMonthLabel}
        onClose={onClose}
        onSave={onSaveBudget}
      />
    );
  }
  if (actionMode === "goal") {
    return (
      <GoalPlanDialog
        appMode={useAppExperience}
        goal={editTarget?.item || null}
        members={members}
        formatMoney={formatMoney}
        onClose={onClose}
        onSave={onSaveGoal}
      />
    );
  }
  if (
    actionMode === "transaction"
    && !editTarget
    && useAppExperience
  ) {
    return (
      <Suspense fallback={null}>
        <AppTransactionComposer
          {...fieldProps}
          categoriesData={categoriesData}
          form={form}
          handleSubmitAction={handleSubmitAction}
          isDatePickerOpen={isDatePickerOpen}
          isSubmitting={isSubmitting}
          onClose={onClose}
        />
      </Suspense>
    );
  }
  if (actionMode === "transfer" && !editTarget && useAppExperience) {
    return (
      <Suspense fallback={null}>
        <AppTransferComposer
          {...fieldProps}
          form={form}
          handleSubmitAction={handleSubmitAction}
          isDatePickerOpen={isDatePickerOpen}
          isSubmitting={isSubmitting}
          onClose={onClose}
        />
      </Suspense>
    );
  }
  if (actionMode === "goal_record" && !editTarget && useAppExperience) {
    return (
      <Suspense fallback={null}>
        <AppGoalRecordComposer
          {...fieldProps}
          canManageFamily={dataScope === "family" && familyData.can_manage}
          form={form}
          handleSubmitAction={handleSubmitAction}
          isDatePickerOpen={isDatePickerOpen}
          isSubmitting={isSubmitting}
          onClose={onClose}
        />
      </Suspense>
    );
  }
  const definition = actionDefinitions[actionMode];
  const Fields = definition.Fields;
  const title = editTarget ? definition.editTitle : definition.title;
  const resolvedTitle = typeof title === "function" ? title(form) : title;
  if (useAppExperience) {
    return (
      <Suspense fallback={null}>
        <AppComplexActionComposer
          Fields={Fields}
          actionMode={actionMode}
          categoriesData={categoriesData}
          dataScope={dataScope}
          editTarget={editTarget}
          familyData={familyData}
          fieldProps={fieldProps}
          form={form}
          getAccountById={fieldProps.getAccountById}
          handleChange={fieldProps.handleChange}
          handleDelete={handleDelete}
          handleSubmitAction={handleSubmitAction}
          isDatePickerOpen={isDatePickerOpen}
          isSubmitting={isSubmitting}
          onClose={onClose}
          title={resolvedTitle}
        />
      </Suspense>
    );
  }
  return (
    <ModalBackdrop
      className={[
        "modal-backdrop",
        isDatePickerOpen ? "modal-backdrop-muted" : "",
      ].filter(Boolean).join(" ")}
      closeDisabled={isDatePickerOpen || isSubmitting}
      onClose={onClose}
    >
      <ModalPanel
        closeDisabled={isSubmitting}
        eyebrow={editTarget ? "编辑数据" : "录入数据"}
        footer={(
          <DialogActions>
            <DialogAction variant="primary" disabled={isSubmitting} onClick={() => handleSubmitAction()}>
              <Check size={16} />
              {isSubmitting ? "保存中…" : editTarget ? "保存修改" : "完成"}
            </DialogAction>
            {definition.canRepeat && !editTarget ? (
              <DialogAction disabled={isSubmitting} onClick={() => handleSubmitAction({ keepOpen: true })}>
                <Plus size={16} />再记一笔
              </DialogAction>
            ) : null}
            <DialogAction disabled={isSubmitting} onClick={onClose}>取消</DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title={resolvedTitle}
      >
        <fieldset className="quick-add financial-form" disabled={isSubmitting}>
          <Fields
            {...fieldProps}
            actionMode={actionMode}
            categoriesData={categoriesData}
            dataScope={dataScope}
            editTarget={editTarget}
            familyData={familyData}
            form={form}
            canManageFamily={dataScope === "family" && familyData.can_manage}
          />
        </fieldset>
        {editTarget ? (
          <div className="modal-danger-zone">
            <div>
              <strong>{editTarget.type === "account" ? "归档账户" : "删除当前数据"}</strong>
              <span>{editTarget.type === "account"
                ? "清空余额和持仓后可归档，历史记录保留。"
                : "删除后会同步更新看板、图表和汇总数据。"}</span>
            </div>
            <button
              type="button"
              className="danger-button"
              disabled={isSubmitting}
              onClick={() => handleDelete(editTarget.type, editTarget.id)}
            >
              {editTarget.type === "account" ? "归档" : "删除"}
            </button>
          </div>
        ) : null}
      </ModalPanel>
    </ModalBackdrop>
  );
}
