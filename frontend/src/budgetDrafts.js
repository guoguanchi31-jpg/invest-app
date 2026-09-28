// A refresh only replaces server data. Drafts contain edited fields exclusively.
export function clearSavedBudgetDrafts(current, submitted) {
  const next = { ...current };
  for (const [id, value] of Object.entries(submitted)) {
    if (current[id] === value) delete next[id];
  }
  return next;
}
