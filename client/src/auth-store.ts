/**
 * Keeps the login token in this browser (localStorage), so a reload or a
 * reconnect logs back in without retyping the password. The token is a
 * secret: it is never shown or logged. Storage can be unavailable (private
 * windows, blocked site data); then the player simply logs in each time.
 */
const KEY = "serfdom.loginToken";

export function loadToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Storage blocked: the login lasts until the page is closed.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

const DEBUG_HUD = "serfdom.debugHud";

/** Whether the HUD's debug readout is shown on this browser (D-146). */
export function loadDebugHud(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_HUD) === "1";
  } catch {
    return false;
  }
}

export function saveDebugHud(on: boolean): void {
  try {
    window.localStorage.setItem(DEBUG_HUD, on ? "1" : "0");
  } catch {
    // Storage blocked: the switch lasts until the page is closed.
  }
}

const LAST_SERF = "serfdom.lastSerf";

/** The serf last played on this browser (a convenience, not a secret). */
export function loadLastSerf(): number | null {
  try {
    const v = Number(window.localStorage.getItem(LAST_SERF));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveLastSerf(serfId: number): void {
  try {
    window.localStorage.setItem(LAST_SERF, String(serfId));
  } catch {
    // Storage blocked: the player picks their serf each time.
  }
}
