import { Capacitor } from "@capacitor/core";
import {
  conflictingOperations,
  markOperation,
  operationHasUnknownScope,
  operationIdentityFromToken,
  resolveOperation,
  retireOperation,
} from "./operations/operationStore";
import { isGuestModeEnabled } from "./guest/mode";

const loadGuestApi = () => import("./guest/guestApi");

const configuredApi = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");
const API = configuredApi || (
  Capacitor.isNativePlatform()
    ? ""
    : import.meta.env.DEV
      ? `${window.location.origin}/api`
      : window.location.origin
);

export const AUTH_TOKEN_KEY = "investAuthToken";
export const DATA_SCOPE_KEY = "investDataScope";
export const DATA_SCOPE_VERSION_KEY = "investDataScopeVersion";
export const DATA_SCOPE_STORAGE_VERSION = "2";
export const DEFAULT_DATA_SCOPE = "personal";
let sessionGeneration = 0;


export class StaleRequestError extends Error {
  constructor() {
    super("请求所属的登录状态或数据范围已变化");
    this.name = "StaleRequestError";
    this.stale = true;
  }
}


export function invalidateRequestGeneration() {
  sessionGeneration += 1;
  return sessionGeneration;
}


export function getRequestGeneration() {
  return sessionGeneration;
}


export function isStaleRequestError(error) {
  return error?.stale === true;
}

export function apiUrl(path) {
  if (!API) {
    throw new Error("移动端未配置 VITE_API_URL，请设置 HTTPS 后端地址后重新构建");
  }
  return `${API}${path}`;
}

export function requestHeaders(
  headers = {},
  token = localStorage.getItem(AUTH_TOKEN_KEY),
  scope = getStoredDataScope(),
) {
  return token
    ? { ...headers, Authorization: `Bearer ${token}`, "X-Data-Scope": scope }
    : headers;
}

export function normalizeDataScope(scope) {
  return scope === "family" ? "family" : DEFAULT_DATA_SCOPE;
}

export function getStoredDataScope() {
  return localStorage.getItem(DATA_SCOPE_VERSION_KEY) === DATA_SCOPE_STORAGE_VERSION
    ? normalizeDataScope(localStorage.getItem(DATA_SCOPE_KEY))
    : DEFAULT_DATA_SCOPE;
}

export function storeDataScope(scope) {
  const normalized = normalizeDataScope(scope);
  localStorage.setItem(DATA_SCOPE_KEY, normalized);
  localStorage.setItem(DATA_SCOPE_VERSION_KEY, DATA_SCOPE_STORAGE_VERSION);
  return normalized;
}

export function clearStoredDataScope() {
  localStorage.removeItem(DATA_SCOPE_KEY);
  localStorage.removeItem(DATA_SCOPE_VERSION_KEY);
}


function captureRequestIdentity(options = {}) {
  return {
    generation: options.generation ?? sessionGeneration,
    token: options.token ?? localStorage.getItem(AUTH_TOKEN_KEY),
    scope: normalizeDataScope(
      options.scope ?? getStoredDataScope(),
    ),
  };
}


function requestIdentityIsCurrent(identity) {
  return (
    identity.generation === sessionGeneration
    && identity.token === localStorage.getItem(AUTH_TOKEN_KEY)
    && identity.scope === getStoredDataScope()
  );
}


function assertRequestIdentity(identity) {
  if (!requestIdentityIsCurrent(identity)) throw new StaleRequestError();
}


export async function ensureResponse(res, path, requestIdentity = null) {
  if (res.status === 401) {
    const currentToken = localStorage.getItem(AUTH_TOKEN_KEY);
    const requestToken = typeof requestIdentity === "string"
      ? requestIdentity
      : requestIdentity?.token;
    const generationIsCurrent = typeof requestIdentity === "string"
      || requestIdentity?.generation === sessionGeneration;
    if (requestToken && currentToken === requestToken && generationIsCurrent) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      invalidateRequestGeneration();
      window.location.reload();
      throw new Error("登录状态已过期");
    }
    throw new Error("请求使用的登录状态已更新，请重试");
  }
  if (!res.ok) {
    const payload = await res.clone().json().catch(() => null);
    const error = new Error(typeof payload?.detail === "string" ? payload.detail : `${path} ${res.status}`);
    error.status = res.status;
    error.code = payload?.code;
    throw error;
  }
  return res;
}

export async function fetchJson(path, options = {}) {
  if (isGuestModeEnabled()) {
    return (await loadGuestApi()).guestFetchJson(path, options);
  }
  const identity = captureRequestIdentity(options);
  const url = apiUrl(path);
  const res = await fetch(url, {
    headers: requestHeaders({}, identity.token, identity.scope),
    signal: options.signal,
  });
  await ensureResponse(res, path, identity);
  const result = await res.json();
  assertRequestIdentity(identity);
  return result;
}

const pendingWrites = new Map();

function legacyReviewError(operation, receipt = null, originalError = null) {
  const status = receipt?.status || "unknown";
  const error = new Error(
    status === "processing"
      ? "升级前的操作仍在处理，请保留原操作标识，稍后重新核对"
      : "升级前的操作范围无法确定，请核对账本；系统不会自动重试或更换操作标识",
  );
  error.code = "OPERATION_SCOPE_REVIEW_REQUIRED";
  error.resultUnknown = true;
  error.operationId = operation.id;
  error.receiptStatus = status;
  error.originalMessage = originalError?.message;
  return error;
}


