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
