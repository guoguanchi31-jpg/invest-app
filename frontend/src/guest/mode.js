export const GUEST_MODE_KEY = "investGuestMode";
export const GUEST_DISPLAY_NAME = "小白";

let sessionCounter = 0;

export function isGuestModeEnabled() {
  return Boolean(localStorage.getItem(GUEST_MODE_KEY));
}

export function getGuestSessionId() {
  return localStorage.getItem(GUEST_MODE_KEY) || "";
}

export function enableGuestMode() {
  sessionCounter += 1;
  localStorage.setItem(
    GUEST_MODE_KEY,
    `${Date.now()}-${sessionCounter}`,
  );
}

export function disableGuestMode() {
  localStorage.removeItem(GUEST_MODE_KEY);
}
