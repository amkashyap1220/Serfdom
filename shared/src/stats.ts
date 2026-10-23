import type { ClassId } from "./classes.ts";
import { CLASS_CHOICE_LEVEL } from "./progression.ts";

/**
 * Character stats (GDD §6). Growth is random within a range (D-074): levels
 * 2–5 roll the Serf's ranges, levels 6–20 the class's. Level growth never
 * passes a class's max; only stat potions reach it (D-075, Phase 9+). The
 * numbers are T-048 (drafted by Claude, approved by the user, D-076). Luck
 * is not here: it never grows (D-066) and comes only from items (D-068).
 */
export const STAT_KEYS = [
  "hp",
  "mp",
  "attack",
  "dexterity",
  "speed",
  "defense",
  "vitality",
  "wisdom",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  hp: "HP",
  mp: "MP",
  attack: "ATK",
  dexterity: "DEX",
  speed: "SPD",
  defense: "DEF",
  vitality: "VIT",
  wisdom: "WIS",
};

/** Inclusive roll range for one level. */
export type Range = readonly [min: number, max: number];

/** A fresh level-1 Serf: plays exactly like the Phase 6 prototype (D-055, D-056). */
export const SERF_BASE: Stats = {
  hp: 20,
  mp: 10,
  attack: 10,
  dexterity: 10,
  speed: 10,
  defense: 0,
  vitality: 10,
  wisdom: 10,
};

/** What a classless Serf rolls for each of levels 2–5. */
export const SERF_GROWTH: Record<StatKey, Range> = {
  hp: [1, 3],
  mp: [1, 2],
  attack: [0, 1],
  dexterity: [0, 1],
  speed: [0, 1],
  defense: [0, 0],
  vitality: [0, 1],
  wisdom: [0, 1],
};

export type Tier = "high" | "mid" | "low";

interface TierStat {
  /** Roll for each of levels 6–20. */
  growth: Range;
  /** The class max (D-075): level growth stops here; potions reach it. */
  max: number;
}

/** Attack, Dexterity, Vitality, and Wisdom share one scale. */
const MAIN = {
  high: { growth: [1, 2], max: 60 },
  mid: { growth: [0, 2], max: 50 },
  low: { growth: [0, 1], max: 40 },
} as const satisfies Record<Tier, TierStat>;

export const TIERS: Record<Tier, Record<StatKey, TierStat>> = {
  high: {
    hp: { growth: [3, 6], max: 200 },
    mp: { growth: [3, 6], max: 250 },
    attack: MAIN.high,
    dexterity: MAIN.high,
    speed: { growth: [0, 2], max: 45 },
    defense: { growth: [1, 2], max: 40 },
    vitality: MAIN.high,
    wisdom: MAIN.high,
  },
  mid: {
    hp: { growth: [2, 5], max: 160 },
    mp: { growth: [2, 4], max: 180 },
    attack: MAIN.mid,
    dexterity: MAIN.mid,
    speed: { growth: [0, 1], max: 35 },
    defense: { growth: [0, 1], max: 25 },
    vitality: MAIN.mid,
    wisdom: MAIN.mid,
  },
  low: {
    hp: { growth: [1, 4], max: 130 },
    mp: { growth: [1, 2], max: 120 },
    attack: MAIN.low,
    dexterity: MAIN.low,
    speed: { growth: [0, 1], max: 30 },
    defense: { growth: [0, 0], max: 15 },
    vitality: MAIN.low,
    wisdom: MAIN.low,
  },
};

const H = "high";
const M = "mid";
const L = "low";

/** Each class's tier per stat, in STAT_KEYS order: HP MP ATK DEX SPD DEF VIT WIS. */
const TIER_ROWS: Record<ClassId, readonly Tier[]> = {
  fighter: [H, L, M, H, M, H, M, L],
  barbarian: [H, L, H, M, M, M, H, L],
  rogue: [L, M, H, H, H, L, M, M],
  ranger: [M, L, H, H, M, M, M, L],
  wizard: [L, H, H, M, L, L, M, H],
  cleric: [M, H, L, L, M, M, H, H],
  bard: [M, H, L, M, H, L, M, H],
  warlock: [M, H, H, L, L, M, L, H],
  druid: [H, M, L, M, M, M, H, H],
  sorcerer: [L, H, H, H, M, L, L, M],
};

export function classTier(classId: ClassId, key: StatKey): Tier {
  const tier = TIER_ROWS[classId][STAT_KEYS.indexOf(key)];
  if (!tier) throw new Error(`no tier for ${classId} ${key}`);
  return tier;
}

export function statMax(classId: ClassId, key: StatKey): number {
  return TIERS[classTier(classId, key)][key].max;
}

/** One-time bonus on choosing a class: its High stats, +10 HP/MP, +3 others. */
export function classBonus(classId: ClassId): Stats {
  return mapStats((key) =>
    classTier(classId, key) === "high"
      ? key === "hp" || key === "mp"
        ? 10
        : 3
      : 0,
  );
}

export function zeroStats(): Stats {
  return mapStats(() => 0);
}

export function addStats(a: Stats, b: Stats): Stats {
  return mapStats((key) => a[key] + b[key]);
}

/** A whole number in [min, max], from a random() in [0, 1). */
export function rollRange(range: Range, random: () => number): number {
  const [min, max] = range;
  return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

/**
 * The gains for reaching `level`: Serf ranges up to level 5, then the
 * class's, never past the class max. A classless serf gains nothing past
 * level 5 (it must choose first, D-073).
 */
export function rollLevelGains(
  current: Stats,
  level: number,
  classId: ClassId | null,
  random: () => number,
): Stats {
  if (level <= CLASS_CHOICE_LEVEL) {
    return mapStats((key) => rollRange(SERF_GROWTH[key], random));
  }
  if (classId === null) return zeroStats();
  return mapStats((key) => {
    const { growth, max } = TIERS[classTier(classId, key)][key];
    const room = Math.max(0, max - current[key]);
    return Math.min(room, rollRange(growth, random));
  });
}

/** Adds `gains`, keeping a classed serf at or under its class max. */
export function applyGains(
  current: Stats,
  gains: Stats,
  classId: ClassId | null,
): Stats {
  return mapStats((key) => {
    const next = current[key] + gains[key];
    return classId ? Math.min(next, statMax(classId, key)) : next;
  });
}

function mapStats(f: (key: StatKey) => number): Stats {
  const out = {} as Stats;
  for (const key of STAT_KEYS) out[key] = f(key);
  return out;
}
