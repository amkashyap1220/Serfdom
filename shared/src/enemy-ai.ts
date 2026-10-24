import { boxAround, segmentHitTime } from "./collision.ts";
import { NATURES_REACH } from "./abilities.ts";
import { ENEMY_RING_ATTACK, PLAYER_HEALTH } from "./combat-config.ts";
import {
  BOMBER,
  BRUTE,
  GRUNT,
  SHAMAN,
  SKULKER,
  WARCHIEF,
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
  /** Px per second; leading slingers aim with it (D-109). Still if absent. */
  velocity?: Vec2;
}

/** A leading slinger looks at most this far ahead (D-109). */
export const MAX_LEAD_SECONDS = 0.6;

/**
 * Where to throw: at the target, or for a leading slinger where the target
 * will be when the rock arrives, if it keeps moving the same way (at most
 * MAX_LEAD_SECONDS ahead).
 */
export function throwPoint(
  from: Vec2,
  target: AiTarget,
  rockSpeed: number,
  leads: boolean,
): Vec2 {
  const v = target.velocity;
  if (!leads || !v) return target.position;
  const distance = Math.hypot(
    target.position.x - from.x,
    target.position.y - from.y,
  );
  const ahead = Math.min(MAX_LEAD_SECONDS, distance / rockSpeed);
  return {
    x: target.position.x + v.x * ahead,
    y: target.position.y + v.y * ahead,
  };
}

/** A delayed area attack: hits living players inside `radius` when it lands. */
export interface HazardSpec {
  at: Vec2;
  radius: number;
  damage: number;
  delaySeconds: number;
  /** A bomb (D-115): where it lands burns for a while. */
  fire?: { seconds: number; tickSeconds: number; damage: number };
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
  /** A shaman's chant (D-115): goblins inside the circle are strengthened. */
  chant?: { at: Vec2; radius: number };
  /**
   * The Warchief's axe sweep (D-117), for drawing: the circle it will hit
   * (`warning`, when the axe goes up) and then the hit itself.
   */
  sweep?: { at: Vec2; radius: number; warning: boolean };
}

