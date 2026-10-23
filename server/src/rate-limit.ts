/**
 * Counts messages in fixed one-second windows. A normal client sends about
 * 60 inputs per second (one per tick) plus bursts after a hitch; anything
 * far above that is a broken or hostile client.
 */
export class MessageRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private windowStart = -Infinity;
  private count = 0;

  constructor(limit: number, windowMs = 1000) {
    if (!(limit > 0) || !(windowMs > 0)) {
      throw new RangeError("limit and windowMs must be > 0");
    }
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records one message at `nowMs`; returns false once the window's limit is exceeded. */
  hit(nowMs: number): boolean {
    if (nowMs - this.windowStart >= this.windowMs) {
      this.windowStart = nowMs;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.limit;
  }
}
