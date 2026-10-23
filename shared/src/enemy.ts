import type { Vec2 } from "./geometry.ts";
import { applyDamage } from "./health.ts";
import { rescaleHp, scaledMaxHp } from "./party-scaling.ts";

export interface EnemyState {
  id: number;
  position: Vec2;
  /** Square hit box size. */
  size: number;
  hp: number;
  /** Current max HP, after party scaling. */
  maxHp: number;
  /** Solo (1-player) max HP before party scaling. */
  baseMaxHp: number;
  /** Party size `maxHp` is currently scaled for. */
  scaledFor: number;
  /** Seconds until it comes back; 0 while alive (and forever if it never respawns). */
  respawnIn: number;
  /** Respawn delay after defeat, or null for enemies that stay dead (dungeons). */
  respawnSeconds: number | null;
  /** Seconds until its next attack is allowed. */
  attackCooldown: number;
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
): { enemy: EnemyState; defeated: boolean } {
  const { hp, died } = applyDamage(enemy.hp, damage); // validates damage
  if (!isAlive(enemy)) return { enemy, defeated: false };
  return {
    enemy: { ...enemy, hp, respawnIn: died ? (enemy.respawnSeconds ?? 0) : 0 },
    defeated: died,
  };
}

/** Counts down a defeated enemy's respawn timer; back to full HP at zero. */
export function stepRespawn(
  enemy: EnemyState,
  dtSeconds: number,
): { enemy: EnemyState; respawned: boolean } {
  if (isAlive(enemy) || enemy.respawnSeconds === null) {
    return { enemy, respawned: false };
  }
  const respawnIn = enemy.respawnIn - dtSeconds;
  if (respawnIn > 1e-9)
    return { enemy: { ...enemy, respawnIn }, respawned: false };
  return {
    enemy: { ...enemy, hp: enemy.maxHp, respawnIn: 0, attackCooldown: 0 },
    respawned: true,
  };
}

/** Rescales max HP for a new party size, keeping the current HP fraction (D-045). */
export function scaleEnemyForParty(
  enemy: EnemyState,
  players: number,
): EnemyState {
  const n = Math.max(1, players);
  if (enemy.scaledFor === n) return enemy;
  const maxHp = scaledMaxHp(enemy.baseMaxHp, n);
  return {
    ...enemy,
    maxHp,
    hp: rescaleHp(enemy.hp, enemy.maxHp, maxHp),
    scaledFor: n,
  };
}

/**
 * Unit directions for a ring of `count` evenly spaced bullets, the first
 * pointing east (+x) and continuing clockwise on screen (world y is down).
 */
export function ringDirections(count: number): Vec2[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
}
