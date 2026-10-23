import { DUMMY_ENEMY, ENEMY_RING_ATTACK } from "./combat-config.ts";

// Goblin Warrens enemy roles (T-029, Phases 6b–6c). PROVISIONAL first-pass
// numbers chosen by Claude (the user delegated dungeon design, D-047),
// balanced for a fresh level-1 Serf (D-054: 20 HP, 0.5 HP/s); to be tuned
// in 6d (6d tuning: HP +~12% after the user's 2-player clear in 4:00). Change here only.

export const ENEMY_KINDS = [
  "dummy",
  "grunt",
  "slinger",
  "brute",
  "warlord",
] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** A projectile an enemy fires. */
export interface EnemyBulletSpec {
  damage: number;
  /** World pixels per second. */
  speed: number;
  size: number;
  /** Max travel distance. */
  range: number;
}

/** Stationary target that fires rings at nearby players (Phases 3–5). */
export const DUMMY = {
  maxHp: DUMMY_ENEMY.maxHp,
  size: DUMMY_ENEMY.size,
} as const;

/** Melee: runs at the nearest player and hurts on contact. */
export const GRUNT = {
  maxHp: 170,
  size: 14,
  /** Slower than the player (150), so it can be kited. */
  speed: 95,
  /** 10 contact hits kill a fresh 20 HP Serf (D-055). */
  contactDamage: 2,
  /** At most one contact hit per this many seconds, per grunt. */
  contactCooldownSeconds: 0.8,
} as const;

/** Ranged: keeps its distance and throws aimed rocks. */
export const SLINGER = {
  maxHp: 125,
  size: 14,
  speed: 70,
  /** Backs away when the nearest player is closer than this… */
  minRange: 140,
  /** …and approaches when farther than this. */
  maxRange: 240,
  /** Throws only at players within this distance. */
  throwRange: 360,
  throwIntervalSeconds: 1.6,
  rock: { damage: 2, speed: 200, size: 6, range: 400 },
} as const satisfies { rock: EnemyBulletSpec } & Record<string, unknown>;

/** Tough charger (6c): walks up, telegraphs, then charges in a straight line. Only the charge hurts. */
export const BRUTE = {
  maxHp: 450,
  size: 20,
  speed: 60,
  /** Starts a charge when the nearest player is this close and it is ready. */
  chargeTriggerRange: 240,
  /** Stands still and flashes (the telegraph) for this long. */
  windupSeconds: 0.7,
  chargeSpeed: 320,
  chargeSeconds: 0.9,
  /** Stands still after a charge. */
  recoverSeconds: 1.2,
  /** Per player, at most once per charge. */
  chargeDamage: 4,
} as const;

/**
 * Goblin Warlord boss (6c). Stationary; two phases split at half HP.
 * Phase 2 adds reinforcements and rockfall (the GDD's limited arena hazard).
 */
export const WARLORD = {
  maxHp: 5000,
  size: 28,
  /** Attacks while any player is this close. */
  aggroRange: 600,
  /** Phase 2 below this fraction of max HP. */
  phaseTwoBelow: 0.5,
  spread: {
    phase1: { count: 5, intervalSeconds: 1.4 },
    phase2: { count: 7, intervalSeconds: 1.2 },
    angleStepDegrees: 15,
    bullet: { damage: 2, speed: 170, size: 8, range: 520 },
  },
  ring: {
    phase1: { count: 12, intervalSeconds: 3 },
    phase2: { count: 16, intervalSeconds: 2 },
    bullet: { damage: 2, speed: 110, size: 8, range: 500 },
  },
  summon: {
    kind: "grunt",
    count: 2,
    intervalSeconds: 9,
    /** No more summons while this many of its summons are alive. */
    maxAlive: 6,
    /** Summons appear this far left and right of the Warlord. */
    offset: 60,
  },
  rockfall: {
    intervalSeconds: 3.5,
    /** A warning circle under each living player… */
    radius: 32,
    /** …that hits whoever is inside it this long later. */
    delaySeconds: 1.2,
    damage: 3,
  },
} as const;

export const RING_BULLET: EnemyBulletSpec = {
  damage: ENEMY_RING_ATTACK.damage,
  speed: ENEMY_RING_ATTACK.speed,
  size: ENEMY_RING_ATTACK.size,
  range: ENEMY_RING_ATTACK.range,
};

export const ENEMY_STATS: Record<EnemyKind, { maxHp: number; size: number }> = {
  dummy: DUMMY,
  grunt: GRUNT,
  slinger: SLINGER,
  brute: BRUTE,
  warlord: WARLORD,
};

/**
 * Seconds before a freshly spawned enemy's first attack, so a room waking
 * up does not hit the player on the very first frame.
 */
export const FIRST_ATTACK_DELAY: Record<EnemyKind, number> = {
  dummy: 0,
  grunt: GRUNT.contactCooldownSeconds / 2,
  slinger: SLINGER.throwIntervalSeconds / 2,
  /** Before its first charge. */
  brute: 1,
  /** Before its first spread and ring. */
  warlord: 1,
};

export function isEnemyKind(v: unknown): v is EnemyKind {
  return ENEMY_KINDS.some((k) => k === v);
}
