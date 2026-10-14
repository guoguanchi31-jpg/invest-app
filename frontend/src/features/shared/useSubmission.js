import { useCallback, useEffect, useRef, useState } from "react";
import { getRequestGeneration, isStaleRequestError } from "../../api";
import { acknowledgeOperation } from "../../operations/operationStore";
import { confirmsSubmission, nextResourceEvent } from "./resourceConfirmation";

const report = (message) => window.alert(message);

export function createSubmission() {
  return {
    status: "unsubmitted",
    operation: null,
    pending: false,
    writePending: false,
    refreshPending: false,
  };
}

export async function refreshAfterCommit(refresh, notify = report) {
  try {
    if (await refresh?.() === false) throw new Error("refresh failed");
    return true;
  } catch {
    notify("已保存，数据刷新失败；请点击页面的重新加载核对结果。");
    return false;
  }
}

// A submission owns one business intent. Transport retries reuse its operation;
// only begin() or a new dialog creates the next intent.
export async function executeSubmission(intent, {
  write,
  requestOptions,
  onCommitted,
  refresh,
  isCurrent = () => true,
  onError = (error) => report(error.message),
  notify = report,
}) {
  if (
    intent.writePending
    || intent.refreshPending
    || ["committed", "invalidated"].includes(intent.status)
  ) {
    return { committed: intent.status === "committed", duplicate: true };
  }
  intent.pending = true;
  intent.writePending = true;
  intent.refreshPending = false;
  intent.status = "processing";
  let result;
  let expired = false;
  try {
    try {
      result = await write({ ...requestOptions, submission: intent });
    } catch (error) {
      if (error.committed || error.code === "COMMAND_RESULT_EXPIRED") {
        expired = true;
      } else {
        intent.status = ["COMMAND_INVALIDATED", "COMMAND_CONTENT_CONFLICT"].includes(error.code)
          ? "invalidated" : error.resultUnknown ? "unknown" : "rejected";
        if (intent.status === "invalidated") intent.settledAt = nextResourceEvent();
        if (isCurrent() && !isStaleRequestError(error)) {
          onError(error);
          if (intent.status === "invalidated") acknowledgeOperation(intent);
        }
        return { committed: false, error };
      }
    }
    intent.writePending = false;
    intent.status = "committed";
    intent.settledAt = nextResourceEvent();
    if (!isCurrent()) return { committed: true, result };
    // Closing/resetting the form must precede any refresh. Even a callback
    // failure cannot turn an acknowledged write back into a retryable intent.
    try {
      onCommitted?.(result);
    } catch {
      notify("已保存，界面更新失败，请重新加载核对结果。");
    }
    acknowledgeOperation(intent);
    if (expired) notify("该操作已处理，结果明细已过期；已结束本次提交，请核对账本。");
    intent.refreshPending = true;
    const refreshed = await refreshAfterCommit(
      refresh,
      (message) => { if (isCurrent()) notify(message); },
    );
    return { committed: true, result, refreshed };
  } finally {
    intent.writePending = false;
    intent.refreshPending = false;
    intent.pending = false;
  }
}

export default function useSubmission(identityKey) {
  const intentRef = useRef(null);
  if (!intentRef.current) intentRef.current = createSubmission();
  const [status, setStatus] = useState("unsubmitted");
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;

  const begin = useCallback(() => {
    acknowledgeOperation(intentRef.current);
    intentRef.current = createSubmission();
    setStatus("unsubmitted");
  }, []);

  useEffect(() => { begin(); }, [begin, identityKey]);

  const submit = useCallback(async (options) => {
    const intent = intentRef.current;
    if (intent.pending) return { committed: false, duplicate: true };
    const identity = identityRef.current;
    const generation = getRequestGeneration();
    const isCurrent = () => intentRef.current === intent
      && identityRef.current === identity
      && getRequestGeneration() === generation;
    setStatus("processing");
    const outcome = await executeSubmission(intent, { ...options, isCurrent });
    if (isCurrent()) setStatus(intent.status);
    return outcome;
  }, []);

  return { begin, submit, status, isSubmitting: status === "processing" };
}

// Only a related read started after the terminal write can release a row intent.
// Failed reads and unresolved writes never create a new operation key.
function consumeConfirmations(commands, receipts, identityKey) {
  for (const [key, intent] of commands) {
    if (confirmsSubmission(intent, receipts, identityKey)) intent.readConfirmed = true;
    if (intent.readConfirmed && !intent.writePending) commands.delete(key);
  }
}

function supersedeStateIntents(commands, currentKey, currentIntent) {
  if (!currentIntent.stateKey) return;
  for (const [key, intent] of commands) {
    if (
      key !== currentKey
      && intent.stateKey === currentIntent.stateKey
      && !intent.writePending
      && intent.status !== "unknown"
      && intent.status !== "processing"
      && (intent.settledAt ?? 0) <= currentIntent.settledAt
    ) {
      acknowledgeOperation(intent);
      commands.delete(key);
    }
  }
}

export function useCommandActions(identityKey, confirmations = []) {
  const commands = useRef(new Map());
  const identity = useRef(identityKey);
  const receipts = useRef(confirmations);
  receipts.current = confirmations;
  if (identity.current !== identityKey) {
    identity.current = identityKey;
    commands.current = new Map();
  }
  useEffect(() => {
    consumeConfirmations(commands.current, confirmations, identityKey);
  }, [confirmations, identityKey]);
  return useCallback(async (key, options) => {
    const current = commands.current;
    consumeConfirmations(current, receipts.current, identity.current);
    if (!current.has(key)) {
      current.set(key, {
        ...createSubmission(),
        resourceKey: options.resourceKey,
        stateKey: options.stateKey,
      });
    }
    const intent = current.get(key);
    const generation = getRequestGeneration();
    const result = await executeSubmission(intent, {
      ...options,
      onCommitted: (value) => {
        // Commit order belongs to writes. Waiting for the aggregate page refresh
        // can leave a superseded state blocking the next legitimate transition.
        supersedeStateIntents(current, key, intent);
        options.onCommitted?.(value);
      },
      isCurrent: () => commands.current === current
        && generation === getRequestGeneration(),
    });
    if (commands.current === current) {
      consumeConfirmations(current, receipts.current, identity.current);
    }
    return result;
  }, []);
}
