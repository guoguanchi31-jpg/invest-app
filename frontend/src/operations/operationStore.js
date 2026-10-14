export const LEGACY_OPERATION_STORAGE_KEY = "investPendingOperations:v1";
export const OPERATION_STORAGE_KEY = "investPendingOperations:v2";
export const OPERATION_STORAGE_VERSION = 2;

const activeOperations = new Map();


function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}


function shortFingerprint(value) {
  const text = JSON.stringify(stableValue(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}


function createOperationId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("当前浏览器不支持安全随机数，无法提交写操作");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}


function readStoredOperationsForVersion(key, storageVersion) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => item?.id && item?.identity && item?.intent)
        .map((item) => ({
          ...item,
          storageVersion,
          identityVersion: item.identityVersion || (
            ["family", "personal"].includes(item.identity.split(":").at(-1))
              ? 2
              : storageVersion
          ),
        }))
      : [];
  } catch {
    return [];
  }
}


function readStoredOperations() {
  const operations = new Map(
    readStoredOperationsForVersion(
      LEGACY_OPERATION_STORAGE_KEY,
      1,
    ).map((item) => [item.id, item]),
  );
  for (const item of readStoredOperationsForVersion(
    OPERATION_STORAGE_KEY,
    OPERATION_STORAGE_VERSION,
  )) {
    operations.set(item.id, item);
  }
  return [...operations.values()];
}


