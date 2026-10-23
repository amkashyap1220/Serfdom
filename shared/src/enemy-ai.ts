import { boxAround } from "./collision.ts";
import { ENEMY_RING_ATTACK, PLAYER_HEALTH } from "./combat-config.ts";
import {
  GRUNT,
  RING_BULLET,
  SLINGER,
  type EnemyBulletSpec,
} from "./enemy-config.ts";
import { isAlive, ringDirections, type EnemyState } from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { stepMovement } from "./movement.ts";
import { stepFireCooldown } from "./weapon.ts";

/** What the AI needs to know about a living player. */
export interface AiTarget {
  id: number;
  position: Vec2;
}

/** One enemy's decision for one tick. */
export interface EnemyAction {
  /** The enemy after moving and updating its attack timer. */
  enemy: EnemyState;
  bullets: { direction: Vec2; spec: EnemyBulletSpec }[];
  /** A melee hit landed on this player. */
  contact: { playerId: number; damage: number } | null;
}

const NO_MOVE = { x: 0, y: 0 };

/**
 * Enemy behavior by kind (T-029). Pure and deterministic: ties between
 * equally near players go to the earlier one in `targets`. Enemies collide
 * with walls (and closed doors) like players, but not with each other or
 * with players.
 * - dummy: stands still; ring burst while any player is within aggro range.
 * - grunt: walks straight at the nearest player; contact damage on a cooldown.
 * - slinger: holds a band of distance from the nearest player and throws
 *   aimed rocks at them.
 */
export function enemyAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  walls: readonly Rect[],
  dtSeconds: number,
): EnemyAction {
  const idle: EnemyAction = { enemy, bullets: [], contact: null };
  if (!isAlive(enemy)) return idle;
  const target = nearest(enemy.position, targets);
  switch (enemy.kind) {
    case "dummy":
      return dummyAct(enemy, target, dtSeconds);
    case "grunt":
      return gruntAct(enemy, target, walls, dtSeconds);
    case "slinger":
      return slingerAct(enemy, target, walls, dtSeconds);
  }
}

function dummyAct(
  enemy: EnemyState,
  target: { target: AiTarget; distance: number } | null,
  dt: number,
): EnemyAction {
  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    target !== null && target.distance <= ENEMY_RING_ATTACK.aggroRange,
    1 / ENEMY_RING_ATTACK.intervalSeconds,
  );
  return {
    enemy: { ...enemy, attackCooldown: attack.remaining },
    bullets: attack.fired
      ? ringDirections(ENEMY_RING_ATTACK.bullets).map((direction) => ({
          direction,
          spec: RING_BULLET,
        }))
      : [],
    contact: null,
  };
}

function gruntAct(
  enemy: EnemyState,
  target: { target: AiTarget; distance: number } | null,
  walls: readonly Rect[],
  dt: number,
): EnemyAction {
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  if (!target)
    return {
      enemy: { ...enemy, attackCooldown: cooldown },
      bullets: [],
      contact: null,
    };
  const position = move(
    enemy,
    toward(enemy.position, target.target.position),
    GRUNT.speed,
    walls,
    dt,
  );
  const touching = overlaps(
    boxAround(position, enemy.size),
    boxAround(target.target.position, PLAYER_HEALTH.hurtboxSize),
  );
  const hits = touching && cooldown <= 1e-9;
  return {
    enemy: {
      ...enemy,
      position,
      attackCooldown: hits ? GRUNT.contactCooldownSeconds : cooldown,
    },
    bullets: [],
    contact: hits
      ? { playerId: target.target.id, damage: GRUNT.contactDamage }
      : null,
  };
}

function slingerAct(
  enemy: EnemyState,
  target: { target: AiTarget; distance: number } | null,
  walls: readonly Rect[],
  dt: number,
): EnemyAction {
  if (!target) {
    const attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    return { enemy: { ...enemy, attackCooldown }, bullets: [], contact: null };
  }
  const at = target.target.position;
  let direction = NO_MOVE;
  if (target.distance < SLINGER.minRange)
    direction = toward(at, enemy.position);
  else if (target.distance > SLINGER.maxRange)
    direction = toward(enemy.position, at);
  const position = move(enemy, direction, SLINGER.speed, walls, dt);

  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    target.distance <= SLINGER.throwRange,
    1 / SLINGER.throwIntervalSeconds,
  );
  const aim = toward(position, at);
  return {
    enemy: { ...enemy, position, attackCooldown: attack.remaining },
    bullets:
      attack.fired && (aim.x !== 0 || aim.y !== 0)
        ? [{ direction: aim, spec: SLINGER.rock }]
        : [],
    contact: null,
  };
}

function move(
  enemy: EnemyState,
  direction: Vec2,
  speed: number,
  walls: readonly Rect[],
  dt: number,
): Vec2 {
  if (direction.x === 0 && direction.y === 0) return enemy.position;
  return stepMovement(
    enemy.position,
    direction,
    { width: enemy.size, height: enemy.size },
    walls,
    dt,
    speed,
  );
}

/** Unit vector from `from` to `to`, or (0, 0) if they coincide. */
export function toward(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return NO_MOVE;
  // Guard against rounding pushing the length a hair over 1.
  return { x: dx / length / (1 + 1e-12), y: dy / length / (1 + 1e-12) };
}

function nearest(
  from: Vec2,
  targets: readonly AiTarget[],
): { target: AiTarget; distance: number } | null {
  let best: { target: AiTarget; distance: number } | null = null;
  for (const t of targets) {
    const distance = Math.hypot(t.position.x - from.x, t.position.y - from.y);
    if (!best || distance < best.distance) best = { target: t, distance };
  }
  return best;
}

/** Strict overlap: touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
