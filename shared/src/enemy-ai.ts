import { boxAround } from "./collision.ts";
import { NATURES_REACH } from "./abilities.ts";
import { ENEMY_RING_ATTACK, PLAYER_HEALTH } from "./combat-config.ts";
import {
  BRUTE,
  GRUNT,
  RING_BULLET,
  SLINGER,
  WARLORD,
  type EnemyBulletSpec,
  type EnemyKind,
} from "./enemy-config.ts";
import { isAlive, ringDirections, type EnemyState } from "./enemy.ts";
import { rotateVec, type Rect, type Vec2 } from "./geometry.ts";
import { stepMovement } from "./movement.ts";
import { stepFireCooldown } from "./weapon.ts";

/** What the AI needs to know about a living player. */
export interface AiTarget {
  id: number;
  position: Vec2;
}

/** A delayed area attack: hits living players inside `radius` when it lands. */
export interface HazardSpec {
  at: Vec2;
  radius: number;
  damage: number;
  delaySeconds: number;
}

/** One enemy's decision for one tick. */
export interface EnemyAction {
  /** The enemy after moving and updating its timers. */
  enemy: EnemyState;
  bullets: { direction: Vec2; spec: EnemyBulletSpec }[];
  /** Melee hits that landed this tick. */
  contacts: { playerId: number; damage: number }[];
  /** Enemies to add, belonging to this enemy (they die with it). */
  summons: { kind: EnemyKind; at: Vec2 }[];
  hazards: HazardSpec[];
}

/** What the AI knows about the world beyond the targets. */
export interface AiContext {
  /** Living enemies summoned by each enemy id. */
  aliveSummons: (summonerId: number) => number;
}

const NO_MOVE = { x: 0, y: 0 };
const NO_CONTEXT: AiContext = { aliveSummons: () => 0 };

type Nearest = { target: AiTarget; distance: number } | null;

/**
 * Enemy behavior by kind (T-029, T-037). Pure and deterministic: ties
 * between equally near players go to the earlier one in `targets`. Enemies
 * collide with walls (and closed doors) like players, but not with each
 * other or with players.
 * - dummy: stands still; ring burst while any player is within aggro range.
 * - grunt: walks straight at the nearest player; contact damage on a cooldown.
 * - slinger: holds a band of distance from the nearest player and throws
 *   aimed rocks at them.
 * - brute: walks up; when close and ready, stands and telegraphs, then
 *   charges in a locked straight line; only the charge hurts.
 * - warlord: stationary boss; aimed spreads and rotating rings; below half
 *   HP denser patterns, grunt reinforcements, and rockfall circles.
 */
export function enemyAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  walls: readonly Rect[],
  dtSeconds: number,
  context: AiContext = NO_CONTEXT,
): EnemyAction {
  const result = (
    e: EnemyState,
    more: Partial<Omit<EnemyAction, "enemy">> = {},
  ): EnemyAction => ({
    enemy: e,
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
    ...more,
  });
  if (!isAlive(enemy)) return result(enemy);
  const target = nearest(enemy.position, targets);
  switch (enemy.kind) {
    case "dummy":
      return dummyAct(enemy, target, dtSeconds, result);
    case "grunt":
      return gruntAct(enemy, target, walls, dtSeconds, result);
    case "slinger":
      return slingerAct(enemy, target, walls, dtSeconds, result);
    case "brute":
      return bruteAct(enemy, targets, target, walls, dtSeconds, result);
    case "warlord":
      return warlordAct(enemy, targets, target, dtSeconds, context, result);
  }
}

type Result = (
  e: EnemyState,
  more?: Partial<Omit<EnemyAction, "enemy">>,
) => EnemyAction;

