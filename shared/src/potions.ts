import type { ClassId } from "./classes.ts";
import type { DungeonId } from "./dungeons.ts";
import {
  SERF_MAX,
  serfStatMax,
  STAT_KEYS,
  type StatKey,
  type Stats,
} from "./stats.ts";

/*
 * Stat potions (D-089, D-075, D-118): the long grind past level 20. One
 * potion per stat (none for Luck, which only comes from items, D-066). A
 * potion is a permanent flat raise, never past the serf's max: the class
 * max, or the Serf max before a class (D-119). Level-ups add on top until
 * the max, so a stat maxed early on potions wastes its free level gains.
 */

/** How many potions the account's rack holds (D-118). */
export const RACK_SIZE = 20;

/** Chance per Luck point of a potion on completing this dungeon (D-118); 0 if absent. */
export const POTION_CHANCE: Partial<Record<DungeonId, number>> = {
  "goblin-stronghold": 0.2,
  // D-120: the harder dungeon pays faster.
  "forgotten-crypt": 0.3,
  // D-130.
  "ember-forge": 0.4,
  // D-135.
  "sunken-temple": 0.5,
  // D-136.
  "frost-hollow": 0.6,
  "clockwork-vault": 0.6,
  // D-138.
  "abyssal-gauntlet": 0.7,
  stormspire: 0.7,
  // D-140.
  "dragons-roost": 0.8,
};

/** A stat potion on the account: in the rack, or waiting for room. */
export interface Potion {
  id: number;
  stat: StatKey;
}

const POTION_NAMES: Record<StatKey, string> = {
  hp: "Health",
  mp: "Mana",
  attack: "Attack",
  dexterity: "Dexterity",
  speed: "Speed",
  defense: "Defense",
  vitality: "Vitality",
  wisdom: "Wisdom",
};

export function potionName(stat: StatKey): string {
  return `Potion of ${POTION_NAMES[stat]}`;
}

/** What one potion adds: +5 for HP and MP, +1 for the rest (D-118). */
export function potionAmount(stat: StatKey): number {
  return stat === "hp" || stat === "mp" ? 5 : 1;
}

/**
 * The potions a completion wins: one chance per Luck point (D-089), each
 * stat equally likely. A dungeon without potions uses no random numbers.
 */
export function rollPotions(
  dungeon: DungeonId,
  rolls: number,
  random: () => number,
): StatKey[] {
  const chance = POTION_CHANCE[dungeon] ?? 0;
  if (chance <= 0) return [];
  const won: StatKey[] = [];
  for (let i = 0; i < rolls; i++) {
    if (random() >= chance) continue;
    const pick = Math.floor(random() * STAT_KEYS.length);
    won.push(STAT_KEYS[Math.min(pick, STAT_KEYS.length - 1)]!);
  }
  return won;
}

/** Why this serf cannot drink this potion now, or null if it can. Safe to show. */
export function potionProblem(
  serf: { name: string; alive: boolean; classId: ClassId | null; stats: Stats },
  stat: StatKey,
): string | null {
  if (!serf.alive) return `${serf.name} is dead.`;
  if (serf.stats[stat] < serfStatMax(serf.classId, stat)) return null;
  if (serf.classId !== null) {
    return `${serf.name}'s ${POTION_NAMES[stat]} is already at its max.`;
  }
  return SERF_MAX[stat] === 0
    ? `A Serf has no ${POTION_NAMES[stat]} to raise: ${serf.name} needs a class first.`
    : `${serf.name}'s ${POTION_NAMES[stat]} is at the Serf max; a class raises it.`;
}

/**
 * What a serf's potion tally becomes after drinking (D-151): up by what the
 * potion actually added (less than its amount when the max cut it short).
 */
export function drinkPotionTally(
  potionStats: Stats,
  stats: Stats,
  classId: ClassId | null,
  stat: StatKey,
): Stats {
  const gained = drinkPotion(stats, classId, stat)[stat] - stats[stat];
  return { ...potionStats, [stat]: potionStats[stat] + gained };
}

/** The serf's stats after drinking: up by the potion's amount, never past its max. */
export function drinkPotion(
  stats: Stats,
  classId: ClassId | null,
  stat: StatKey,
): Stats {
  const max = serfStatMax(classId, stat);
  return { ...stats, [stat]: Math.min(max, stats[stat] + potionAmount(stat)) };
}
