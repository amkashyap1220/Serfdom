import type { RunResult, RunStats } from "./run-stats.ts";

/** Living serfs an account may have at once (D-061). */
export const SERF_SLOTS = 2;

export const SERF_NAME_MIN = 3;
export const SERF_NAME_MAX = 16;

/**
 * Trims and collapses runs of spaces, so "  Aldric   Mudfoot " and
 * "Aldric Mudfoot" are the same name.
 */
export function normalizeSerfName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * PROVISIONAL rules (7b): 3–16 characters; ASCII letters, digits, and
 * single spaces; must start with a letter. Uniqueness among living serfs
 * (D-064) is checked by the server. No offensive-word filter yet.
 */
export function serfNameProblem(name: string): string | null {
  if (name.length < SERF_NAME_MIN) {
    return `Use at least ${SERF_NAME_MIN} characters.`;
  }
  if (name.length > SERF_NAME_MAX) {
    return `Use at most ${SERF_NAME_MAX} characters.`;
  }
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(name)) {
    return "Use letters, digits, and spaces, starting with a letter.";
  }
  return null;
}

/** A serf's whole life so far: run stats added up, plus how many runs and clears. */
export interface LifeStats extends RunStats {
  runs: number;
  clears: number;
}

export function newLifeStats(): LifeStats {
  return {
    runs: 0,
    clears: 0,
    seconds: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    enemiesDefeated: 0,
    damageTaken: 0,
  };
}

/** Adds one finished run to a serf's life. Pure. */
export function addRunToLife(
  life: LifeStats,
  result: RunResult,
  run: RunStats,
): LifeStats {
  return {
    runs: life.runs + 1,
    clears: life.clears + (result === "completed" ? 1 : 0),
    seconds: life.seconds + run.seconds,
    shotsFired: life.shotsFired + run.shotsFired,
    shotsHit: life.shotsHit + run.shotsHit,
    damageDealt: life.damageDealt + run.damageDealt,
    enemiesDefeated: life.enemiesDefeated + run.enemiesDefeated,
    damageTaken: life.damageTaken + run.damageTaken,
  };
}

/** What a player sees about one of their serfs. */
export interface SerfSummary {
  id: number;
  name: string;
  /** Derived from `exp` (progression.ts); never stored on its own. */
  level: number;
  /** Lifetime EXP (keeps counting past the level cap; the leaderboard score). */
  exp: number;
  alive: boolean;
  life: LifeStats;
  /** Where and to what it died (dead serfs only). */
  death: { dungeon: string; killedBy: string | null } | null;
}

export const LIFE_STAT_KEYS = [
  "runs",
  "clears",
  "seconds",
  "shotsFired",
  "shotsHit",
  "damageDealt",
  "enemiesDefeated",
  "damageTaken",
] as const satisfies readonly (keyof LifeStats)[];

const FIRST = [
  "Aldric",
  "Bertram",
  "Cuthbert",
  "Edda",
  "Godwin",
  "Hilda",
  "Osric",
  "Wulfric",
  "Agnes",
  "Ralf",
  "Mildred",
  "Edwin",
  "Ada",
  "Tobin",
  "Maud",
  "Odo",
  "Gunther",
  "Elsbeth",
  "Hamon",
  "Rowena",
];
const LAST = [
  "Mudfoot",
  "Turnip",
  "Ditchley",
  "Plow",
  "Barley",
  "Thatch",
  "Muck",
  "Fenwick",
  "Rye",
  "Stubble",
  "Hayes",
  "Marsh",
  "Oxley",
  "Furrow",
  "Bramble",
];

/** A random medieval serf name that passes the rules (the Suggest button). */
export function suggestSerfName(random: () => number = Math.random): string {
  const pick = (list: readonly string[]) =>
    list[Math.floor(random() * list.length)] ?? list[0] ?? "Serf";
  for (let i = 0; i < 20; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (!serfNameProblem(name)) return name;
  }
  return pick(FIRST);
}
