/**
 * Account input rules (Phase 7a, D-058). Shared so the login screen can
 * explain problems before sending; the server checks again, because the
 * client is untrusted. PROVISIONAL Claude defaults following current NIST
 * guidance (SP 800-63B): length limits only, no forced symbols.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** RFC 5321's practical limit for an address. */
export const EMAIL_MAX = 254;

/** Emails compare case-insensitively and without surrounding spaces. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns a problem to show the player, or null if the (normalized) email is acceptable. */
export function emailProblem(email: string): string | null {
  if (email.length === 0) return "Enter your email.";
  if (email.length > EMAIL_MAX) return "That email is too long.";
  // Deliberately loose: one @, something on each side, a dot in the domain,
  // no spaces. Real verification needs an email (later, D-060).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "That doesn't look like an email address.";
  }
  return null;
}

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Use at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}
