import { DUMMY_ENEMY, ENEMY_RING_ATTACK } from "./combat-config.ts";

// Goblin Warrens enemy roles (T-029, Phase 6b). PROVISIONAL first-pass
// numbers chosen by Claude (the user delegated dungeon design, D-047),
// aimed at the 5-minute solo clear; to be tuned in 6d. Change here only.

export const ENEMY_KINDS = ["dummy", "grunt", "slinger"] as const;
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
  maxHp: 150,
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
  maxHp: 110,
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
};

/**
 * Seconds before a freshly spawned enemy's first attack, so a room waking
 * up does not hit the player on the very first frame.
 */
export const FIRST_ATTACK_DELAY: Record<EnemyKind, number> = {
  dummy: 0,
  grunt: GRUNT.contactCooldownSeconds / 2,
  slinger: SLINGER.throwIntervalSeconds / 2,
};

export function isEnemyKind(v: unknown): v is EnemyKind {
  return ENEMY_KINDS.some((k) => k === v);
}
