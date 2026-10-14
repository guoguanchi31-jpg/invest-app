const DEFAULT_MIN_FONT_SIZE = 15;
const FIT_EPSILON = 0.5;

function readPixels(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function fitMetricValue(element) {
  if (!element) return;

  element.style.removeProperty("font-size");
  element.removeAttribute("data-fitted");

  const availableWidth = element.clientWidth;
  if (!availableWidth) return;

  const styles = window.getComputedStyle(element);
  const preferredFontSize = readPixels(styles.fontSize, DEFAULT_MIN_FONT_SIZE);
  const minimumFontSize = readPixels(
    styles.getPropertyValue("--metric-value-min-font-size"),
    DEFAULT_MIN_FONT_SIZE,
  );
  const requiredWidth = element.scrollWidth;

  if (requiredWidth <= availableWidth + FIT_EPSILON) return;

  const fittedFontSize = Math.max(
    minimumFontSize,
    preferredFontSize * ((availableWidth - 1) / requiredWidth),
  );
  element.style.fontSize = `${fittedFontSize.toFixed(2)}px`;
  element.dataset.fitted = "true";
}
