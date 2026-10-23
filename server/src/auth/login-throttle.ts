/**
 * Slows password guessing (Phase 7a, PROVISIONAL): after `maxFailures`
 * failed logins for one email within `windowMs`, that email is refused
 * until the oldest failure is `windowMs` old. Kept in memory: it resets on
 * a server restart, which is acceptable for one server process.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures = 5, windowMs = 10 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  /** Milliseconds until `email` may try again (0 = now). */
  blockedFor(email: string, nowMs: number): number {
    const recent = this.recent(email, nowMs);
    if (recent.length < this.maxFailures) return 0;
    const oldest = recent[recent.length - this.maxFailures] ?? nowMs;
    return Math.max(0, oldest + this.windowMs - nowMs);
  }

  fail(email: string, nowMs: number): void {
    this.failures.set(email, [...this.recent(email, nowMs), nowMs]);
  }

  reset(email: string): void {
    this.failures.delete(email);
  }

  private recent(email: string, nowMs: number): number[] {
    return (this.failures.get(email) ?? []).filter(
      (t) => nowMs - t < this.windowMs,
    );
  }
}
