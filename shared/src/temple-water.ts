import { PLAYER_HEALTH } from "./combat-config.ts";
import type { Rect, Vec2 } from "./geometry.ts";

/*
 * The Sunken Temple's water (D-135), shared by the simulation and the
 * client's prediction and drawing. Everything that moves a player is
 * announced ahead and keyed to the run's clock, so the client applies it on
 * the same ticks as the server and nothing snaps (D-043).
 */

/**
 * Tides: every tide pool is shallow (harmless), then glows for
 * `warnSeconds`, then is deep for `deepSeconds`, on one `periodSeconds`
 * cycle for the whole run. Deep water slows players to `speedFactor`;
 * the temple's enemies wade through it.
 */
export const TIDES = {
  periodSeconds: 9,
  warnSeconds: 1,
  deepSeconds: 4,
  speedFactor: 0.5,
} as const;

export type TideState = "shallow" | "rising" | "deep";

/** The tide at `clock` seconds into the run. */
export function tideAt(clock: number): TideState {
  const t =
    ((clock % TIDES.periodSeconds) + TIDES.periodSeconds) % TIDES.periodSeconds;
  const deepFrom = TIDES.periodSeconds - TIDES.deepSeconds;
  if (t >= deepFrom) return "deep";
  if (t >= deepFrom - TIDES.warnSeconds) return "rising";
  return "shallow";
}

/**
 * A pull on a player (an eel-priest's tether): from `from` (run clock) it
 * drags them towards `to` at `speed` for `seconds` of their movement.
 */
export interface Pull {
  to: Vec2;
  from: number;
  speed: number;
  /** Seconds of pulling left. */
  left: number;
}

/**
 * A whirlpool (the Tide Priest's): from `from` until `until` (run clock)
 * it drags every player within `radius` towards its centre at
 * `dragSpeed`; its core (`coreRadius`) hurts.
 */
export interface WhirlpoolShape {
  at: Vec2;
  radius: number;
  from: number;
  until: number;
}

export const WHIRLPOOL = {
  warnSeconds: 1,
  seconds: 4,
  radius: 150,
  dragSpeed: 70,
  coreRadius: 32,
  tickSeconds: 0.5,
  damage: 8,
} as const;

/** Is a whirlpool pulling at `clock`? */
export function whirlpoolActive(w: WhirlpoolShape, clock: number): boolean {
  return clock >= w.from - 1e-9 && clock < w.until - 1e-9;
}

/**
 * Where water pushes a player standing at `at` over a step of `dt`, as a
 * velocity (px/s): the pull, if it has started, and every active whirlpool
 * in reach. Never past the point it pulls to.
 */
export function waterDrift(
  at: Vec2,
  clock: number,
  pull: Pull | undefined,
  whirlpools: readonly WhirlpoolShape[],
  dt: number,
): Vec2 {
  let x = 0;
  let y = 0;
  const add = (to: Vec2, speed: number) => {
    const dx = to.x - at.x;
    const dy = to.y - at.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const s = dt > 0 ? Math.min(speed, d / dt) : speed;
    x += (dx / d) * s;
    y += (dy / d) * s;
  };
  if (pull && clock >= pull.from - 1e-9 && pull.left > 1e-9)
    add(pull.to, pull.speed);
  for (const w of whirlpools) {
    if (!whirlpoolActive(w, clock)) continue;
    if (Math.hypot(at.x - w.at.x, at.y - w.at.y) <= w.radius)
      add(w.at, WHIRLPOOL.dragSpeed);
  }
  return { x, y };
}

/**
 * A tidal surge (the Tide Priest's): a wall of water `thickness` thick
 * sweeping across `area` along `axis` in direction `dir`, its leading
 * edge at `pos`; `gaps` are the safe stretches along the other axis.
 */
export interface SurgeShape {
  area: Rect;
  axis: "x" | "y";
  dir: 1 | -1;
  pos: number;
  gaps: readonly { from: number; to: number }[];
}

export const SURGE = {
  warnSeconds: 1,
  speed: 160,
  thickness: 24,
  gapWidth: 96,
  gaps: 2,
  damage: 12,
} as const;

/** The band of water a surge covers now. */
export function surgeBand(s: SurgeShape): Rect {
  const t = SURGE.thickness;
  const back = s.pos - s.dir * t;
  const lo = Math.min(s.pos, back);
  return s.axis === "x"
    ? { x: lo, y: s.area.y, width: t, height: s.area.height }
    : { x: s.area.x, y: lo, width: s.area.width, height: t };
}

/** Does a surge hit a player at `p`: its band touches the hurtbox and the player is not in a gap? */
export function surgeHits(s: SurgeShape, p: Vec2): boolean {
  const band = surgeBand(s);
  const half = PLAYER_HEALTH.hurtboxSize / 2;
  const touches =
    p.x + half > band.x &&
    p.x - half < band.x + band.width &&
    p.y + half > band.y &&
    p.y - half < band.y + band.height;
  if (!touches) return false;
  const along = s.axis === "x" ? p.y : p.x;
  return !s.gaps.some((g) => along >= g.from && along <= g.to);
}

/** Where a surge starts: the edge of its area it sweeps away from. */
export function surgeStart(area: Rect, axis: "x" | "y", dir: 1 | -1): number {
  if (axis === "x") return dir === 1 ? area.x : area.x + area.width;
  return dir === 1 ? area.y : area.y + area.height;
}

/** Has a surge crossed all of its area? */
export function surgeDone(s: SurgeShape): boolean {
  const end =
    s.axis === "x"
      ? s.dir === 1
        ? s.area.x + s.area.width
        : s.area.x
      : s.dir === 1
        ? s.area.y + s.area.height
        : s.area.y;
  return s.dir === 1
    ? s.pos - SURGE.thickness >= end
    : s.pos + SURGE.thickness <= end;
}

/**
 * The gaps of the `k`th surge across a stretch from `lo` to `hi`: SURGE.gaps
 * gaps of SURGE.gapWidth, spread by a golden-ratio step so they move every time.
 */
export function surgeGaps(
  lo: number,
  hi: number,
  k: number,
): { from: number; to: number }[] {
  const span = hi - lo - SURGE.gapWidth;
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < SURGE.gaps; i++) {
    const f =
      ((((k * SURGE.gaps + i) * 0.618034 + i / SURGE.gaps) % 1) + 1) % 1;
    const from = lo + f * span;
    out.push({ from, to: from + SURGE.gapWidth });
  }
  return out;
}
