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
  /** Slower than the player (150), so it can be kited (D-111: was 95). */
  speed: 76,
  /** 7 contact hits kill a fresh 20 HP Serf (D-055; D-111: was 2). */
  contactDamage: 3,
  /** At most one contact hit per this many seconds, per grunt (D-111: was 0.8). */
  contactCooldownSeconds: 1.2,
} as const;

/** Ranged: keeps its distance and throws aimed rocks. */
export const SLINGER = {
  maxHp: 125,
  size: 14,
  /** D-111: was 70. */
  speed: 56,
  /** Backs away when the nearest player is closer than this… */
  minRange: 140,
  /** …and approaches when farther than this. */
  maxRange: 240,
  /** Throws only at players within this distance. */
  throwRange: 360,
  /** D-111: was 1.6 s and 2 damage; the rock flies as fast as before. */
  throwIntervalSeconds: 2.4,
  rock: { damage: 3, speed: 200, size: 6, range: 400 },
} as const satisfies { rock: EnemyBulletSpec } & Record<string, unknown>;

/** Tough charger (6c): walks up, telegraphs, then charges in a straight line. Only the charge hurts. */
export const BRUTE = {
  maxHp: 450,
  size: 20,
  /** D-111: was 60. */
  speed: 48,
  /** Starts a charge when the nearest player is this close and it is ready. */
  chargeTriggerRange: 240,
  /** Stands still and flashes (the telegraph) for this long (D-111: was 0.7). */
  windupSeconds: 0.9,
  /** D-111: was 320. */
  chargeSpeed: 260,
  chargeSeconds: 0.9,
  /** Stands still after a charge (D-111: was 1.2). */
  recoverSeconds: 2.4,
  /** Per player, at most once per charge (D-111: was 4). */
  chargeDamage: 6,
  /** Dazed after charging into a wall or obstacle, then it recovers (D-112). */
  dazeSeconds: 1.5,
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
  // D-111: attacks 1.5× less often, 1.5× the damage (was 1.4/1.2 s, 3/2 s,
  // 2 damage; summons every 9 s; rockfall every 3.5 s for 3).
  spread: {
    phase1: { count: 5, intervalSeconds: 2.1 },
    phase2: { count: 7, intervalSeconds: 1.8 },
    angleStepDegrees: 15,
    bullet: { damage: 3, speed: 170, size: 8, range: 520 },
  },
  ring: {
    phase1: { count: 12, intervalSeconds: 4.5 },
    phase2: { count: 16, intervalSeconds: 3 },
    bullet: { damage: 3, speed: 110, size: 8, range: 500 },
  },
  summon: {
    kind: "grunt",
    count: 2,
    intervalSeconds: 12,
    /** No more summons while this many of its summons are alive. */
    maxAlive: 6,
    /** Summons appear this far left and right of the Warlord. */
    offset: 60,
  },
  rockfall: {
    intervalSeconds: 5,
    /** A warning circle under each living player… */
    radius: 32,
    /** …that hits whoever is inside it this long later. */
    delaySeconds: 1.2,
    damage: 5,
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
