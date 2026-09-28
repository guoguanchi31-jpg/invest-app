import { Capacitor } from "@capacitor/core";

const configuredApi = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");
const API = configuredApi || (
  Capacitor.isNativePlatform()
    ? ""
    : import.meta.env.DEV
      ? "http://127.0.0.1:8000"
      : window.location.origin
);

export const AUTH_TOKEN_KEY = "investAuthToken";

export function apiUrl(path) {
  if (!API) {
    throw new Error("移动端未配置 VITE_API_URL，请设置 HTTPS 后端地址后重新构建");
  }
  return `${API}${path}`;
}

export function requestHeaders(headers = {}) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token
    ? { ...headers, Authorization: `Bearer ${token}` }
    : headers;
}

export async function ensureResponse(res, path) {
  if (res.status === 401) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    window.location.reload();
    throw new Error("登录状态已过期");
  }
  if (!res.ok) {
    const payload = await res.clone().json().catch(() => null);
    const error = new Error(typeof payload?.detail === "string" ? payload.detail : `${path} ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res;
}

export async function fetchJson(path) {
  const res = await fetch(apiUrl(path), { headers: requestHeaders() });
  await ensureResponse(res, path);
  return res.json();
}

const pendingWrites = new Map();
const retryKeys = new Map();

function writeJson(method, path, payload) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const identity = JSON.stringify([localStorage.getItem(AUTH_TOKEN_KEY), method, path, body]);
  if (pendingWrites.has(identity)) return pendingWrites.get(identity);
  const key = retryKeys.get(identity) || crypto.randomUUID();
  retryKeys.set(identity, key);
  const request = (async () => {
    try {
      const res = await fetch(apiUrl(path), {
        method, headers: requestHeaders({ "Content-Type": "application/json", "Idempotency-Key": key }), body,
      });
      await ensureResponse(res, path);
      const result = await res.json();
      retryKeys.delete(identity);
      return result;
    } catch (error) {
      // Ambiguous network/server failures keep the key for a safe retry.
      if (error.status >= 400 && error.status < 500) retryKeys.delete(identity);
      throw error;
    } finally {
      pendingWrites.delete(identity);
    }
  })();
  pendingWrites.set(identity, request);
  return request;
}

export const postJson = (path, payload) => writeJson("POST", path, payload);
export const patchJson = (path, payload) => writeJson("PATCH", path, payload);
export const deleteJson = (path) => writeJson("DELETE", path);

export async function downloadFile(path, fallbackName) {
  const res = await fetch(apiUrl(path), { headers: requestHeaders() });
  await ensureResponse(res, path);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameMatch?.[1] || fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
