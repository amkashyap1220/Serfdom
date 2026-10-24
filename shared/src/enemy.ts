import {
  ENEMY_STATS,
  FIRST_ATTACK_DELAY,
  WARLORD,
  type EnemyKind,
} from "./enemy-config.ts";
import type { Vec2 } from "./geometry.ts";
import { applyDamage } from "./health.ts";
import { rescaleHp, scaledMaxHp } from "./party-scaling.ts";

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  /** Dungeon room it belongs to (counts toward clearing that room), or null. */
  roomId: string | null;
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
  /** The enemy that summoned it (it dies with its summoner), or null. */
  summonerId: number | null;
  /** A slinger that aims where its target will be (D-109). */
  leads: boolean;
  /** Seconds left of a shaman's chant: it deals more damage (D-115). */
  chant?: number;
  /** Per-kind behavior state (enemy-ai.ts). */
  ai: EnemyAi;
  /** Inside a Nature's Reach this tick: moves at half speed (D-097). Set by the world step. */
  slowed?: boolean;
  /** Warlock Curse (D-098): takes `bonus` more damage from every source while `remaining` > 0. */
  curse?: { remaining: number; bonus: number };
}

/**
 * Behavior state that only some kinds need. Timers count down in seconds.
 * - brute: walk → windup (telegraph) → charge (locked direction) → recover.
 * - warlord: one timer per attack; `ringTurn` alternates the ring's offset.
 */
export type EnemyAi =
  | { kind: "none" }
  | {
      kind: "brute";
      /** "dazed": after charging into a wall (D-112), before recovering. */
      mode: "walk" | "windup" | "charge" | "dazed" | "recover";
      timer: number;
      direction: Vec2;
      /** Players already hit by the current charge. */
      hit: readonly number[];
    }
  | {
      kind: "warlord";
      spread: number;
      ring: number;
      ringTurn: number;
      summon: number;
      rockfall: number;
    };

function initialAi(kind: EnemyKind): EnemyAi {
  switch (kind) {
    case "brute":
      return {
        kind,
        mode: "walk",
        timer: 0,
        direction: { x: 0, y: 0 },
        hit: [],
      };
    case "warlord": {
      const delay = FIRST_ATTACK_DELAY.warlord;
      return {
        kind,
        spread: delay,
        ring: delay,
        ringTurn: 0,
        summon: WARLORD.summon.intervalSeconds / 3,
        rockfall: WARLORD.rockfall.intervalSeconds / 2,
      };
    }
    default:
      return { kind: "none" };
  }
}

/** A fresh enemy of `kind` at full (solo) HP. */
export function newEnemy(
  id: number,
  kind: EnemyKind,
  position: Vec2,
  roomId: string | null,
  respawnSeconds: number | null,
  summonerId: number | null = null,
  leads = false,
): EnemyState {
  const { maxHp, size } = ENEMY_STATS[kind];
  return {
    summonerId,
    leads,
    ai: initialAi(kind),
    id,
    kind,
    roomId,
    position: { ...position },
    size,
    hp: maxHp,
    maxHp,
    baseMaxHp: maxHp,
    scaledFor: 1,
    respawnIn: 0,
    respawnSeconds,
    attackCooldown: FIRST_ATTACK_DELAY[kind],
  };
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
): { enemy: EnemyState; defeated: boolean; damage: number } {
  if (!Number.isFinite(damage) || damage < 0) {
    throw new RangeError(`damage must be finite and >= 0, got ${damage}`);
  }
  if (!isAlive(enemy)) return { enemy, defeated: false, damage: 0 };
  // A cursed enemy takes more from every source (D-098).
  const taken = damage * (1 + (enemy.curse?.bonus ?? 0));
  const { hp, died } = applyDamage(enemy.hp, taken);
  return {
    enemy: { ...enemy, hp, respawnIn: died ? (enemy.respawnSeconds ?? 0) : 0 },
    defeated: died,
    damage: taken,
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
