import type { Vec2 } from "@serfdom/shared";

/**
 * How far behind real time other players are drawn. Snapshots arrive every
 * 50 ms (20 Hz); drawing 100 ms in the past means there are almost always
 * two snapshots to blend between, even with some network jitter.
 */
export const INTERPOLATION_DELAY_MS = 100;

interface Frame {
  timeMs: number;
  positions: ReadonlyMap<number, Vec2>;
}

/**
 * Smooths other players' movement between snapshots (T-023).
 *
 * Remote players only update 20 times a second; drawing each snapshot as it
 * arrives would look jerky. Instead we keep recent snapshots and draw each
 * player at a moment slightly in the past, blending ("lerping") between the
 * two snapshots on either side of it. We never guess beyond the newest
 * snapshot (no extrapolation), so a stalled player stops rather than drifts.
 */
export class RemoteInterpolator {
  private frames: Frame[] = [];

  /** Records a snapshot's positions (excluding the local player) at its arrival time. */
  push(timeMs: number, positions: ReadonlyMap<number, Vec2>): void {
    this.frames.push({ timeMs, positions: new Map(positions) });
    // Keep about one second of history.
    while (this.frames.length > 2 && this.frames[0]!.timeMs < timeMs - 1000) {
      this.frames.shift();
    }
  }

  clear(): void {
    this.frames = [];
  }

  /** Positions to draw at `nowMs`, for every player in the newest relevant snapshot. */
  sample(nowMs: number): Map<number, Vec2> {
    const renderTime = nowMs - INTERPOLATION_DELAY_MS;
    const out = new Map<number, Vec2>();
    if (this.frames.length === 0) return out;

    // Find the last frame at or before renderTime (a) and the one after (b).
    let a: Frame | undefined;
    let b: Frame | undefined;
    for (const f of this.frames) {
      if (f.timeMs <= renderTime) a = f;
      else {
        b = f;
        break;
      }
    }
    if (!a) a = this.frames[0]!; // everything is newer: hold the oldest
    if (!b) b = a; // nothing newer: hold the newest (no extrapolation)

    const span = b.timeMs - a.timeMs;
    const t =
      span > 0 ? Math.min(Math.max((renderTime - a.timeMs) / span, 0), 1) : 1;
    for (const [id, to] of b.positions) {
      const from = a.positions.get(id);
      out.set(
        id,
        from
          ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
          : { ...to },
      );
    }
    return out;
  }
}
