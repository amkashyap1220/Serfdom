// Combat tuning for the Phase 3 prototype. PROVISIONAL: values approved by the
// user as temporary test values (2026-10-22), not final balance. Change here
// only, never inline elsewhere.

export const PLAYER_WEAPON = {
  /** HP removed per projectile hit. */
  damage: 25,
  shotsPerSecond: 4,
  /** World pixels per second. */
  projectileSpeed: 400,
  /** Max travel distance, and the auto-aim targeting range (center to center). */
  range: 300,
  /** Square hit box of a projectile, world pixels (Claude default). */
  projectileSize: 4,
} as const;

export const DUMMY_ENEMY = {
  /** Square hit box, world pixels. */
  size: 16,
  maxHp: 500,
  /** Seconds after defeat before it reappears at full HP. */
  respawnSeconds: 3,
} as const;

/**
 * A fresh level-1 Serf's health (D-055: 20 HP, replacing D-039's 200 test
 * value) and hurtbox (D-038).
 */
export const PLAYER_HEALTH = {
  maxHp: 20,
  /** Square box enemy projectiles can hit: 15×15, ½ px inset per side of the 16×16 sprite. */
  hurtboxSize: 15,
} as const;

/**
 * HP regeneration (D-056): always on, also mid-fight. GDD §6: Vitality
 * drives regen; until stats exist (Phase 8) a level-1 Serf regenerates the
 * base rate. Phase 8 replaces this with base + per-Vitality.
 */
export const PLAYER_REGEN = {
  /** HP per second for a fresh level-1 Serf (full from empty in 40 s). */
  hpPerSecond: 0.5,
} as const;

/** Prototype enemy attack: a ring burst (user-chosen pattern and values, 2026-10-22). */
export const ENEMY_RING_ATTACK = {
  /** Bullets per ring, evenly spaced; the first points east (+x). */
  bullets: 8,
  /** Seconds between rings. */
  intervalSeconds: 2,
  /** Scaled from 20 (for 200 HP) to keep ~10 hits to kill a 20 HP Serf (D-055). */
  damage: 2,
  /** World pixels per second. */
  speed: 120,
  /** Square hit box of each bullet. */
  size: 6,
  /** Max travel distance. */
  range: 400,
  /** The enemy attacks only while the player's center is within this distance of its center. */
  aggroRange: 300,
} as const;
