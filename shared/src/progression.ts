import type { DungeonId } from "./dungeons.ts";

/**
 * Levels and EXP (Phase 8a). Confirmed: level cap 20, no levels or stat
 * gains past it, lifetime EXP keeps counting (GDD §3); EXP only from
 * completing a dungeon (D-069); levels 1–20 are fast, and a dungeon gives
 * less EXP to serfs above its level range (D-071). The numbers are
 * PROVISIONAL (T-045). A serf's level is always derived from its lifetime
 * EXP, so the two can never disagree.
 */
export const MAX_LEVEL = 20;

/** A serf picks its permanent class on reaching this level (D-073). */
export const CLASS_CHOICE_LEVEL = 5;

export interface DungeonExp {
  /** EXP for a clear by a serf at or below `topLevel`. */
  base: number;
  /** Highest level the dungeon is aimed at; above it the EXP falls off. */
  topLevel: number;
}

/** EXP each completing player can get per dungeon (T-045). */
export const DUNGEON_EXP: Record<DungeonId, DungeonExp> = {
  // GDD §10: aimed primarily at levels 1–9.
  "goblin-warrens": { base: 100, topLevel: 9 },
  training: { base: 100, topLevel: 9 },
};

/** Each level above a dungeon's top level keeps this share of its EXP (T-045). */
export const EXP_FALLOFF_PER_LEVEL = 0.9;

/**
 * EXP a serf at `level` gets for clearing `dungeon`: full up to the
 * dungeon's top level, then 10% less per level above it. Never below 1,
 * so a clear always counts on the leaderboard.
 */
export function clearExp(dungeon: DungeonId, level: number): number {
  const { base, topLevel } = DUNGEON_EXP[dungeon];
  const over = Math.max(0, level - topLevel);
  return Math.max(1, Math.round(base * EXP_FALLOFF_PER_LEVEL ** over));
}

/** EXP needed to go from `level` to `level + 1` (0 at the cap). */
export function expToNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 100 + 15 * (level - 1);
}

/** Lifetime EXP at which `level` is reached (level 1 = 0). */
export function totalExpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) {
    total += expToNextLevel(l);
  }
  return total;
}

/** The level a serf with this lifetime EXP has. */
export function levelForExp(exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && exp >= totalExpForLevel(level + 1)) level++;
  return level;
}

/** Progress inside the current level, for an EXP bar (`needed` 0 at the cap). */
export function levelProgress(exp: number): {
  level: number;
  into: number;
  needed: number;
} {
  const level = levelForExp(exp);
  return {
    level,
    into: exp - totalExpForLevel(level),
    needed: expToNextLevel(level),
  };
}
