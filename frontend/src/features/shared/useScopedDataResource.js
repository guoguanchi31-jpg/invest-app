import { useCallback, useEffect, useRef, useState } from "react";
import { isStaleRequestError } from "../../api";
import { nextResourceEvent } from "./resourceConfirmation";


export default function useScopedDataResource({
  enabled,
  identityKey,
  initialValue,
  load,
  loggedIn,
  onData,
  resourceKey,
}) {
  const [data, setData] = useState(initialValue);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedIdentityKey, setLoadedIdentityKey] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const versionRef = useRef(0);
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const resourceRef = useRef(resourceKey);
  resourceRef.current = resourceKey;

  const reset = useCallback(() => {
    versionRef.current += 1;
    setData(initialValue);
    setError("");
    setLoading(false);
    setLoadedIdentityKey(null);
    setConfirmation(null);
  }, [initialValue]);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!loggedIn || (!enabled && !force)) return true;
    const version = ++versionRef.current;
    const requestedIdentity = identityKey;
    const startedAfter = nextResourceEvent();
    setLoading(true);
    setError("");
    try {
      const value = await load();
      if (
        version !== versionRef.current
        || requestedIdentity !== identityRef.current
        || resourceKey !== resourceRef.current
      ) return false;
      setData(value);
      setLoadedIdentityKey(requestedIdentity);
      onData?.(value);
      setConfirmation({ identityKey: requestedIdentity, resourceKey, startedAfter });
      return true;
    } catch (requestError) {
      if (
        version === versionRef.current
        && requestedIdentity === identityRef.current
        && !isStaleRequestError(requestError)
      ) {
        setError(requestError?.message || "加载失败");
        setLoadedIdentityKey(requestedIdentity);
      }
      return false;
    } finally {
      if (
        version === versionRef.current
        && requestedIdentity === identityRef.current
      ) {
        setLoading(false);
      }
    }
  }, [enabled, identityKey, load, loggedIn, onData, resourceKey]);

  useEffect(() => {
    reset();
    if (loggedIn && enabled) void refresh();
    return () => { versionRef.current += 1; };
  }, [enabled, identityKey, loggedIn, refresh, reset]);

  const current = loggedIn && loadedIdentityKey === identityKey;
  return {
    data: current ? data : initialValue,
    confirmation: current && confirmation?.resourceKey === resourceKey ? confirmation : null,
    error: current ? error : "",
    loading: loggedIn && enabled && (!current || loading),
    refresh,
    reset,
    setData,
  };
}
