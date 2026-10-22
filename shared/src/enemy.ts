import type { Vec2 } from "./geometry.ts";

export interface EnemyState {
  id: number;
  position: Vec2;
  /** Square hit box size. */
  size: number;
  hp: number;
  maxHp: number;
  /** Seconds until it comes back; 0 while alive. */
  respawnIn: number;
}

export function isAlive(enemy: EnemyState): boolean {
  return enemy.hp > 0;
}

/**
 * Applies damage. Returns the new state and whether this hit defeated it.
 * Hits on a defeated enemy do nothing (it is not targetable anyway).
 */
export function damageEnemy(
  enemy: EnemyState,
  damage: number,
  respawnSeconds: number,
): { enemy: EnemyState; defeated: boolean } {
  if (!(damage >= 0) || !Number.isFinite(damage)) {
    throw new RangeError(`damage must be finite and >= 0, got ${damage}`);
  }
  if (!isAlive(enemy)) return { enemy, defeated: false };
  const hp = Math.max(enemy.hp - damage, 0);
  const defeated = hp === 0;
  return {
    enemy: { ...enemy, hp, respawnIn: defeated ? respawnSeconds : 0 },
    defeated,
  };
}

/** Counts down a defeated enemy's respawn timer; back to full HP at zero. */
export function stepRespawn(
  enemy: EnemyState,
  dtSeconds: number,
): { enemy: EnemyState; respawned: boolean } {
  if (isAlive(enemy)) return { enemy, respawned: false };
  const respawnIn = enemy.respawnIn - dtSeconds;
  if (respawnIn > 1e-9)
    return { enemy: { ...enemy, respawnIn }, respawned: false };
  return {
    enemy: { ...enemy, hp: enemy.maxHp, respawnIn: 0 },
    respawned: true,
  };
}
