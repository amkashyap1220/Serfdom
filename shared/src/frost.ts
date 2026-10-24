import { PLAYER_HEALTH } from "./combat-config.ts";
import type { Vec2 } from "./geometry.ts";

/*
 * Frost Hollow's cold (D-136), shared by the simulation, prediction, and
 * drawing. Frost patches slow players; like the Sunken Temple's water they
 * are keyed to the run's clock and sent in snapshots, so prediction slows
 * the player on the same ticks as the server.
 */

/** A patch of frozen floor: slows players inside from `from` until `until` (run clock). */
export interface FrostPatch {
  at: Vec2;
  radius: number;
  from: number;
  until: number;
}

export const FROST = {
  /** Players on frost move at this share of their speed. */
  speedFactor: 0.6,
} as const;

/** Does any patch slow a player standing at `at` at `clock`? */
export function onFrost(
  at: Vec2,
  clock: number,
  patches: readonly FrostPatch[],
): boolean {
  return patches.some(
    (p) =>
      clock >= p.from - 1e-9 &&
      clock < p.until - 1e-9 &&
      Math.hypot(at.x - p.at.x, at.y - p.at.y) <= p.radius,
  );
}

/** Falling icicles (D-136): a rockfall room's boulders, each leaving frost where it lands. */
export const ICICLES = {
  everySeconds: 1.4,
  frostRadius: 44,
  frostSeconds: 3,
} as const;

/**
 * A breath cone (D-136): from `at`, `range` long, `halfAngle` either side
 * of `angle` (radians). Any overlap with the hurtbox counts.
 */
export interface ConeShape {
  at: Vec2;
  angle: number;
  range: number;
  halfAngle: number;
}

/** Does a cone touch a player at `p`? */
export function coneHits(c: ConeShape, p: Vec2): boolean {
  const dx = p.x - c.at.x;
  const dy = p.y - c.at.y;
  const d = Math.hypot(dx, dy);
  const reach = PLAYER_HEALTH.hurtboxSize / 2;
  if (d > c.range + reach) return false;
  if (d <= reach) return true;
  const off = Math.abs(
    Math.atan2(
      Math.sin(Math.atan2(dy, dx) - c.angle),
      Math.cos(Math.atan2(dy, dx) - c.angle),
    ),
  );
  // The hurtbox's own width widens the angle a little at short range.
  return off <= c.halfAngle + Math.asin(Math.min(1, reach / d));
}