/** What the AI knows about the world beyond the targets. */
export interface AiContext {
  /** Living enemies summoned by each enemy id. */
  aliveSummons: (summonerId: number) => number;
  /**
   * Where to head to reach `to` round walls and doorways (D-114), from the
   * server's grid; null if unreachable. Absent: corner steering only.
   */
  waypoint?: (from: Vec2, to: Vec2, half: number) => Vec2 | null;
  /** Living enemies at the start of the tick (shamans look for them, D-115). */
  allies?: () => readonly EnemyState[];
  /** The holes of a room (the Warchief's war cry calls goblins out of them, D-117). */
  holesOf?: (roomId: string) => readonly Vec2[];
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
      return gruntAct(enemy, target, walls, dtSeconds, result, context);
    case "slinger":
      return slingerAct(enemy, target, walls, dtSeconds, result, context);
    case "brute":
      return bruteAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "warlord":
      return warlordAct(enemy, targets, target, dtSeconds, context, result);
    case "skulker":
      return skulkerAct(enemy, target, walls, dtSeconds, result, context);
    case "bomber":
      return bomberAct(enemy, target, walls, dtSeconds, result, context);
    case "shaman":
      return shamanAct(enemy, target, walls, dtSeconds, result, context);
    case "warchief":
      return warchiefAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
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
  context: AiContext = NO_CONTEXT,
): EnemyAction {
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  if (!target) return result({ ...enemy, attackCooldown: cooldown });
  const position = move(
    enemy,
    toward(
      enemy.position,
      route(
        enemy.position,
        target.target.position,
        enemy.size / 2,
        walls,
        context,
      ),
    ),
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
  context: AiContext = NO_CONTEXT,
): EnemyAction {
  if (!target) {
    return result({
      ...enemy,
      attackCooldown: Math.max(0, enemy.attackCooldown - dt),
    });
  }
  const at = target.target.position;
  const throwAt = throwPoint(
    enemy.position,
    target.target,
    SLINGER.rock.speed,
    enemy.leads,
  );
  // No throwing into cover (D-112): step sideways until the line is clear.
  const blocked = lineBlocked(
    enemy.position,
    throwAt,
    SLINGER.rock.size / 2,
    walls,
  );
  let direction = NO_MOVE;
  if (blocked) {
    const ahead = toward(enemy.position, at);
    const side = enemy.id % 2 === 0 ? 1 : -1;
    direction = { x: -ahead.y * side, y: ahead.x * side };
  } else if (target.distance < SLINGER.minRange)
    direction = toward(at, enemy.position);
  else if (target.distance > SLINGER.maxRange)
    direction = toward(
      enemy.position,
      route(enemy.position, at, enemy.size / 2, walls, context),
    );
  const position = move(enemy, direction, SLINGER.speed, walls, dt);

  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    !blocked && target.distance <= SLINGER.throwRange,
    1 / SLINGER.throwIntervalSeconds,
  );
  const aim = toward(
    position,
    throwPoint(position, target.target, SLINGER.rock.speed, enemy.leads),
  );
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

/** Ahead of a moving target by `seconds` (where it is heading). */
function ahead(target: AiTarget, seconds: number): Vec2 {
  const v = target.velocity ?? NO_MOVE;
  return {
    x: target.position.x + v.x * seconds,
    y: target.position.y + v.y * seconds,
  };
}

function skulkerAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  if (!target) return result({ ...enemy, attackCooldown: cooldown });
  // Cut you off: run to where you are heading, then lunge (D-115).
  const goal =
    target.distance > SKULKER.lungeRange
      ? ahead(target.target, SKULKER.leadSeconds)
      : target.target.position;
  const position = move(
    enemy,
    toward(
      enemy.position,
      route(enemy.position, goal, enemy.size / 2, walls, context),
    ),
    SKULKER.speed,
    walls,
    dt,
  );
  const hits =
    touching(position, enemy.size, target.target.position) && cooldown <= 1e-9;
  return result(
    {
      ...enemy,
      position,
      attackCooldown: hits ? SKULKER.contactCooldownSeconds : cooldown,
    },
    {
      contacts: hits
        ? [{ playerId: target.target.id, damage: SKULKER.contactDamage }]
        : [],
    },
  );
}

function bomberAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  if (!target) {
    return result({
      ...enemy,
      attackCooldown: Math.max(0, enemy.attackCooldown - dt),
    });
  }
  const at = target.target.position;
  let direction = NO_MOVE;
  if (target.distance < BOMBER.minRange) direction = toward(at, enemy.position);
  else if (target.distance > BOMBER.maxRange)
    direction = toward(
      enemy.position,
      route(enemy.position, at, enemy.size / 2, walls, context),
    );
  const position = move(enemy, direction, BOMBER.speed, walls, dt);
  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    target.distance <= BOMBER.throwRange,
    1 / BOMBER.throwIntervalSeconds,
  );
  // Lobbed over everything: lands where you will be (D-115).
  return result(
    { ...enemy, position, attackCooldown: attack.remaining },
    {
      hazards: attack.fired
        ? [
            {
              at: ahead(target.target, BOMBER.leadSeconds),
              radius: BOMBER.radius,
              damage: BOMBER.damage,
              delaySeconds: BOMBER.flightSeconds,
              fire: BOMBER.fire,
            },
          ]
        : [],
    },
  );
}

function shamanAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const near = (context.allies?.() ?? []).filter(
    (e) =>
      e.id !== enemy.id &&
      e.kind !== "shaman" &&
      isAlive(e) &&
      Math.hypot(
        e.position.x - enemy.position.x,
        e.position.y - enemy.position.y,
      ) <= SHAMAN.seekRange,
  );
  // Keep away from players; otherwise go to the thick of the goblins.
  let direction = NO_MOVE;
  if (target && target.distance < SHAMAN.keepAway) {
    direction = toward(target.target.position, enemy.position);
  } else if (near.length > 0) {
    const centre = {
      x: near.reduce((s, e) => s + e.position.x, 0) / near.length,
      y: near.reduce((s, e) => s + e.position.y, 0) / near.length,
    };
    if (
      Math.hypot(centre.x - enemy.position.x, centre.y - enemy.position.y) > 24
    ) {
      direction = toward(
        enemy.position,
        route(enemy.position, centre, enemy.size / 2, walls, context),
      );
    }
  }
  const position = move(enemy, direction, SHAMAN.speed, walls, dt);
  const inReach = near.some(
    (e) =>
      Math.hypot(e.position.x - position.x, e.position.y - position.y) <=
      SHAMAN.chantRadius,
  );
  const chant = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    inReach,
    1 / SHAMAN.chantIntervalSeconds,
  );
  return result(
    { ...enemy, position, attackCooldown: chant.remaining },
    chant.fired
      ? { chant: { at: { ...position }, radius: SHAMAN.chantRadius } }
      : {},
  );
}

function bruteAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext = NO_CONTEXT,
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
        toward(
          enemy.position,
          route(
            enemy.position,
            target.target.position,
            enemy.size / 2,
            walls,
            context,
          ),
        ),
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
      // Slamming into a wall or obstacle dazes it first (D-112).
      const next = blocked
        ? { ...ai, mode: "dazed" as const, timer: BRUTE.dazeSeconds, hit }
        : timer <= 1e-9
          ? {
              ...ai,
              mode: "recover" as const,
              timer: BRUTE.recoverSeconds,
              hit,
            }
          : { ...ai, timer, hit };
      return result({ ...enemy, position, ai: next }, { contacts });
    }
    case "dazed": {
      const timer = ai.timer - dt;
      return result({
        ...enemy,
        ai:
          timer > 1e-9
            ? { ...ai, timer }
            : { ...ai, mode: "recover", timer: BRUTE.recoverSeconds },
      });
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
  if (enemy.ai.kind === "warchief") {
    return enemy.ai.mode === "sweepWindup" || enemy.ai.mode === "chargeWindup";
  }
  return enemy.ai.kind === "brute" && enemy.ai.mode === "windup";
}

/** A brute that charged into a wall, standing dazed (D-112). */
export function isDazed(enemy: EnemyState): boolean {
  return (
    (enemy.ai.kind === "brute" || enemy.ai.kind === "warchief") &&
    enemy.ai.mode === "dazed"
  );
}

/** The Warchief's phase (D-117): 1, 2 below 66% HP, 3 below 33%. */
export function warchiefPhase(enemy: EnemyState): 1 | 2 | 3 {
  const f = enemy.hp / enemy.maxHp;
  if (f < WARCHIEF.phaseThreeBelow) return 3;
  return f < WARCHIEF.phaseTwoBelow ? 2 : 1;
}

/** The middle of the circle the Warchief's sweep hits (D-117). */
export function sweepCentre(position: Vec2, facing: Vec2): Vec2 {
  return {
    x: position.x + facing.x * WARCHIEF.sweep.reach,
    y: position.y + facing.y * WARCHIEF.sweep.reach,
  };
}

function warchiefAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "warchief") return result(enemy);
  const phase = warchiefPhase(enemy);
  // Enraged in phase 3: every attack comes back sooner.
  const rate = phase === 3 ? WARCHIEF.enragedRate : 1;
  const tick = (t: number) => Math.max(0, t - dt);
  let next = {
    ...ai,
    sweep: tick(ai.sweep),
    axes: tick(ai.axes),
    charge: phase >= 2 ? tick(ai.charge) : ai.charge,
    warCry: phase >= 2 ? tick(ai.warCry) : ai.warCry,
    slam: phase === 3 ? tick(ai.slam) : ai.slam,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  let position = enemy.position;
  const fan = (aim: Vec2) => {
    const step = (WARCHIEF.axes.angleStepDegrees * Math.PI) / 180;
    const half = (WARCHIEF.axes.count - 1) / 2;
    for (let i = 0; i < WARCHIEF.axes.count; i++) {
      action.bullets.push({
        direction: rotateVec(aim, (i - half) * step),
        spec: WARCHIEF.axes.bullet,
      });
    }
  };

  // Ranged attacks run whatever it is doing (but not while dazed).
  if (target && next.mode !== "dazed") {
    if (next.axes <= 1e-9) {
      next.axes = WARCHIEF.axes.intervalSeconds * rate;
      fan(toward(enemy.position, target.target.position));
    }
    if (phase === 3 && next.slam <= 1e-9) {
      next.slam = WARCHIEF.slam.intervalSeconds * rate;
      for (const d of ringDirections(WARCHIEF.slam.count)) {
        action.bullets.push({ direction: d, spec: WARCHIEF.slam.bullet });
      }
    }
    if (phase >= 2 && next.warCry <= 1e-9) {
      next.warCry = WARCHIEF.warCry.intervalSeconds * rate;
      const room = WARCHIEF.warCry.maxAlive - context.aliveSummons(enemy.id);
      const n = Math.min(WARCHIEF.warCry.count, Math.max(0, room));
      const holes = enemy.roomId ? (context.holesOf?.(enemy.roomId) ?? []) : [];
      for (let i = 0; i < n; i++) {
        const hole = holes[(next.cries + i) % Math.max(1, holes.length)];
        action.summons.push({
          kind: WARCHIEF.warCry.kind,
          at: hole
            ? { ...hole }
            : { x: enemy.position.x + (i % 2 ? 60 : -60), y: enemy.position.y },
        });
      }
      next.cries += n;
    }
  }

  switch (next.mode) {
    case "walk": {
      if (!target) break;
      if (
        next.sweep <= 1e-9 &&
        target.distance <= WARCHIEF.sweep.triggerRange
      ) {
        // It picks where to swing as the axe goes up: the warning shows
        // exactly where it will hit, so stepping out of it is the dodge.
        const direction = toward(enemy.position, target.target.position);
        next = {
          ...next,
          mode: "sweepWindup",
          timer: WARCHIEF.sweep.windupSeconds,
          direction,
        };
        action.sweep = {
          at: sweepCentre(enemy.position, direction),
          radius: WARCHIEF.sweep.radius,
          warning: true,
        };
        break;
      }
      if (
        phase >= 2 &&
        next.charge <= 1e-9 &&
        target.distance <= WARCHIEF.charge.triggerRange
      ) {
        next = {
          ...next,
          mode: "chargeWindup",
          timer: WARCHIEF.charge.windupSeconds,
        };
        break;
      }
      position = move(
        enemy,
        toward(
          enemy.position,
          route(
            enemy.position,
            target.target.position,
            enemy.size / 2,
            walls,
            context,
          ),
        ),
        WARCHIEF.speed,
        walls,
        dt,
      );
      break;
    }
    case "sweepWindup": {
      const timer = next.timer - dt;
      if (timer > 1e-9) {
        next = { ...next, timer };
        break;
      }
      const at = sweepCentre(enemy.position, next.direction);
      for (const t of targets) {
        if (
          Math.hypot(t.position.x - at.x, t.position.y - at.y) <=
          WARCHIEF.sweep.radius
        ) {
          action.contacts.push({
            playerId: t.id,
            damage: WARCHIEF.sweep.damage,
          });
        }
      }
      action.sweep = { at, radius: WARCHIEF.sweep.radius, warning: false };
      next = {
        ...next,
        mode: "recover",
        timer: WARCHIEF.sweep.recoverSeconds,
        sweep: WARCHIEF.sweep.cooldownSeconds * rate,
      };
      break;
    }
    case "chargeWindup": {
      const timer = next.timer - dt;
      if (timer > 1e-9) {
        next = { ...next, timer };
        break;
      }
      // Direction locks at the end of the warning: dodge sideways.
      const direction = target
        ? toward(enemy.position, target.target.position)
        : NO_MOVE;
      next = {
        ...next,
        mode: "charge",
        timer: WARCHIEF.charge.seconds,
        direction,
        hit: [],
        charge: WARCHIEF.charge.intervalSeconds * rate,
      };
      break;
    }
    case "charge": {
      position = move(enemy, next.direction, WARCHIEF.charge.speed, walls, dt);
      for (const t of targets) {
        if (
          !next.hit.includes(t.id) &&
          touching(position, enemy.size, t.position)
        ) {
          action.contacts.push({
            playerId: t.id,
            damage: WARCHIEF.charge.damage,
          });
          next = { ...next, hit: [...next.hit, t.id] };
        }
      }
      const travelled = Math.hypot(
        position.x - enemy.position.x,
        position.y - enemy.position.y,
      );
      const blocked =
        travelled < WARCHIEF.charge.speed * speedFactor(enemy) * dt * 0.5;
      const timer = next.timer - dt;
      if (blocked)
        next = { ...next, mode: "dazed", timer: WARCHIEF.charge.dazeSeconds };
      else if (timer <= 1e-9)
        next = {
          ...next,
          mode: "recover",
          timer: WARCHIEF.charge.recoverSeconds,
        };
      else next = { ...next, timer };
      break;
    }
    case "dazed":
    case "recover": {
      const timer = next.timer - dt;
      next =
        timer > 1e-9
          ? { ...next, timer }
          : next.mode === "dazed"
            ? {
                ...next,
                mode: "recover",
                timer: WARCHIEF.charge.recoverSeconds,
              }
            : { ...next, mode: "walk", timer: 0 };
      break;
    }
  }
  return result({ ...enemy, position, ai: next }, action);
}

