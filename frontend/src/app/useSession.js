import { useCallback, useEffect, useRef, useState } from "react";
import { configureBusinessTimezone } from "../shared/businessDate";
import {
  apiUrl,
  AUTH_TOKEN_KEY,
  clearStoredDataScope,
  DEFAULT_DATA_SCOPE,
  fetchJson,
  getStoredDataScope,
  getRequestGeneration,
  invalidateRequestGeneration,
  isStaleRequestError,
  normalizeDataScope,
  storeDataScope,
} from "../api";
import {
  disableGuestMode,
  enableGuestMode,
  isGuestModeEnabled,
} from "../guest/mode";


const EMPTY_FAMILY = {
  id: null,
  name: "我的家庭",
  role: "member",
  current_member_id: null,
  can_manage: false,
  members: [],
};


export default function useSession() {
  const [guestMode, setGuestMode] = useState(isGuestModeEnabled);
  const [loggedIn, setLoggedIn] = useState(
    () => isGuestModeEnabled() || Boolean(localStorage.getItem(AUTH_TOKEN_KEY)),
  );
  const [username, setUsername] = useState(
    () => import.meta.env.VITE_USER_USERNAME || "admin",
  );
  const [password, setPassword] = useState("");
  const [dataScope, setDataScope] = useState(
    getStoredDataScope,
  );
  const [authSession, setAuthSession] = useState(null);
  const [familyData, setFamilyData] = useState(EMPTY_FAMILY);
  const [identityError, setIdentityError] = useState("");
  const [sessionGeneration, setSessionGeneration] = useState(getRequestGeneration);
  const authOperationRef = useRef(0);
  const identityRequestRef = useRef(0);

  const loadIdentity = useCallback(async () => {
    const requestVersion = ++identityRequestRef.current;
    const [session, family] = await Promise.all([
      fetchJson("/auth/session", { scope: dataScope }),
      fetchJson("/family", { scope: dataScope }),
    ]);
    if (requestVersion !== identityRequestRef.current) return false;
    configureBusinessTimezone(session.business_timezone);
    setAuthSession(session);
    setFamilyData((current) => ({
      ...current,
      ...family,
      members: family?.members || [],
    }));
    setIdentityError("");
    return true;
  }, [dataScope]);

  useEffect(() => {
    if (loggedIn) {
      void loadIdentity().catch((error) => {
        if (!isStaleRequestError(error)) {
          setIdentityError(`身份信息：${error.message}`);
        }
      });
    }
    return () => { identityRequestRef.current += 1; };
  }, [loadIdentity, loggedIn]);

  const login = useCallback(async () => {
    const operation = ++authOperationRef.current;
    const res = await fetch(apiUrl("/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || `登录失败 ${res.status}`);
    }
    const data = await res.json();
    if (operation !== authOperationRef.current) return false;
    if (!data.ok || !data.access_token) return false;
    disableGuestMode();
    localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
    storeDataScope(DEFAULT_DATA_SCOPE);
    const generation = invalidateRequestGeneration();
    identityRequestRef.current += 1;
    setSessionGeneration(generation);
    setDataScope(DEFAULT_DATA_SCOPE);
    setAuthSession(null);
    setFamilyData(EMPTY_FAMILY);
    setIdentityError("");
    setGuestMode(false);
    setLoggedIn(true);
    return true;
  }, [password, username]);

  const enterGuestMode = useCallback(() => {
    authOperationRef.current += 1;
    identityRequestRef.current += 1;
    enableGuestMode();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    clearStoredDataScope();
    storeDataScope("family");
    const generation = invalidateRequestGeneration();
    configureBusinessTimezone("Asia/Shanghai");
    setSessionGeneration(generation);
    setDataScope("family");
    setAuthSession(null);
    setFamilyData(EMPTY_FAMILY);
    setIdentityError("");
    setGuestMode(true);
    setLoggedIn(true);
    setUsername("");
    setPassword("");
  }, []);

  const logout = useCallback(() => {
    authOperationRef.current += 1;
    identityRequestRef.current += 1;
    const generation = invalidateRequestGeneration();
    disableGuestMode();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    clearStoredDataScope();
    configureBusinessTimezone();
    setSessionGeneration(generation);
    setGuestMode(false);
    setLoggedIn(false);
    setAuthSession(null);
    setFamilyData(EMPTY_FAMILY);
    setIdentityError("");
    setDataScope(DEFAULT_DATA_SCOPE);
    setUsername("");
    setPassword("");
  }, []);

  const changeScope = useCallback((scope) => {
    const normalized = normalizeDataScope(scope);
    if (normalized === dataScope) return false;
    identityRequestRef.current += 1;
    storeDataScope(normalized);
    const generation = invalidateRequestGeneration();
    setSessionGeneration(generation);
    setDataScope(normalized);
    setIdentityError("");
    return true;
  }, [dataScope]);

  const dataIdentityKey = [
    sessionGeneration,
    loggedIn
      ? guestMode ? "guest-demo" : localStorage.getItem(AUTH_TOKEN_KEY) || "missing-token"
      : "logged-out",
    dataScope,
  ].join(":");

  return {
    authSession,
    changeScope,
    dataIdentityKey,
    dataScope,
    enterGuestMode,
    familyData,
    guestMode,
    identityError,
    loadIdentity,
    loggedIn,
    login,
    logout,
    password,
    setPassword,
    setUsername,
    username,
  };
}
