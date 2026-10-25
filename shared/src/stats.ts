import type { ClassId } from "./classes.ts";
import { PLAYER_WEAPON } from "./combat-config.ts";
import type { WeaponType } from "./items.ts";
import { patternOf } from "./weapon-patterns.ts";
import { PLAYER_SPEED } from "./movement-config.ts";
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

/**
 * A classless Serf's max per stat (D-119): the best it can roll by level 5
 * (its start plus the top of every Serf roll). Potions can take a level-1
 * Serf there early; every value is below every class's max, so choosing a
 * class never lowers a stat.
 */
export const SERF_MAX: Stats = mapStats(
  (key) => SERF_BASE[key] + (CLASS_CHOICE_LEVEL - 1) * SERF_GROWTH[key][1],
);

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

/** The max for this serf: its class's, or the Serf max before a class (D-119). */
export function serfStatMax(classId: ClassId | null, key: StatKey): number {
  return classId ? statMax(classId, key) : SERF_MAX[key];
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
    // Never past the max: a Serf that drank potions gains less (D-119).
    return mapStats((key) => {
      const room = Math.max(0, serfStatMax(classId, key) - current[key]);
      return Math.min(room, rollRange(SERF_GROWTH[key], random));
    });
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

/** What a player's stats mean in combat (D-077, D-078 formulas). */
export interface PlayerCombat {
  maxHp: number;
  /** World pixels per second. */
  moveSpeed: number;
  shotsPerSecond: number;
  /** HP removed per projectile hit. */
  shotDamage: number;
  /** Attack's damage multiplier, 0.5 + ATK/20 (1 at ATK 10); abilities scale by it too. */
  attackFactor: number;
  /** Share of each incoming hit that is taken (1 = all of it). */
  damageTakenFactor: number;
  /** HP regenerated per second, always on (D-056). */
  regenPerSecond: number;
  /** MP for abilities (D-093, D-096). */
  maxMp: number;
  /** MP regenerated per second, always on (D-096). */
  mpRegenPerSecond: number;
  /** The weapon type, whose attack pattern each shot fires (D-141); null: bare hands. */
  weapon: WeaponType | null;
}

/**
 * D-078: damage 25 × (0.5 + ATK/20); shots/s 4 × (0.75 + DEX/40); speed
 * 150 × (0.75 + SPD/40) (the bases are PLAYER_WEAPON and PLAYER_SPEED; an
 * equipped weapon replaces the 25, D-083); taken hit × DEFENSE_SCALE/(DEFENSE_SCALE
 * + DEF) (D-121: was 10/(10 + DEF)); regen VIT/20 HP/s.
 * At a fresh Serf's stats (10s, DEF 0) every factor is exactly 1, so a
 * level-1 Serf plays as before (D-054–D-056). MP is the ability pool and
 * WIS regenerates it, WIS / 10 MP/s (D-093, D-096).
 */
/**
 * Defense's curve (D-121): DEF 15 takes 73% of a hit, DEF 45 takes 47%.
 * Was 10, which let plate gear block over 80%.
 */
export const DEFENSE_SCALE = 40;

export function combatFor(
  stats: Stats,
  weaponDamage: number = PLAYER_WEAPON.damage,
  weapon: WeaponType | null = null,
): PlayerCombat {
  return {
    maxHp: stats.hp,
    moveSpeed: PLAYER_SPEED * (0.75 + stats.speed / 40),
    // Each weapon fires at its own pace (D-141).
    shotsPerSecond:
      PLAYER_WEAPON.shotsPerSecond *
      (0.75 + stats.dexterity / 40) *
      patternOf(weapon).rate,
    shotDamage: weaponDamage * (0.5 + stats.attack / 20),
    attackFactor: 0.5 + stats.attack / 20,
    damageTakenFactor: DEFENSE_SCALE / (DEFENSE_SCALE + stats.defense),
    regenPerSecond: stats.vitality / 20,
    maxMp: stats.mp,
    mpRegenPerSecond: stats.wisdom / 10,
    weapon,
  };
}

/** Every serf's Luck before items (D-066): never changed by level or class. */
export const BASE_LUCK = 1;

/**
 * Luck (D-065–D-068): the number of reward chests rolled after a completed
 * dungeon. Base 1, plus each equipped item's Luck (+1 at most per item,
 * never negative), no cap. Items arrive in Phase 9; until then every
 * serf has 1.
 */
export function luckOf(equipped: readonly { luck: number }[] = []): number {
  return equipped.reduce((sum, item) => sum + item.luck, BASE_LUCK);
}