/**
 * Where to walk to reach `to` (D-112, D-114): straight there when nothing
 * is in the way; otherwise along the server's grid path (through doorways,
 * round obstacles), or, without a grid, round the nearest corner.
 */
function route(
  from: Vec2,
  to: Vec2,
  half: number,
  walls: readonly Rect[],
  context: AiContext,
): Vec2 {
  if (!lineBlocked(from, to, half, walls)) return to;
  return (
    context.waypoint?.(from, to, half) ?? steerToward(from, to, half, walls)
  );
}

/** Whether a box of half-size `half` moving from `from` to `to` hits any rect. */
export function lineBlocked(
  from: Vec2,
  to: Vec2,
  half: number,
  walls: readonly Rect[],
): boolean {
  return walls.some((w) => segmentHitTime(from, to, half, w) !== null);
}

/**
 * Where to head to reach `to` (D-112): straight there if nothing is in
 * the way; otherwise the corner of the first thing in the way that makes
 * the shortest trip round it, just clear of it. Called every step, so the
 * enemy turns the next corner once the first is reached.
 */
export function steerToward(
  from: Vec2,
  to: Vec2,
  half: number,
  walls: readonly Rect[],
): Vec2 {
  let first: { t: number; rect: Rect } | null = null;
  for (const rect of walls) {
    const t = segmentHitTime(from, to, half, rect);
    if (t !== null && (first === null || t < first.t)) first = { t, rect };
  }
  if (!first) return to;
  const r = first.rect;
  const pad = half + STEER_CLEARANCE;
  const corners: Vec2[] = [
    { x: r.x - pad, y: r.y - pad },
    { x: r.x + r.width + pad, y: r.y - pad },
    { x: r.x - pad, y: r.y + r.height + pad },
    { x: r.x + r.width + pad, y: r.y + r.height + pad },
  ];
  const trip = (c: Vec2) =>
    Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y);
  // Corners reachable without crossing the obstacle itself, shortest trip first.
  const open = corners.filter(
    (c) =>
      Math.hypot(c.x - from.x, c.y - from.y) > 1 &&
      segmentHitTime(from, c, half, r) === null,
  );
  const pool = open.length > 0 ? open : corners;
  return pool.reduce((best, c) => (trip(c) < trip(best) ? c : best));
}

/** How far past an obstacle's corner an enemy aims, beyond its own size. */
const STEER_CLEARANCE = 6;

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