function dummyAct(
  enemy: EnemyState,
  target: Nearest,
  dt: number,
  result: Result,
): EnemyAction {
  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    target !== null && target.distance <= ENEMY_RING_ATTACK.aggroRange,
    1 / ENEMY_RING_ATTACK.intervalSeconds,
  );
  return result(
    { ...enemy, attackCooldown: attack.remaining },
    {
      bullets: attack.fired
        ? ringDirections(ENEMY_RING_ATTACK.bullets).map((direction) => ({
            direction,
            spec: RING_BULLET,
          }))
        : [],
    },
  );
}

function gruntAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
): EnemyAction {
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  if (!target) return result({ ...enemy, attackCooldown: cooldown });
  const position = move(
    enemy,
    toward(enemy.position, target.target.position),
    GRUNT.speed,
    walls,
    dt,
  );
  const hits =
    touching(position, enemy.size, target.target.position) && cooldown <= 1e-9;
  return result(
    {
      ...enemy,
      position,
      attackCooldown: hits ? GRUNT.contactCooldownSeconds : cooldown,
    },
    {
      contacts: hits
        ? [{ playerId: target.target.id, damage: GRUNT.contactDamage }]
        : [],
    },
  );
}

function slingerAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
): EnemyAction {
  if (!target) {
    return result({
      ...enemy,
      attackCooldown: Math.max(0, enemy.attackCooldown - dt),
    });
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
  return result(
    { ...enemy, position, attackCooldown: attack.remaining },
    {
      bullets:
        attack.fired && (aim.x !== 0 || aim.y !== 0)
          ? [{ direction: aim, spec: SLINGER.rock }]
          : [],
    },
  );
}

function bruteAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "brute") return result(enemy);
  const cooldown = Math.max(0, enemy.attackCooldown - dt);

  switch (ai.mode) {
    case "walk": {
      if (!target) return result({ ...enemy, attackCooldown: cooldown });
      if (target.distance <= BRUTE.chargeTriggerRange && cooldown <= 1e-9) {
        return result({
          ...enemy,
          attackCooldown: 0,
          ai: { ...ai, mode: "windup", timer: BRUTE.windupSeconds },
        });
      }
      const position = move(
        enemy,
        toward(enemy.position, target.target.position),
        BRUTE.speed,
        walls,
        dt,
      );
      return result({ ...enemy, position, attackCooldown: cooldown });
    }
    case "windup": {
      const timer = ai.timer - dt;
      if (timer > 1e-9) return result({ ...enemy, ai: { ...ai, timer } });
      // Direction locks at the end of the telegraph: dodge sideways.
      const direction = target
        ? toward(enemy.position, target.target.position)
        : NO_MOVE;
      if (direction.x === 0 && direction.y === 0) {
        return result({
          ...enemy,
          ai: { ...ai, mode: "recover", timer: BRUTE.recoverSeconds },
        });
      }
      return result({
        ...enemy,
        ai: {
          ...ai,
          mode: "charge",
          timer: BRUTE.chargeSeconds,
          direction,
          hit: [],
        },
      });
    }
    case "charge": {
      const position = move(enemy, ai.direction, BRUTE.chargeSpeed, walls, dt);
      const contacts = targets
        .filter(
          (t) =>
            !ai.hit.includes(t.id) &&
            touching(position, enemy.size, t.position),
        )
        .map((t) => ({ playerId: t.id, damage: BRUTE.chargeDamage }));
      const hit = [...ai.hit, ...contacts.map((c) => c.playerId)];
      const travelled = Math.hypot(
        position.x - enemy.position.x,
        position.y - enemy.position.y,
      );
      // Stops at the end of the charge or when a wall stops it.
      // Measured against its (maybe slowed) speed, so a slow is not a wall.
      const blocked =
        travelled < BRUTE.chargeSpeed * speedFactor(enemy) * dt * 0.5;
      const timer = ai.timer - dt;
      const done = blocked || timer <= 1e-9;
      return result(
        {
          ...enemy,
          position,
          ai: done
            ? { ...ai, mode: "recover", timer: BRUTE.recoverSeconds, hit }
            : { ...ai, timer, hit },
        },
        { contacts },
      );
    }
    case "recover": {
      const timer = ai.timer - dt;
      return result({
        ...enemy,
        ai: timer > 1e-9 ? { ...ai, timer } : { ...ai, mode: "walk", timer: 0 },
      });
    }
  }
}

function warlordAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  dt: number,
  context: AiContext,
  result: Result,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "warlord") return result(enemy);
  const engaged = target !== null && target.distance <= WARLORD.aggroRange;
  const phaseTwo = enemy.hp < enemy.maxHp * WARLORD.phaseTwoBelow;
  const spreadCfg = phaseTwo ? WARLORD.spread.phase2 : WARLORD.spread.phase1;
  const ringCfg = phaseTwo ? WARLORD.ring.phase2 : WARLORD.ring.phase1;

  const tick = (t: number) => Math.max(0, t - dt);
  let { spread, ring, ringTurn, summon, rockfall } = ai;
  spread = tick(spread);
  ring = tick(ring);
  if (phaseTwo) {
    summon = tick(summon);
    rockfall = tick(rockfall);
  }
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  if (engaged && target) {
    if (spread <= 1e-9) {
      spread = spreadCfg.intervalSeconds;
      const aim = toward(enemy.position, target.target.position);
      const step = (WARLORD.spread.angleStepDegrees * Math.PI) / 180;
      const half = (spreadCfg.count - 1) / 2;
      for (let i = 0; i < spreadCfg.count; i++) {
        action.bullets.push({
          direction: rotateVec(aim, (i - half) * step),
          spec: WARLORD.spread.bullet,
        });
      }
    }
    if (ring <= 1e-9) {
      ring = ringCfg.intervalSeconds;
      const offset = (ringTurn * Math.PI) / ringCfg.count;
      ringTurn = 1 - ringTurn;
      for (const d of ringDirections(ringCfg.count)) {
        action.bullets.push({
          direction: rotateVec(d, offset),
          spec: WARLORD.ring.bullet,
        });
      }
    }
    if (phaseTwo && summon <= 1e-9) {
      summon = WARLORD.summon.intervalSeconds;
      const room = WARLORD.summon.maxAlive - context.aliveSummons(enemy.id);
      const n = Math.min(WARLORD.summon.count, Math.max(0, room));
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        action.summons.push({
          kind: WARLORD.summon.kind,
          at: {
            x: enemy.position.x + side * WARLORD.summon.offset,
            y: enemy.position.y + Math.floor(i / 2) * 24,
          },
        });
      }
    }
    if (phaseTwo && rockfall <= 1e-9) {
      rockfall = WARLORD.rockfall.intervalSeconds;
      for (const t of targets) {
        action.hazards.push({
          at: { ...t.position },
          radius: WARLORD.rockfall.radius,
          damage: WARLORD.rockfall.damage,
          delaySeconds: WARLORD.rockfall.delaySeconds,
        });
      }
    }
  }
  return {
    enemy: {
      ...enemy,
      ai: { ...ai, spread, ring, ringTurn, summon, rockfall },
    },
    ...action,
  };
}

/** True while a brute is telegraphing its charge (drawn as a warning). */
export function isTelegraphing(enemy: EnemyState): boolean {
  return enemy.ai.kind === "brute" && enemy.ai.mode === "windup";
}

function touching(position: Vec2, size: number, player: Vec2): boolean {
  return overlaps(
    boxAround(position, size),
    boxAround(player, PLAYER_HEALTH.hurtboxSize),
  );
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
    speed * speedFactor(enemy),
  );
}

/** Movement only: a slowed enemy (Nature's Reach, D-097) moves at half speed. */
function speedFactor(enemy: EnemyState): number {
  return enemy.slowed ? NATURES_REACH.slowFactor : 1;
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

function nearest(from: Vec2, targets: readonly AiTarget[]): Nearest {
  let best: Nearest = null;
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
