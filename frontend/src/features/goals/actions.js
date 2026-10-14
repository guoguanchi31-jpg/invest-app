import { deleteJson, patchJson, postJson } from "../../api";
import { requireAction } from "../shared/actionErrors";


export async function submitGoalRecord({ form, mode, requestOptions }) {
  if (mode !== "goal_record") return null;
  requireAction(form.goal_id && form.amount, "请填写存取金额");
  const amount = Math.abs(Number(form.amount))
    * (form.goal_record_type === "withdraw" ? -1 : 1);
  await postJson(
    `/goals/${form.goal_id}/records`,
    {
      amount,
      recorded_at: form.occurred_at,
      note: form.note,
      ...(form.member_id ? { member_id: Number(form.member_id) } : {}),
    },
    requestOptions,
  );
  return {};
}


export async function saveGoalPlan({
  editTarget,
  payload,
  requestOptions,
}) {
  return editTarget
    ? patchJson(`/goals/${editTarget.id}`, payload, requestOptions)
    : postJson("/goals", payload, requestOptions);
}


export function updateGoalStatus(goalId, status, requestOptions) {
  const path = `/goals/${goalId}/status`;
  return patchJson(path, { status }, { ...requestOptions, conflictKey: path });
}


export function deleteGoal(goalId, requestOptions) {
  return deleteJson(`/goals/${goalId}`, requestOptions);
}