async function confirmLegacyOperation(operation, requestIdentity) {
  let receipt;
  try {
    receipt = await fetchJson(
      `/commands/${encodeURIComponent(operation.id)}`,
      requestIdentity,
    );
  } catch (error) {
    if (isStaleRequestError(error)) throw error;
    markOperation(operation, "unknown");
    throw legacyReviewError(operation, null, error);
  }
  if (receipt.status === "invalidated") {
    markOperation(operation, "invalidated");
    const error = new Error("账本已恢复，升级前的操作已失效；请核对后重新录入");
    error.code = "COMMAND_INVALIDATED";
    error.operationId = operation.id;
    throw error;
  }
  if (["committed", "expired"].includes(receipt.status)) {
    markOperation(operation, "committed");
    const error = new Error("升级前的操作已处理；请刷新账本核对，不能重新执行");
    error.code = "COMMAND_RESULT_EXPIRED";
    error.committed = true;
    error.operationId = operation.id;
    throw error;
  }
  markOperation(operation, "unknown");
  throw legacyReviewError(operation, receipt);
}


async function confirmConflictingOperations(conflicts, requestIdentity) {
  for (const previous of conflicts) {
    let status;
    if (!pendingWrites.has(previous.id)) {
      try {
        const receipt = await fetchJson(`/commands/${encodeURIComponent(previous.id)}`, requestIdentity);
        status = receipt.status;
      } catch (error) {
        if (isStaleRequestError(error)) throw error;
      }
    }
    if (!["committed", "expired", "invalidated"].includes(status)) {
      const error = new Error("上一项操作结果尚未确认，请先按原操作重试，再执行其他状态变更");
      error.code = "OPERATION_UNRESOLVED";
      throw error;
    }
    retireOperation(previous);
  }
}

function writeJson(method, path, payload, options = {}) {
  if (isGuestModeEnabled()) {
    return loadGuestApi().then(
      ({ guestWriteJson }) => guestWriteJson(method, path, payload, options),
    );
  }
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const requestIdentity = captureRequestIdentity(options);
  const operation = resolveOperation({
    identity: options.operationIdentity
      || operationIdentityFromToken(requestIdentity.token, requestIdentity.scope),
    method,
    path,
    payload,
    operation: options.operation,
    operationId: options.operationId,
    submission: options.submission,
    conflictKey: options.conflictKey,
  });
  if (operation.status === "succeeded") return Promise.resolve(operation.result);
  if (["committed", "invalidated"].includes(operation.status)) {
    const error = new Error(operation.status === "committed"
      ? "该操作已处理，请刷新账本核对"
      : "账本已恢复，此操作已失效，请核对后重新录入");
    error.code = operation.status === "committed"
      ? "COMMAND_RESULT_EXPIRED" : "COMMAND_INVALIDATED";
    error.committed = operation.status === "committed";
    return Promise.reject(error);
  }
  if (operationHasUnknownScope(operation)) {
    return confirmLegacyOperation(operation, requestIdentity);
  }
  if (pendingWrites.has(operation.id)) return pendingWrites.get(operation.id);
  const conflicts = conflictingOperations(operation, options.conflictKey, options.conflictPaths);
  markOperation(operation, "processing");
  const request = (async () => {
    let sent = false;
    try {
      if (conflicts.length) {
        await confirmConflictingOperations(conflicts, requestIdentity);
        assertRequestIdentity(requestIdentity);
      }
      sent = true;
      const res = await fetch(apiUrl(path), {
        method,
        headers: requestHeaders(
          { "Content-Type": "application/json", "Idempotency-Key": operation.id },
          requestIdentity.token,
          requestIdentity.scope,
        ),
        body,
        signal: options.signal,
      });
      await ensureResponse(res, path, requestIdentity);
      const result = await res.json();
      operation.result = result;
      // Commit acknowledgement is independent of the current screen identity.
      markOperation(operation, requestIdentityIsCurrent(requestIdentity) ? "succeeded" : "committed");
      assertRequestIdentity(requestIdentity);
      return result;
    } catch (error) {
      if (!sent) {
        // The proposed write never left this page. Keep only the original
        // unresolved command; retrying this proposed write needs no tombstone.
        markOperation(operation, "failed");
        throw error;
      }
      if (operation.status === "committed") throw error;
      if (error.code === "COMMAND_RESULT_EXPIRED") {
        markOperation(operation, "committed");
        error.committed = true;
        throw error;
      }
      if (["COMMAND_INVALIDATED", "COMMAND_CONTENT_CONFLICT"].includes(error.code)) {
        markOperation(operation, "invalidated");
        throw error;
      }
      const definiteFailure = error.status >= 400 && error.status < 500
        && ![408, 425, 429].includes(error.status)
        && error.code !== "COMMAND_PROCESSING";
      markOperation(operation, definiteFailure ? "failed" : "unknown");
      if (!definiteFailure) {
        error.originalMessage = error.message;
        error.message = "提交结果暂无法确认；请保留当前内容并重试，系统会沿用原操作标识";
        error.resultUnknown = true;
        error.operationId = operation.id;
      }
      throw error;
    } finally {
      pendingWrites.delete(operation.id);
    }
  })();
  pendingWrites.set(operation.id, request);
  return request;
}

export const postJson = (path, payload, options) => writeJson("POST", path, payload, options);
export const patchJson = (path, payload, options) => writeJson("PATCH", path, payload, options);
export const deleteJson = (path, options) => writeJson("DELETE", path, undefined, options);

export async function downloadFile(path, fallbackName, options = {}) {
  if (isGuestModeEnabled()) {
    return (await loadGuestApi()).downloadGuestFile(path, fallbackName, options);
  }
  const identity = captureRequestIdentity(options);
  const res = await fetch(apiUrl(path), {
    headers: requestHeaders({}, identity.token, identity.scope),
    signal: options.signal,
  });
  await ensureResponse(res, path, identity);
  const blob = await res.blob();
  assertRequestIdentity(identity);
  const disposition = res.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameMatch?.[1] || fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
