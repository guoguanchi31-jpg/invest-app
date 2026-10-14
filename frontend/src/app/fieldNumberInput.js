const DEFAULT_MAX_LENGTH = 16;

export function appendFieldNumber(value, key, {
  decimalScale = 2,
  maxLength = DEFAULT_MAX_LENGTH,
} = {}) {
  const current = String(value ?? "");
  if (key === ".") {
    if (decimalScale <= 0 || current.includes(".")) return current;
    return `${current || "0"}.`;
  }
  if (!/^\d$/.test(key)) return current;

  const unsigned = current.replace(/^-/, "");
  const decimals = unsigned.split(".")[1];
  if (decimals !== undefined && decimals.length >= decimalScale) return current;
  const digitCount = unsigned.replace(".", "").length;
  if (digitCount >= maxLength) return current;

  if (current === "0") return key;
  if (current === "-0") return `-${key}`;
  return `${current}${key}`;
}

export function backspaceFieldNumber(value) {
  return String(value ?? "").slice(0, -1);
}

export function toggleFieldNumberSign(value) {
  const current = String(value ?? "");
  if (!current) return "-";
  if (current === "-") return "";
  if (current.startsWith("-")) return current.slice(1);
  if (Number(current) === 0) return current;
  return `-${current}`;
}
