import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, isStaleRequestError } from "../../api";
import { updateGoalStatus } from "./actions";
import { useCommandActions } from "../shared/useSubmission";


export default function useGoalWorkspace({
  dataIdentityKey,
  dataScope,
  loadData,
  requestOptions,
  resourceConfirmations,
  selectedMonth,
}) {
  const [goalRecords, setGoalRecords] = useState(null);
  const runCommand = useCommandActions(dataIdentityKey, resourceConfirmations);
  const requestRef = useRef(0);
  const identityRef = useRef(dataIdentityKey);
  identityRef.current = dataIdentityKey;

  const closeGoalRecords = useCallback(() => {
    requestRef.current += 1;
    setGoalRecords(null);
  }, []);

  useEffect(() => {
    closeGoalRecords();
  }, [closeGoalRecords, dataIdentityKey]);

  const openGoalRecords = useCallback(async (goal) => {
    const requestVersion = ++requestRef.current;
    const requestedIdentityKey = dataIdentityKey;
    try {
      const records = await fetchJson(
        `/goals/${goal.id}/records`,
        { scope: dataScope },
      );
      if (
        requestVersion !== requestRef.current
        || requestedIdentityKey !== identityRef.current
      ) return;
      setGoalRecords({ goal, records });
    } catch (error) {
      if (
        requestVersion === requestRef.current
        && !isStaleRequestError(error)
      ) {
        window.alert(`加载目标记录失败：${error.message}`);
      }
    }
  }, [dataIdentityKey, dataScope]);

  const handleGoalStatus = useCallback(async (goal, status, onCommitted) => {
    if (
      status === "archived"
      && !window.confirm(`归档“${goal.name}”后将不能继续存取，确认归档吗？`)
    ) return;
    await runCommand(`goal:${goal.id}:${status}`, {
      resourceKey: `goals:${selectedMonth}`,
      stateKey: `goal:${goal.id}:status`,
      write: (options) => updateGoalStatus(goal.id, status, options),
      onCommitted,
      requestOptions,
      refresh: loadData,
    });
  }, [loadData, requestOptions, runCommand, selectedMonth]);

  return {
    closeGoalRecords,
    goalRecords,
    handleGoalStatus,
    openGoalRecords,
  };
}
