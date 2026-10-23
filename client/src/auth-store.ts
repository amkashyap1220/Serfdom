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