function writeStoredOperations(storageVersion, operations) {
  const key = storageVersion === 1
    ? LEGACY_OPERATION_STORAGE_KEY
    : OPERATION_STORAGE_KEY;
  try {
    if (operations.length) {
      localStorage.setItem(key, JSON.stringify(operations));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage is optional. The in-memory operation still protects this page.
  }
}


function updateStoredOperation(operation) {
  if (!operation.identity) return;
  const storageVersion = operation.storageVersion || OPERATION_STORAGE_VERSION;
  const operations = readStoredOperations().filter(
    (item) => item.storageVersion === storageVersion,
  );
  const index = operations.findIndex((item) => item.id === operation.id);
  const stored = {
    id: operation.id,
    identity: operation.identity,
    intent: operation.intent,
    method: operation.method,
    path: operation.path,
    conflictKey: operation.conflictKey,
    status: operation.status === "processing" ? "unknown" : operation.status,
    storageVersion,
    identityVersion: operation.identityVersion || storageVersion,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) operations[index] = stored;
  else operations.push(stored);
  writeStoredOperations(storageVersion, operations);
}


function removeStoredOperation(operation) {
  const storageVersion = operation.storageVersion || OPERATION_STORAGE_VERSION;
  writeStoredOperations(
    storageVersion,
    readStoredOperations().filter(
      (item) => item.storageVersion === storageVersion && item.id !== operation.id,
    ),
  );
}


function identityPrincipal(identity) {
  if (!identity) return null;
  const parts = identity.split(":");
  if (["family", "personal"].includes(parts.at(-1))) parts.pop();
  return parts.join(":");
}


export function operationHasUnknownScope(operation) {
  return (operation.identityVersion || operation.storageVersion || 1) < 2;
}


function operationIdentityMatches(operation, identity) {
  if (operation.identity === identity) return true;
  return operationHasUnknownScope(operation)
    && identityPrincipal(operation.identity) === identityPrincipal(identity);
}


export function operationIdentityFromToken(token, scope = "personal") {
  if (!token) return null;
  const scopeIdentity = scope === "family" ? "family" : "personal";
  if (!token.includes(".")) {
    return `opaque:${shortFingerprint(token)}:${scopeIdentity}`;
  }
  try {
    const encoded = token.split(".", 1)[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    if (payload.sub == null || payload.family_id == null) {
      return `opaque:${shortFingerprint(token)}:${scopeIdentity}`;
    }
    return `${payload.sub}:${payload.family_id}:${scopeIdentity}`;
  } catch {
    return `opaque:${shortFingerprint(token)}:${scopeIdentity}`;
  }
}


export function operationIntent(method, path, payload) {
  return shortFingerprint({ method, path, payload });
}


export function createOperation({ identity, method, path, payload, id, conflictKey } = {}) {
  const operation = {
    id: id || createOperationId(),
    identity: identity || null,
    intent: operationIntent(method, path, payload),
    method,
    path,
    conflictKey,
    status: "unsubmitted",
    storageVersion: OPERATION_STORAGE_VERSION,
    identityVersion: OPERATION_STORAGE_VERSION,
  };
  activeOperations.set(operation.id, operation);
  return operation;
}


export function resolveOperation({
  identity,
  method,
  path,
  payload,
  operation,
  operationId,
  submission,
  conflictKey,
}) {
  const intent = operationIntent(method, path, payload);
  if (submission?.operation?.retired) submission.operation = null;
  if (submission?.operation) {
    const previous = submission.operation;
    if (
      previous.intent !== intent
      || !operationIdentityMatches(previous, identity)
    ) {
      if (previous.status !== "failed") {
        const error = new Error("上一笔提交结果尚未核对，请保留原内容重试或重新打开表单");
        error.code = "OPERATION_UNRESOLVED";
        throw error;
      }
      submission.operation = null;
    } else {
      return previous;
    }
  }
  if (submission) {
    const resolved = resolveOperation({
      identity, method, path, payload, operation, operationId, conflictKey,
    });
    submission.operation = resolved;
    return resolved;
  }
  if (operation) {
    if (
      !operationIdentityMatches(operation, identity)
      || operation.intent !== intent
      || operation.method !== method
      || operation.path !== path
    ) {
      throw new Error("业务操作标识与当前提交内容不匹配");
    }
    activeOperations.set(operation.id, operation);
    return operation;
  }
  if (operationId) {
    const existing = activeOperations.get(operationId);
    if (existing) return resolveOperation({
      identity,
      method,
      path,
      payload,
      operation: existing,
      conflictKey,
    });
    return createOperation({ identity, method, path, payload, id: operationId, conflictKey });
  }
  const active = [...activeOperations.values()].find(
    (item) => item.identity === identity && item.intent === intent,
  );
  if (active) return active;
  const storedOperations = readStoredOperations();
  const stored = storedOperations.find(
    (item) => item.identity === identity && item.intent === intent,
  ) || storedOperations.find(
    (item) => operationHasUnknownScope(item)
      && operationIdentityMatches(item, identity)
      && item.intent === intent,
  );
  if (stored) {
    const recovered = { ...stored };
    activeOperations.set(recovered.id, recovered);
    return recovered;
  }
  return createOperation({ identity, method, path, payload, conflictKey });
}

export function conflictingOperations(operation, conflictKey, paths = [operation.path]) {
  if (!conflictKey) return [];
  const candidates = new Map(readStoredOperations().map((item) => [item.id, item]));
  for (const item of activeOperations.values()) candidates.set(item.id, item);
  return [...candidates.values()].filter((item) =>
    item.id !== operation.id && operationIdentityMatches(item, operation.identity)
    && (item.conflictKey === conflictKey || (!item.conflictKey && paths.includes(item.path)))
    && !["failed", "succeeded"].includes(item.status));
}

export function retireOperation(operation) {
  // Also retire objects held by an older row intent in this mounted page.
  const active = activeOperations.get(operation.id);
  if (active) active.retired = true;
  operation.retired = true;
  activeOperations.delete(operation.id);
  removeStoredOperation(operation);
}


export function markOperation(operation, status) {
  operation.status = status;
  if (status === "succeeded" || status === "failed") {
    activeOperations.delete(operation.id);
    removeStoredOperation(operation);
    return;
  }
  activeOperations.set(operation.id, operation);
  updateStoredOperation(operation);
}


// Only an explicit new form intent may acknowledge a previously displayed
// terminal result. Unknown writes survive closing a form and page reloads.
export function acknowledgeOperation(submission) {
  const operation = submission?.operation;
  if (operation && ["committed", "invalidated"].includes(operation.status)) {
    activeOperations.delete(operation.id);
    removeStoredOperation(operation);
  }
}


export function clearOperationsForIdentity(identity) {
  for (const [id, operation] of activeOperations) {
    if (operation.identity === identity) activeOperations.delete(id);
  }
  for (const storageVersion of [1, OPERATION_STORAGE_VERSION]) {
    writeStoredOperations(
      storageVersion,
      readStoredOperations().filter(
        (item) => item.storageVersion === storageVersion
          && item.identity !== identity,
      ),
    );
  }
}


export function resetOperationStoreForTests() {
  activeOperations.clear();
  try {
    localStorage.removeItem(OPERATION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_OPERATION_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage in tests without a DOM.
  }
}
