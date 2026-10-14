const INVALID_DISPLAY_TEXT = new Set(["null", "undefined", "nan"]);

export function normalizeDisplayText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text || INVALID_DISPLAY_TEXT.has(text.toLowerCase())) return "";
  return text;
}

export function joinDisplayText(values, separator = " · ") {
  return values
    .map(normalizeDisplayText)
    .filter(Boolean)
    .join(separator);
}

export function displayText(value, fallback = "—") {
  return normalizeDisplayText(value) || fallback;
}
