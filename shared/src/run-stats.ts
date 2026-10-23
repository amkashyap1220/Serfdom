import type { SimEvent } from "./sim.ts";

/** How a player's dungeon run ended. */
export type RunResult = "completed" | "died" | "left";

export const RUN_RESULTS: readonly RunResult[] = ["completed", "died", "left"];

/**
 * One player's numbers for one run, shown on the death and completion
 * screens (D-050). Counted by the server from simulation events, never
 * reported by the client. Until characters persist (Phases 7–8) these are
 * the whole "life" of the serf.
 */
export interface RunStats {
  /** Time in the run until it ended. */
  seconds: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  enemiesDefeated: number;
  damageTaken: number;
}

export const RUN_STAT_KEYS = [
  "seconds",
  "shotsFired",
  "shotsHit",
  "damageDealt",
  "enemiesDefeated",
  "damageTaken",
] as const satisfies readonly (keyof RunStats)[];

export function newRunStats(): RunStats {
  return {
    seconds: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    enemiesDefeated: 0,
    damageTaken: 0,
  };
}

/** Adds one tick's events to a player's stats. Pure. */
export function recordRunEvents(
  stats: RunStats,
  playerId: number,
  events: readonly SimEvent[],
): RunStats {
  let next = stats;
  for (const e of events) {
    if (e.type === "shot" && e.playerId === playerId) {
      next = { ...next, shotsFired: next.shotsFired + 1 };
    } else if (e.type === "hit" && e.playerId === playerId) {
      next = {
        ...next,
        shotsHit: next.shotsHit + 1,
        damageDealt: next.damageDealt + e.damage,
      };
    } else if (e.type === "defeated" && e.playerId === playerId) {
      next = { ...next, enemiesDefeated: next.enemiesDefeated + 1 };
    } else if (e.type === "playerHit" && e.playerId === playerId) {
      next = { ...next, damageTaken: next.damageTaken + e.damage };
    }
  }
  return next;
}
