import type { Rect, Vec2 } from "./geometry.ts";

/*
 * Stormspire's weather (D-139), shared by the simulation, prediction, and
 * drawing. Wind pushes players, so like the temple's water it keeps to the
 * run's clock: every client knows when each gust blows from the map and the
 * clock alone, and prediction matches the server.
 */

/** A wind channel: inside `rect`, gusts push players along `dir` (a unit vector). */
export interface Wind {
  rect: Rect;
  dir: Vec2;
}

/**
 * Gusts, one cycle for the whole run: calm, then streaks rising for
 * `warnSeconds`, then a gust of `gustSeconds` pushing at `speed`.
 */
export const WIND = {
  periodSeconds: 5,
  warnSeconds: 0.8,
  gustSeconds: 2,
  speed: 90,
} as const;

export type GustState = "calm" | "rising" | "gust";

/** The wind at `clock` seconds into the run. */
export function gustAt(clock: number): GustState {
  const t =
    ((clock % WIND.periodSeconds) + WIND.periodSeconds) % WIND.periodSeconds;
  const from = WIND.periodSeconds - WIND.gustSeconds;
  if (t >= from) return "gust";
  if (t >= from - WIND.warnSeconds) return "rising";
  return "calm";
}

/** The wind's push on a player at `at` (px/s): every gusting channel they stand in. */
export function windDrift(
  at: Vec2,
  clock: number,
  winds: readonly Wind[],
): Vec2 {
  if (winds.length === 0 || gustAt(clock) !== "gust") return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const w of winds) {
    const r = w.rect;
    if (
      at.x >= r.x &&
      at.x <= r.x + r.width &&
      at.y >= r.y &&
      at.y <= r.y + r.height
    ) {
      x += w.dir.x * WIND.speed;
      y += w.dir.y * WIND.speed;
    }
  }
  return { x, y };
}

/** Lightning (D-139): a rockfall room's strikes, each where a player stands. */
export const LIGHTNING = {
  everySeconds: 1.3,
  warnSeconds: 1,
  radius: 36,
  /** How far from the player it may land. */
  spread: 30,
} as const;
