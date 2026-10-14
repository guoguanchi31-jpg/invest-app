export function goalDraft({ currentMember }) {
  return {
    name: "", amount: "", goal_id: "", goal_record_type: "deposit",
    member_id: currentMember?.id ? String(currentMember.id) : "",
  };
}
