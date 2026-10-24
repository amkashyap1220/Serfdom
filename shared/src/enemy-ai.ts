import { boxAround, segmentHitTime } from "./collision.ts";
import { NATURES_REACH } from "./abilities.ts";
import { ENEMY_RING_ATTACK, PLAYER_HEALTH } from "./combat-config.ts";
import {
  BOMBER,
  BRUTE as BRUTE_CONFIG,
  GRUNT,
  SHAMAN,
  SKULKER,
  WARCHIEF,
  SKELETON,
  ARCHER,
  GHOST,
  NECROMANCER,
  KNIGHT,
  LICH,
  IMP,
  CASTER,
  ELEMENTAL,
  GOLEM,
  BELLOWS,
  FORGEMASTER,
  ACOLYTE,
  CALLER,
  SPEARMAN,
  EELPRIEST,
  TIDEPRIEST,
  WRAITH,
  YETI,
  FROSTARCHER,
  ICEIMP,
  WYRM,
  SENTRY,
  DRONE,
  TURRET,
  AUTOMATON,
  WARDEN,
  RING_BULLET,
  SLINGER,
  WARLORD,
  type EnemyBulletSpec,
  type EnemyKind,
} from "./enemy-config.ts";
import { isAlive, ringDirections, type EnemyState, isPile } from "./enemy.ts";
import { rotateVec, type Rect, type Vec2 } from "./geometry.ts";
import { stepMovement } from "./movement.ts";
import { stepFireCooldown } from "./weapon.ts";
import { laneAt, slamGap } from "./forge-boss.ts";
import { surgeGaps } from "./temple-water.ts";

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
  /** Drawn as a rune filling in red (the Lich's, D-125), not a falling boulder. */
  rune?: boolean;
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
  /** A grave knight's slam (D-122), like the sweep: where, then the hit. */
  slam?: { at: Vec2; radius: number; warning: boolean };
  /** A necromancer raises this bone pile (an enemy id) as a full skeleton (D-122). */
  raise?: number;
  /** A bellows-keeper's pulse (D-132): heal enemies in the circle by `share` of their max HP. */
  stoke?: { at: Vec2; radius: number; share: number };
  /** A fire elemental exploding (D-132), for drawing. */
  explosion?: { at: Vec2; radius: number };
  /**
   * The Forgemaster's shockwave (D-134): a ring growing from `at` once
   * `startsIn` runs out, with a gap centred on `gap` (radians); it only
   * hits players inside `area` (its arena), if given.
   */
  wave?: { at: Vec2; gap: number; startsIn: number; area?: Rect };
  /** The Forgemaster's floor plates (D-134): all of `area` but the safe lane glows, then bursts. */
  plates?: { area: Rect; lane: number };
  /** An eel-priest's tether (D-135): pull this player towards `to` once `startsIn` runs out. */
  pull?: { playerId: number; to: Vec2; startsIn: number };
  /** The Tide Priest's whirlpools (D-135), starting after their warning. */
  whirlpools?: Vec2[];
  /** Rotating arms this enemy carries this tick (the Automaton's laser, D-137), pivoting on it. */
  blades?: {
    length: number;
    degreesPerSecond: number;
    phaseDegrees: number;
    damage: number;
  }[];
  /** Frost left on the floor (D-136): an ice wraith's trail, the Frost Wyrm's tail. */
  frost?: { at: Vec2; radius: number; seconds: number }[];
  /** The Frost Wyrm's breath (D-136): a cone that lands after `startsIn`. */
  cone?: {
    at: Vec2;
    angle: number;
    range: number;
    halfAngle: number;
    startsIn: number;
    damage: number;
    frost?: { radius: number; seconds: number };
    /** Its arena: players outside are not hit (no breathing through walls). */
    area?: Rect;
  };
  /** The Tide Priest's tidal surge (D-135) across `area`. */
  surge?: {
    area: Rect;
    axis: "x" | "y";
    dir: 1 | -1;
    gaps: { from: number; to: number }[];
  };
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
  /** A room's floor (the Forgemaster's plates and shockwaves keep to its arena, D-134). */
  boundsOf?: (roomId: string) => Rect | undefined;
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
    case "skeleton":
      return skeletonAct(enemy, target, walls, dtSeconds, result, context);
    case "ghost":
      return ghostAct(enemy, target, dtSeconds, result);
    case "lich":
      return lichAct(enemy, targets, target, dtSeconds, result, context);
    case "crystal":
      return result(enemy);
    case "necromancer":
      return necromancerAct(enemy, target, walls, dtSeconds, result, context);
    case "knight":
    case "sentry":
      return knightAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "archer":
      return slingerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        ARCHER,
      );
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
    case "imp":
      return skulkerAct(enemy, target, walls, dtSeconds, result, context, IMP);
    case "elemental":
      return elementalAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "golem":
      return golemAct(enemy, target, walls, dtSeconds, result, context);
    case "drone":
      return skulkerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        DRONE,
      );
    case "turret":
      return slingerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        TURRET,
      );
    case "warden":
      return wardenAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "automaton":
      return automatonAct(enemy, target, walls, dtSeconds, result, context);
    case "wraith":
      return wraithAct(enemy, target, walls, dtSeconds, result, context);
    case "yeti":
      return gruntAct(enemy, target, walls, dtSeconds, result, context, YETI);
    case "frostarcher":
      return slingerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        FROSTARCHER,
      );
    case "iceimp":
      return skulkerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        ICEIMP,
      );
    case "wyrm":
      return wyrmAct(enemy, targets, target, walls, dtSeconds, result, context);
    case "acolyte":
      return gruntAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        ACOLYTE,
      );
    case "caller":
      return slingerAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        CALLER,
      );
    case "spearman":
      return bruteAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
        SPEARMAN,
      );
    case "eelpriest":
      return eelpriestAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "tidepriest":
      return tidepriestAct(enemy, target, walls, dtSeconds, result, context);
    case "forgemaster":
      return forgemasterAct(
        enemy,
        targets,
        target,
        walls,
        dtSeconds,
        result,
        context,
      );
    case "bellows":
      return shamanAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        BELLOWS_SUPPORT,
      );
    case "caster":
      return bomberAct(
        enemy,
        target,
        walls,
        dtSeconds,
        result,
        context,
        CASTER,
      );
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

/** A melee walker's numbers: grunts, and skeletons (D-120). */
interface MeleeSpec {
  speed: number;
  contactDamage: number;
  contactCooldownSeconds: number;
}

/**
 * Skeleton (D-120): a grunt while standing. As a bone pile it lies still
 * until its timer runs out, then stands up at half HP, once.
 */
function skeletonAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "skeleton") return result(enemy);
  if (ai.pile !== null) {
    const pile = ai.pile - dt;
    if (pile > 1e-9) return result({ ...enemy, ai: { ...ai, pile } });
    return result({
      ...enemy,
      hp: Math.round(enemy.maxHp * SKELETON.reviveShare),
      // A moment to stand before it can hit.
      attackCooldown: SKELETON.contactCooldownSeconds / 2,
      ai: { kind: "skeleton", pile: null, revived: true },
    });
  }
  return gruntAct(enemy, target, walls, dt, result, context, SKELETON);
}

function gruntAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext = NO_CONTEXT,
  spec: MeleeSpec = GRUNT,
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
    spec.speed,
    walls,
    dt,
  );
  const hits =
    touching(position, enemy.size, target.target.position) && cooldown <= 1e-9;
  return result(
    {
      ...enemy,
      position,
      attackCooldown: hits ? spec.contactCooldownSeconds : cooldown,
    },
    {
      contacts: hits
        ? [{ playerId: target.target.id, damage: spec.contactDamage }]
        : [],
    },
  );
}

/** A thrower's numbers: slingers, and skeleton archers (D-120). */
interface ThrowerSpec {
  speed: number;
  minRange: number;
  maxRange: number;
  throwRange: number;
  throwIntervalSeconds: number;
  rock: EnemyBulletSpec;
  /** Shots per throw, `spreadDegrees` apart (1 if absent). */
  volley?: number;
  spreadDegrees?: number;
  /** Leads every shot, whatever the dungeon's lead share. */
  alwaysLeads?: boolean;
}

function slingerAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext = NO_CONTEXT,
  spec: ThrowerSpec = SLINGER,
): EnemyAction {
  const leads = enemy.leads || spec.alwaysLeads === true;
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
    spec.rock.speed,
    leads,
  );
  // No throwing into cover (D-112): step sideways until the line is clear.
  const blocked = lineBlocked(
    enemy.position,
    throwAt,
    spec.rock.size / 2,
    walls,
  );
  let direction = NO_MOVE;
  if (blocked) {
    const ahead = toward(enemy.position, at);
    const side = enemy.id % 2 === 0 ? 1 : -1;
    direction = { x: -ahead.y * side, y: ahead.x * side };
  } else if (target.distance < spec.minRange)
    direction = toward(at, enemy.position);
  else if (target.distance > spec.maxRange)
    direction = toward(
      enemy.position,
      route(enemy.position, at, enemy.size / 2, walls, context),
    );
  const position = move(enemy, direction, spec.speed, walls, dt);

  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    !blocked && target.distance <= spec.throwRange,
    1 / spec.throwIntervalSeconds,
  );
  const aim = toward(
    position,
    throwPoint(position, target.target, spec.rock.speed, leads),
  );
  const volley = spec.volley ?? 1;
  const step = ((spec.spreadDegrees ?? 0) * Math.PI) / 180;
  return result(
    { ...enemy, position, attackCooldown: attack.remaining },
    {
      bullets:
        attack.fired && (aim.x !== 0 || aim.y !== 0)
          ? Array.from({ length: volley }, (_, i) => ({
              direction: rotateVec(aim, (i - (volley - 1) / 2) * step),
              spec: spec.rock,
            }))
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

/** A flanker's numbers: skulkers, and forge imps (D-130). */
interface FlankerSpec {
  speed: number;
  leadSeconds: number;
  lungeRange: number;
  contactDamage: number;
  contactCooldownSeconds: number;
}

function skulkerAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
  spec: FlankerSpec = SKULKER,
): EnemyAction {
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  if (!target) return result({ ...enemy, attackCooldown: cooldown });
  // Cut you off: run to where you are heading, then lunge (D-115).
  const goal =
    target.distance > spec.lungeRange
      ? ahead(target.target, spec.leadSeconds)
      : target.target.position;
  const position = move(
    enemy,
    toward(
      enemy.position,
      route(enemy.position, goal, enemy.size / 2, walls, context),
    ),
    spec.speed,
    walls,
    dt,
  );
  const hits =
    touching(position, enemy.size, target.target.position) && cooldown <= 1e-9;
  return result(
    {
      ...enemy,
      position,
      attackCooldown: hits ? spec.contactCooldownSeconds : cooldown,
    },
    {
      contacts: hits
        ? [{ playerId: target.target.id, damage: spec.contactDamage }]
        : [],
    },
  );
}

/** A lobber's numbers: bombers, and ember casters (D-130). */
interface LobberSpec {
  speed: number;
  minRange: number;
  maxRange: number;
  throwRange: number;
  throwIntervalSeconds: number;
  leadSeconds: number;
  flightSeconds: number;
  radius: number;
  damage: number;
  fire: { seconds: number; tickSeconds: number; damage: number };
}

function bomberAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
  spec: LobberSpec = BOMBER,
): EnemyAction {
  if (!target) {
    return result({
      ...enemy,
      attackCooldown: Math.max(0, enemy.attackCooldown - dt),
    });
  }
  const at = target.target.position;
  let direction = NO_MOVE;
  if (target.distance < spec.minRange) direction = toward(at, enemy.position);
  else if (target.distance > spec.maxRange)
    direction = toward(
      enemy.position,
      route(enemy.position, at, enemy.size / 2, walls, context),
    );
  const position = move(enemy, direction, spec.speed, walls, dt);
  const attack = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    target.distance <= spec.throwRange,
    1 / spec.throwIntervalSeconds,
  );
  // Lobbed over everything: lands where you will be (D-115).
  return result(
    { ...enemy, position, attackCooldown: attack.remaining },
    {
      hazards: attack.fired
        ? [
            {
              at: ahead(target.target, spec.leadSeconds),
              radius: spec.radius,
              damage: spec.damage,
              delaySeconds: spec.flightSeconds,
              fire: spec.fire,
            },
          ]
        : [],
    },
  );
}

/** A support's numbers and effect: shamans chant (D-115), bellows-keepers heal (D-132). */
interface SupportSpec {
  speed: number;
  seekRange: number;
  keepAway: number;
  intervalSeconds: number;
  radius: number;
  effect: "chant" | "heal";
}

const SHAMAN_SUPPORT: SupportSpec = {
  speed: SHAMAN.speed,
  seekRange: SHAMAN.seekRange,
  keepAway: SHAMAN.keepAway,
  intervalSeconds: SHAMAN.chantIntervalSeconds,
  radius: SHAMAN.chantRadius,
  effect: "chant",
};

const BELLOWS_SUPPORT: SupportSpec = {
  speed: BELLOWS.speed,
  seekRange: BELLOWS.seekRange,
  keepAway: BELLOWS.keepAway,
  intervalSeconds: BELLOWS.pulseSeconds,
  radius: BELLOWS.radius,
  effect: "heal",
};

function shamanAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
  spec: SupportSpec = SHAMAN_SUPPORT,
): EnemyAction {
  const near = (context.allies?.() ?? []).filter(
    (e) =>
      e.id !== enemy.id &&
      e.kind !== enemy.kind &&
      isAlive(e) &&
      Math.hypot(
        e.position.x - enemy.position.x,
        e.position.y - enemy.position.y,
      ) <= spec.seekRange,
  );
  // Keep away from players; otherwise go to the thick of its allies.
  let direction = NO_MOVE;
  if (target && target.distance < spec.keepAway) {
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
  const position = move(enemy, direction, spec.speed, walls, dt);
  const inReach = near.some(
    (e) =>
      Math.hypot(e.position.x - position.x, e.position.y - position.y) <=
      spec.radius,
  );
  const pulse = stepFireCooldown(
    enemy.attackCooldown,
    dt,
    inReach,
    1 / spec.intervalSeconds,
  );
  const at = { ...position };
  return result(
    { ...enemy, position, attackCooldown: pulse.remaining },
    !pulse.fired
      ? {}
      : spec.effect === "chant"
        ? { chant: { at, radius: spec.radius } }
        : {
            stoke: {
              at,
              radius: spec.radius,
              share: BELLOWS.healShare * spec.intervalSeconds,
            },
          },
  );
}

/**
 * Fire elemental (D-132): rushes the nearest player; close enough, it
 * stops and flares, then explodes on everyone in reach and is gone.
 */
function elementalAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "elemental") return result(enemy);
  if (ai.fuse !== null) {
    const fuse = ai.fuse - dt;
    if (fuse > 1e-9)
      return result({ ...enemy, ai: { kind: "elemental", fuse } });
    const at = { ...enemy.position };
    const contacts = targets
      .filter((t) => circleHitsPlayer(at, ELEMENTAL.radius, t.position))
      .map((t) => ({ playerId: t.id, damage: ELEMENTAL.damage }));
    // Gone in its own blast.
    return result(
      {
        ...enemy,
        hp: 0,
        respawnIn: enemy.respawnSeconds ?? 0,
        ai: { kind: "elemental", fuse: null },
      },
      { contacts, explosion: { at, radius: ELEMENTAL.radius } },
    );
  }
  if (!target) return result(enemy);
  if (target.distance <= ELEMENTAL.triggerRange) {
    return result({
      ...enemy,
      ai: { kind: "elemental", fuse: ELEMENTAL.fuseSeconds },
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
    ELEMENTAL.speed,
    walls,
    dt,
  );
  return result({ ...enemy, position });
}

/** One volley of a spiral (the Lich's, D-125; the Warden's, D-138): a bullet per arm, evenly round from `spin`. */
export function spiralVolley(
  spin: number,
  arms: number,
  spec: EnemyBulletSpec,
): { direction: Vec2; spec: EnemyBulletSpec }[] {
  return Array.from({ length: arms }, (_, arm) => {
    const a = spin + (arm * 2 * Math.PI) / arms;
    return { direction: { x: Math.cos(a), y: Math.sin(a) }, spec };
  });
}

/**
 * The Warden of the Abyss (D-138): the Lich's spiral all fight long (not
 * while dazed); below 66% it walks and charges like the Warchief (a wall
 * dazes it); below 33% it also slams like the Forgemaster, sending a
 * shockwave ring with a gap.
 */
function wardenAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "warden") return result(enemy);
  const W = WARDEN;
  const fraction = enemy.hp / enemy.maxHp;
  const two = fraction < W.phaseTwoBelow;
  const three = fraction < W.phaseThreeBelow;
  const tick = (t: number) => Math.max(0, t - dt);
  let next = {
    ...ai,
    shot: tick(ai.shot),
    charge: two ? tick(ai.charge) : ai.charge,
    slam: three ? tick(ai.slam) : ai.slam,
    spin: ai.spin + ((W.spiral.degreesPerSecond * Math.PI) / 180) * dt,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  const area = enemy.roomId ? context.boundsOf?.(enemy.roomId) : undefined;
  let position = enemy.position;
  if (!target) return result({ ...enemy, ai: next }, action);
  if (next.mode !== "dazed" && next.shot <= 1e-9) {
    next.shot = W.spiral.intervalSeconds;
    action.bullets.push(
      ...spiralVolley(next.spin, W.spiral.arms, W.spiral.bullet),
    );
  }
  if (three && next.slam <= 1e-9 && next.mode !== "dazed") {
    next.slam = W.slam.intervalSeconds;
    action.wave = {
      at: { ...enemy.position },
      gap: slamGap(enemy.id, next.slams),
      startsIn: FORGEMASTER.slam.windupSeconds,
      ...(area ? { area } : {}),
    };
    action.slam = {
      at: { ...enemy.position },
      radius: FORGEMASTER.slam.radius,
      warning: true,
    };
    next.slams += 1;
  }
  switch (next.mode) {
    case "walk": {
      if (!two) break;
      if (next.charge <= 1e-9 && target.distance <= W.charge.triggerRange) {
        next = { ...next, mode: "windup", timer: W.charge.windupSeconds };
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
        W.speed,
        walls,
        dt,
      );
      break;
    }
    case "windup": {
      const timer = next.timer - dt;
      if (timer > 1e-9) {
        next = { ...next, timer };
        break;
      }
      next = {
        ...next,
        mode: "charge",
        timer: W.charge.seconds,
        direction: toward(enemy.position, target.target.position),
        hit: [],
        charge: W.charge.intervalSeconds,
      };
      break;
    }
    case "charge": {
      position = move(enemy, next.direction, W.charge.speed, walls, dt);
      for (const t of targets) {
        if (
          !next.hit.includes(t.id) &&
          touching(position, enemy.size, t.position)
        ) {
          action.contacts.push({ playerId: t.id, damage: W.charge.damage });
          next = { ...next, hit: [...next.hit, t.id] };
        }
      }
      const travelled = Math.hypot(
        position.x - enemy.position.x,
        position.y - enemy.position.y,
      );
      const blocked =
        travelled < W.charge.speed * speedFactor(enemy) * dt * 0.5;
      const timer = next.timer - dt;
      if (blocked)
        next = { ...next, mode: "dazed", timer: W.charge.dazeSeconds };
      else if (timer <= 1e-9)
        next = { ...next, mode: "recover", timer: W.charge.recoverSeconds };
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
            ? { ...next, mode: "recover", timer: W.charge.recoverSeconds }
            : { ...next, mode: "walk", timer: 0 };
      break;
    }
  }
  return result({ ...enemy, position, ai: next }, action);
}

/**
 * The Automaton (D-137): walks after the nearest player, stopping short;
 * rifle bursts and a turning laser arm (two when enraged); cog drones below
 * half HP. Every few seconds it overheats: it stops, glows, and takes
 * double damage instead of a quarter.
 */
function automatonAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "automaton") return result(enemy);
  const A = AUTOMATON;
  const fraction = enemy.hp / enemy.maxHp;
  const droning = fraction < A.dronesBelow;
  const enraged = fraction < A.enragedBelow;
  const tick = (t: number) => Math.max(0, t - dt);
  let vent = ai.vent - dt;
  let venting = Math.max(0, ai.venting - dt);
  if (vent <= 1e-9) {
    vent += enraged ? A.enragedVentEverySeconds : A.ventEverySeconds;
    venting = A.ventSeconds;
  }
  const next = {
    ...ai,
    vent,
    venting,
    rifle: tick(ai.rifle),
    drones: droning ? tick(ai.drones) : ai.drones,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  let position = enemy.position;
  // Overheated: it stands, glowing, and does nothing else.
  if (venting > 0 || !target) {
    return result({ ...enemy, ai: next }, action);
  }
  action.blades = [
    {
      length: A.laser.length,
      degreesPerSecond: A.laser.degreesPerSecond,
      phaseDegrees: 0,
      damage: A.laser.damage,
    },
    ...(enraged
      ? [
          {
            length: A.laser.length,
            degreesPerSecond: A.laser.degreesPerSecond,
            phaseDegrees: 180,
            damage: A.laser.damage,
          },
        ]
      : []),
  ];
  if (next.rifle <= 1e-9) {
    next.rifle = A.rifle.intervalSeconds;
    const aim = toward(enemy.position, target.target.position);
    const step = (A.rifle.angleStepDegrees * Math.PI) / 180;
    const half = (A.rifle.count - 1) / 2;
    for (let i = 0; i < A.rifle.count; i++) {
      action.bullets.push({
        direction: rotateVec(aim, (i - half) * step),
        spec: A.rifle.bullet,
      });
    }
  }
  if (droning && next.drones <= 1e-9) {
    next.drones = A.drones.intervalSeconds;
    const room = A.drones.maxAlive - context.aliveSummons(enemy.id);
    const n = Math.min(A.drones.count, Math.max(0, room));
    for (let i = 0; i < n; i++) {
      action.summons.push({
        kind: A.drones.kind,
        at: {
          x: enemy.position.x + (i % 2 ? 80 : -80),
          y: enemy.position.y - 60,
        },
      });
    }
    next.called += n;
  }
  if (target.distance > A.keep) {
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
      A.speed,
      walls,
      dt,
    );
  }
  return result({ ...enemy, position, ai: next }, action);
}

/** Ice wraith (D-136): a grunt's walk that leaves frost behind it every few seconds. */
function wraithAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "wraith") return result(enemy);
  const walked = gruntAct(enemy, target, walls, dt, result, context, WRAITH);
  let trail = ai.trail - dt;
  const frost: EnemyAction["frost"] = [];
  if (trail <= 1e-9) {
    trail += WRAITH.trail.everySeconds;
    frost.push({
      at: { ...walked.enemy.position },
      radius: WRAITH.trail.radius,
      seconds: WRAITH.trail.seconds,
    });
  }
  return {
    ...walked,
    ...(frost.length > 0 ? { frost } : {}),
    enemy: { ...walked.enemy, ai: { kind: "wraith", trail } },
  };
}

/**
 * The Frost Wyrm (D-136): walks after the nearest player, stopping short;
 * breathes a cone of frost (it holds still while the cone warns); sweeps
 * its tail round itself when a player comes close, leaving frost; calls ice
 * wraiths below half HP; enraged, breathes more often.
 */
function wyrmAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "wyrm") return result(enemy);
  const W = WYRM;
  const fraction = enemy.hp / enemy.maxHp;
  const summoning = fraction < W.summonBelow;
  const enraged = fraction < W.enragedBelow;
  const tick = (t: number) => Math.max(0, t - dt);
  let next = {
    ...ai,
    breath: tick(ai.breath),
    tail: tick(ai.tail),
    summon: summoning ? tick(ai.summon) : ai.summon,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  const area = enemy.roomId ? context.boundsOf?.(enemy.roomId) : undefined;
  let position = enemy.position;
  if (target && summoning && next.summon <= 1e-9) {
    next.summon = W.summon.intervalSeconds;
    const room = W.summon.maxAlive - context.aliveSummons(enemy.id);
    const n = Math.min(W.summon.count, Math.max(0, room));
    for (let i = 0; i < n; i++) {
      action.summons.push({
        kind: W.summon.kind,
        at: {
          x: enemy.position.x + (i % 2 ? 90 : -90),
          y: enemy.position.y + 60,
        },
      });
    }
    next.called += n;
  }
  if (next.mode === "walk" && target) {
    if (next.tail <= 1e-9 && target.distance <= W.tail.triggerRange) {
      next = { ...next, mode: "tail", timer: W.tail.windupSeconds };
      action.slam = {
        at: { ...enemy.position },
        radius: W.tail.radius,
        warning: true,
      };
    } else if (next.breath <= 1e-9) {
      const aim = toward(enemy.position, target.target.position);
      next = {
        ...next,
        mode: "breath",
        timer: W.breath.warnSeconds,
        breath: enraged
          ? W.breath.enragedIntervalSeconds
          : W.breath.intervalSeconds,
      };
      action.cone = {
        at: { ...enemy.position },
        angle: Math.atan2(aim.y, aim.x),
        range: W.breath.range,
        halfAngle: (W.breath.halfAngleDegrees * Math.PI) / 180,
        startsIn: W.breath.warnSeconds,
        damage: W.breath.damage,
        frost: { radius: W.breath.frostRadius, seconds: W.breath.frostSeconds },
        ...(area ? { area } : {}),
      };
    } else if (target.distance > W.keep) {
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
        W.speed,
        walls,
        dt,
      );
    }
  } else if (next.mode !== "walk") {
    const timer = next.timer - dt;
    if (timer > 1e-9) {
      next = { ...next, timer };
    } else if (next.mode === "tail") {
      const at = { ...enemy.position };
      for (const t of targets) {
        if (circleHitsPlayer(at, W.tail.radius, t.position)) {
          action.contacts.push({ playerId: t.id, damage: W.tail.damage });
        }
      }
      action.slam = { at, radius: W.tail.radius, warning: false };
      action.frost = [
        { at, radius: W.tail.radius, seconds: W.tail.frostSeconds },
      ];
      next = { ...next, mode: "walk", timer: 0, tail: W.tail.intervalSeconds };
    } else {
      next = { ...next, mode: "walk", timer: 0 };
    }
  }
  return result({ ...enemy, position, ai: next }, action);
}

/** An eel-priest's movement: a slinger's that never throws (D-135). */
const EEL_MOVES: ThrowerSpec = {
  speed: EELPRIEST.speed,
  minRange: EELPRIEST.minRange,
  maxRange: EELPRIEST.maxRange,
  throwRange: 0,
  throwIntervalSeconds: 1,
  rock: { damage: 0, speed: 1, size: 8, range: 0 },
};

/**
 * Eel-priest (D-135): moves like a slinger; tethers the nearest player in
 * clear sight within range, and when the warning ends hits them and the
 * pull begins (the simulation moves them; killing it first breaks it).
 */
function eelpriestAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "eelpriest") return result(enemy);
  const moved = slingerAct(
    enemy,
    target,
    walls,
    dt,
    result,
    context,
    EEL_MOVES,
  );
  const P = EELPRIEST.pull;
  let next = { ...ai, pull: Math.max(0, ai.pull - dt) };
  const action: Partial<EnemyAction> = {};
  if (next.tethered !== null) {
    const strikeIn = next.strikeIn - dt;
    if (strikeIn > 1e-9) {
      next = { ...next, strikeIn };
    } else {
      const victim = targets.find((t) => t.id === next.tethered);
      if (victim) action.contacts = [{ playerId: victim.id, damage: P.damage }];
      next = { ...next, tethered: null, strikeIn: 0 };
    }
  } else if (
    target &&
    next.pull <= 1e-9 &&
    target.distance <= P.range &&
    !lineBlocked(enemy.position, target.target.position, 4, walls)
  ) {
    next = {
      ...next,
      pull: P.intervalSeconds,
      tethered: target.target.id,
      strikeIn: P.warnSeconds,
    };
    action.pull = {
      playerId: target.target.id,
      to: { ...moved.enemy.position },
      startsIn: P.warnSeconds,
    };
  }
  return {
    ...moved,
    ...action,
    contacts: [...moved.contacts, ...(action.contacts ?? [])],
    enemy: { ...moved.enemy, ai: next },
  };
}

/**
 * The Tide Priest (D-135): drifts towards the nearest player (stopping at
 * a distance); fans of water bolts; tidal surges across its arena with
 * moving gaps; below half HP whirlpools (one where its target stands);
 * enraged, surges come faster and turn between the two axes.
 */
function tidepriestAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "tidepriest") return result(enemy);
  const T = TIDEPRIEST;
  const fraction = enemy.hp / enemy.maxHp;
  const whirlPhase = fraction < T.whirlBelow;
  const enraged = fraction < T.enragedBelow;
  const tick = (t: number) => Math.max(0, t - dt);
  const next = {
    ...ai,
    surge: tick(ai.surge),
    bolts: tick(ai.bolts),
    whirls: whirlPhase ? tick(ai.whirls) : ai.whirls,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  const area = enemy.roomId ? context.boundsOf?.(enemy.roomId) : undefined;
  let position = enemy.position;
  if (target) {
    if (next.bolts <= 1e-9) {
      next.bolts = T.bolts.intervalSeconds;
      const aim = toward(enemy.position, target.target.position);
      const step = (T.bolts.angleStepDegrees * Math.PI) / 180;
      const half = (T.bolts.count - 1) / 2;
      for (let i = 0; i < T.bolts.count; i++) {
        action.bullets.push({
          direction: rotateVec(aim, (i - half) * step),
          spec: T.bolts.bullet,
        });
      }
    }
    if (area && next.surge <= 1e-9) {
      next.surge = enraged
        ? T.surge.enragedIntervalSeconds
        : T.surge.intervalSeconds;
      // West to east, then back; enraged, it turns to sweep north–south too.
      const axis: "x" | "y" = enraged && next.surges % 2 === 1 ? "y" : "x";
      const dir: 1 | -1 =
        Math.floor(next.surges / (enraged ? 2 : 1)) % 2 === 0 ? 1 : -1;
      const lo = axis === "x" ? area.y : area.x;
      const hi = axis === "x" ? area.y + area.height : area.x + area.width;
      action.surge = { area, axis, dir, gaps: surgeGaps(lo, hi, next.surges) };
      next.surges += 1;
    }
    if (whirlPhase && next.whirls <= 1e-9) {
      next.whirls = T.whirlpools.intervalSeconds;
      const at = target.target.position;
      // The second on the far side of the priest from the first.
      const other = {
        x: enemy.position.x - (at.x - enemy.position.x) * 0.8,
        y: enemy.position.y - (at.y - enemy.position.y) * 0.8,
      };
      const clamp = (p: Vec2): Vec2 =>
        area
          ? {
              x: Math.min(area.x + area.width - 40, Math.max(area.x + 40, p.x)),
              y: Math.min(
                area.y + area.height - 40,
                Math.max(area.y + 40, p.y),
              ),
            }
          : p;
      action.whirlpools = [clamp({ ...at }), clamp(other)].slice(
        0,
        T.whirlpools.count,
      );
      next.rounds += 1;
    }
    if (target.distance > T.keep) {
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
        T.speed,
        walls,
        dt,
      );
    }
  }
  return result({ ...enemy, position, ai: next }, action);
}

/** Where the Forgemaster's hammer lands, facing `direction` (D-134). */
export function hammerSpot(position: Vec2, direction: Vec2): Vec2 {
  return {
    x: position.x + direction.x * FORGEMASTER.slam.reach,
    y: position.y + direction.y * FORGEMASTER.slam.reach,
  };
}

/**
 * The Forgemaster (D-134): walks after the nearest player; slams (a
 * windup, the hit, and a shockwave whose gap shows from the windup on);
 * aimed molten spreads; golems below 60%; plates and faster slams below 30%.
 */
function forgemasterAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "forgemaster") return result(enemy);
  const F = FORGEMASTER;
  const fraction = enemy.hp / enemy.maxHp;
  const golemPhase = fraction < F.golemsBelow;
  const enraged = fraction < F.enragedBelow;
  const tick = (t: number) => Math.max(0, t - dt);
  let next = {
    ...ai,
    slam: tick(ai.slam),
    spread: tick(ai.spread),
    golems: golemPhase ? tick(ai.golems) : ai.golems,
    plates: enraged ? tick(ai.plates) : ai.plates,
  };
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  const area = enemy.roomId ? context.boundsOf?.(enemy.roomId) : undefined;
  let position = enemy.position;

  if (target) {
    if (next.spread <= 1e-9) {
      next.spread = F.spread.intervalSeconds;
      const aim = toward(enemy.position, target.target.position);
      const step = (F.spread.angleStepDegrees * Math.PI) / 180;
      const half = (F.spread.count - 1) / 2;
      for (let i = 0; i < F.spread.count; i++) {
        action.bullets.push({
          direction: rotateVec(aim, (i - half) * step),
          spec: F.spread.bullet,
        });
      }
    }
    if (golemPhase && next.golems <= 1e-9) {
      next.golems = F.golems.intervalSeconds;
      const room = F.golems.maxAlive - context.aliveSummons(enemy.id);
      const n = Math.min(F.golems.count, Math.max(0, room));
      const doors = enemy.roomId ? (context.holesOf?.(enemy.roomId) ?? []) : [];
      for (let i = 0; i < n; i++) {
        const door = doors[(next.called + i) % Math.max(1, doors.length)];
        action.summons.push({
          kind: F.golems.kind,
          at: door
            ? { ...door }
            : { x: enemy.position.x + (i % 2 ? 90 : -90), y: enemy.position.y },
        });
      }
      next.called += n;
    }
    if (enraged && next.plates <= 1e-9 && area) {
      next.plates = F.plates.intervalSeconds;
      action.plates = { area, lane: laneAt(area, next.plateSteps) };
      next.plateSteps += 1;
    }
  }

  if (next.mode === "walk") {
    if (target && next.slam <= 1e-9) {
      // The hammer goes up: where it will land, and the gap its
      // shockwave will have, show from now on.
      const direction = toward(enemy.position, target.target.position);
      const at = hammerSpot(enemy.position, direction);
      // Slams are every 5 s (3.5 s enraged) from hammer-up to hammer-up.
      next = {
        ...next,
        mode: "windup",
        timer: F.slam.windupSeconds,
        direction,
        slam: enraged ? F.slam.enragedIntervalSeconds : F.slam.intervalSeconds,
      };
      action.slam = { at, radius: F.slam.radius, warning: true };
      action.wave = {
        at,
        gap: slamGap(enemy.id, next.slams),
        startsIn: F.slam.windupSeconds,
        ...(area ? { area } : {}),
      };
    } else if (target) {
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
        F.speed,
        walls,
        dt,
      );
    }
  } else {
    const timer = next.timer - dt;
    if (timer > 1e-9) {
      next = { ...next, timer };
    } else {
      const at = hammerSpot(enemy.position, next.direction);
      for (const t of targets) {
        if (circleHitsPlayer(at, F.slam.radius, t.position)) {
          action.contacts.push({ playerId: t.id, damage: F.slam.damage });
        }
      }
      action.slam = { at, radius: F.slam.radius, warning: false };
      next = {
        ...next,
        mode: "walk",
        timer: 0,
        slams: next.slams + 1,
      };
    }
  }
  return result({ ...enemy, position, ai: next }, action);
}

/** Magma golem (D-132): a slow walker that vents on a cycle. */
function golemAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "golem") return result(enemy);
  // The cycle runs all the time: it vents every 6 s, for 1.5 s of them.
  let vent = ai.vent - dt;
  let venting = Math.max(0, ai.venting - dt);
  if (vent <= 1e-9) {
    vent += GOLEM.ventEverySeconds;
    venting = GOLEM.ventSeconds;
  }
  const walked = gruntAct(enemy, target, walls, dt, result, context, GOLEM);
  return {
    ...walked,
    enemy: { ...walked.enemy, ai: { kind: "golem", vent, venting } },
  };
}

/** A charger's numbers: the brute's (6c, D-111, D-112), or the spearman's (D-135). */
interface ChargerSpec {
  speed: number;
  chargeTriggerRange: number;
  windupSeconds: number;
  chargeSpeed: number;
  chargeSeconds: number;
  recoverSeconds: number;
  chargeDamage: number;
  dazeSeconds: number;
}

function bruteAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext = NO_CONTEXT,
  BRUTE: ChargerSpec = BRUTE_CONFIG,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "brute" && ai.kind !== "spearman") return result(enemy);
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
/** Where the Lich's soul crystals stand (D-125): evenly round it, the first straight up. */
export function crystalSpots(at: Vec2): Vec2[] {
  return Array.from({ length: LICH.ward.crystals }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / LICH.ward.crystals;
    return {
      x: at.x + Math.cos(a) * LICH.ward.crystalDistance,
      y: at.y + Math.sin(a) * LICH.ward.crystalDistance,
    };
  });
}

/**
 * The Lich (D-125). It never moves. Spiral mode fires its spiral and calls
 * skeletons from the room's holes; crossing 60% (then 30%) of its HP it is
 * warded while its 3 crystals stand, firing rings; once they are broken it
 * is stunned, then back to the spiral (faster, with runes, after the
 * second ward).
 */
function lichAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "lich") return result(enemy);
  const action: Omit<EnemyAction, "enemy"> = {
    bullets: [],
    contacts: [],
    summons: [],
    hazards: [],
  };
  let next = { ...ai, timer: ai.timer + dt, firing: false };
  if (target) {
    const to = target.target.position;
    next.look = Math.atan2(to.y - enemy.position.y, to.x - enemy.position.x);
  }
  const mine = (kind: string) =>
    (context.allies?.() ?? []).filter(
      (e) => e.summonerId === enemy.id && e.kind === kind && isAlive(e),
    ).length;
  const share = enemy.hp / enemy.maxHp;

  if (next.mode === "warded") {
    // Its crystals appear on the step after it calls them: wait a moment.
    if (next.timer > 0.2 && mine("crystal") === 0) {
      next = { ...next, mode: "stunned", timer: 0 };
    } else {
      next.ring = Math.max(0, next.ring - dt);
      // A quick full turn with each ring (D-129).
      const { ringIntervalSeconds, ringSpinSeconds } = LICH.ward;
      if (ringIntervalSeconds - next.ring < ringSpinSeconds - 1e-9) {
        next.firing = true;
        next.spin += ((2 * Math.PI) / ringSpinSeconds) * dt;
      }
      if (target && next.ring <= 1e-9) {
        next.ring = LICH.ward.ringIntervalSeconds;
        const offset =
          next.ringTurn % 2 === 1 ? Math.PI / LICH.ward.ringBullets : 0;
        next.ringTurn += 1;
        for (const d of ringDirections(LICH.ward.ringBullets)) {
          action.bullets.push({
            direction: rotateVec(d, offset),
            spec: LICH.ward.bullet,
          });
        }
      }
    }
    return result({ ...enemy, ai: next }, action);
  }
  if (next.mode === "stunned") {
    if (next.timer >= LICH.stunSeconds - 1e-9) {
      next = { ...next, mode: "spiral", timer: 0, shot: 0 };
    }
    return result({ ...enemy, ai: next }, action);
  }

  // Crossing a ward line: crystals up, no more spiral until they break.
  const due = LICH.wardBelow[next.wards];
  if (due !== undefined && share < due) {
    for (const at of crystalSpots(enemy.position)) {
      action.summons.push({ kind: "crystal", at });
    }
    next = {
      ...next,
      mode: "warded",
      timer: 0,
      wards: next.wards + 1,
      ring: 0,
    };
    return result({ ...enemy, ai: next }, action);
  }
  if (!target) return result({ ...enemy, ai: next }, action);

  const final = next.wards >= LICH.wardBelow.length;
  const spiral = final ? LICH.finalSpiral : LICH.spiral;
  next.spin += ((spiral.degreesPerSecond * Math.PI) / 180) * dt;
  next.shot = Math.max(0, next.shot - dt);
  // It spins with its spiral once the spiral has started (D-129).
  next.firing = ai.firing || next.shot <= 1e-9;
  if (next.shot <= 1e-9) {
    next.shot = spiral.intervalSeconds;
    action.bullets.push(
      ...spiralVolley(next.spin, LICH.spiral.arms, LICH.spiral.bullet),
    );
  }
  // Skeletons out of the sarcophagi, two at a time, at most four alive.
  next.rise = Math.max(0, next.rise - dt);
  if (next.rise <= 1e-9) {
    next.rise = LICH.rise.intervalSeconds;
    const holes = enemy.roomId ? (context.holesOf?.(enemy.roomId) ?? []) : [];
    const room = LICH.rise.maxAlive - mine(LICH.rise.kind);
    const n = Math.min(LICH.rise.count, Math.max(0, room));
    for (let i = 0; i < n; i++) {
      const hole = holes[(next.ringTurn + i) % Math.max(1, holes.length)];
      action.summons.push({
        kind: LICH.rise.kind,
        at: hole
          ? { ...hole }
          : { x: enemy.position.x + (i % 2 ? 80 : -80), y: enemy.position.y },
      });
    }
    next.ringTurn += n;
  }
  // Final phase: runes under every player and round the Lich.
  if (final) {
    next.runes = Math.max(0, next.runes - dt);
    if (next.runes <= 1e-9) {
      next.runes = LICH.runes.intervalSeconds;
      const rune = (at: Vec2) =>
        action.hazards.push({
          at,
          radius: LICH.runes.radius,
          damage: LICH.runes.damage,
          delaySeconds: LICH.runes.warnSeconds,
          rune: true,
        });
      for (const t of targets) rune({ ...t.position });
      const turn = (next.runeTurn * Math.PI) / 4;
      next.runeTurn += 1;
      LICH.runes.distances.forEach((d, i) => {
        for (const side of [0, Math.PI]) {
          const a = turn + side + (i * Math.PI) / 2;
          rune({
            x: enemy.position.x + Math.cos(a) * d,
            y: enemy.position.y + Math.sin(a) * d,
          });
        }
      });
    }
  }
  return result({ ...enemy, ai: next }, action);
}

/**
 * Ghost (D-122): floats straight at you, walls or not, fading out every
 * few seconds; faded, it cannot touch anyone (and cannot be hit).
 */
function ghostAct(
  enemy: EnemyState,
  target: Nearest,
  dt: number,
  result: Result,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "ghost") return result(enemy);
  let { faded, timer } = ai;
  timer -= dt;
  if (timer <= 1e-9) {
    faded = !faded;
    timer += faded ? GHOST.fadedSeconds : GHOST.visibleSeconds;
  }
  const cooldown = Math.max(0, enemy.attackCooldown - dt);
  const next = {
    ...enemy,
    attackCooldown: cooldown,
    ai: { kind: "ghost" as const, faded, timer },
  };
  if (!target) return result(next);
  // Through walls and doors: it moves as if there were none.
  const position = move(
    enemy,
    toward(enemy.position, target.target.position),
    GHOST.speed,
    [],
    dt,
  );
  const hits =
    !faded &&
    touching(position, enemy.size, target.target.position) &&
    cooldown <= 1e-9;
  return result(
    {
      ...next,
      position,
      attackCooldown: hits ? GHOST.contactCooldownSeconds : cooldown,
    },
    {
      contacts: hits
        ? [{ playerId: target.target.id, damage: GHOST.contactDamage }]
        : [],
    },
  );
}

/**
 * Necromancer (D-122): a thrower (3 slow skulls) that also raises the
 * nearest bone pile within reach whenever its raise is ready.
 */
function necromancerAct(
  enemy: EnemyState,
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "necromancer") return result(enemy);
  const thrown = slingerAct(
    enemy,
    target,
    walls,
    dt,
    result,
    context,
    NECROMANCER,
  );
  let raise = Math.max(0, ai.raise - dt);
  let raised: EnemyState | null = null;
  if (raise <= 1e-9) {
    const at = thrown.enemy.position;
    for (const e of context.allies?.() ?? []) {
      if (!isPile(e)) continue;
      const d = Math.hypot(e.position.x - at.x, e.position.y - at.y);
      if (d > NECROMANCER.raiseRange) continue;
      if (
        !raised ||
        d < Math.hypot(raised.position.x - at.x, raised.position.y - at.y)
      ) {
        raised = e;
      }
    }
    // Ready until a pile is in reach; the wait starts once it raises one.
    if (raised) raise = NECROMANCER.raiseIntervalSeconds;
  }
  return {
    ...thrown,
    enemy: { ...thrown.enemy, ai: { kind: "necromancer", raise } },
    ...(raised ? { raise: raised.id } : {}),
  };
}

/** The middle of the circle a grave knight's slam hits (D-122). */
export function slamCentre(
  position: Vec2,
  facing: Vec2,
  reach: number = KNIGHT.slam.reach,
): Vec2 {
  return {
    x: position.x + facing.x * reach,
    y: position.y + facing.y * reach,
  };
}

/** `facing` turned toward `want` by at most `maxTurn` radians. */
function turnToward(facing: Vec2, want: Vec2, maxTurn: number): Vec2 {
  if (want.x === 0 && want.y === 0) return facing;
  const from = Math.atan2(facing.y, facing.x);
  let diff = Math.atan2(want.y, want.x) - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const step = Math.max(-maxTurn, Math.min(maxTurn, diff));
  return { x: Math.cos(from + step), y: Math.sin(from + step) };
}

/**
 * Grave knight (D-122): walks at you, its shield turning toward you at a
 * limited rate; up close it raises its weapon (the warning shows exactly
 * where), then slams a circle in front of it.
 */
function knightAct(
  enemy: EnemyState,
  targets: readonly AiTarget[],
  target: Nearest,
  walls: readonly Rect[],
  dt: number,
  result: Result,
  context: AiContext,
): EnemyAction {
  const ai = enemy.ai;
  if (ai.kind !== "knight" && ai.kind !== "sentry") return result(enemy);
  const K = ai.kind === "sentry" ? SENTRY : KNIGHT;
  const slam = Math.max(0, ai.slam - dt);
  if (ai.mode === "windup") {
    const timer = ai.timer - dt;
    if (timer > 1e-9) {
      return result({ ...enemy, ai: { ...ai, slam, timer } });
    }
    const at = slamCentre(enemy.position, ai.facing, K.slam.reach);
    const contacts = targets
      .filter((t) => circleHitsPlayer(at, K.slam.radius, t.position))
      .map((t) => ({ playerId: t.id, damage: K.slam.damage }));
    return result(
      {
        ...enemy,
        ai: {
          ...ai,
          mode: "walk",
          timer: 0,
          slam: K.slam.cooldownSeconds,
        },
      },
      { contacts, slam: { at, radius: K.slam.radius, warning: false } },
    );
  }
  if (!target) return result({ ...enemy, ai: { ...ai, slam } });
  const facing = turnToward(
    ai.facing,
    toward(enemy.position, target.target.position),
    ((K.turnDegreesPerSecond * Math.PI) / 180) * dt,
  );
  if (slam <= 1e-9 && target.distance <= K.slam.triggerRange) {
    // It swings the way it faces now: the warning is exactly where it lands.
    return result(
      {
        ...enemy,
        ai: {
          ...ai,
          mode: "windup",
          facing,
          timer: K.slam.windupSeconds,
          slam,
        },
      },
      {
        slam: {
          at: slamCentre(enemy.position, facing),
          radius: K.slam.radius,
          warning: true,
        },
      },
    );
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
    K.speed,
    walls,
    dt,
  );
  return result({ ...enemy, position, ai: { ...ai, facing, slam } });
}

/**
 * Whether a grave knight's shield stops a shot flying `direction` (D-122):
 * it comes at the knight's front, within the shield's arc.
 */
export function shieldBlocks(enemy: EnemyState, direction: Vec2): boolean {
  if (enemy.ai.kind !== "knight" && enemy.ai.kind !== "sentry") return false;
  const arc = (enemy.ai.kind === "sentry" ? SENTRY : KNIGHT).shieldArcDegrees;
  const len = Math.hypot(direction.x, direction.y);
  if (len === 0) return false;
  // The shot travels against the facing when it hits the front.
  const dot =
    (-direction.x * enemy.ai.facing.x - direction.y * enemy.ai.facing.y) / len;
  return dot >= Math.cos(((arc / 2) * Math.PI) / 180);
}

export function isTelegraphing(enemy: EnemyState): boolean {
  if (enemy.ai.kind === "warden") return enemy.ai.mode === "windup";
  if (enemy.ai.kind === "wyrm") return enemy.ai.mode !== "walk";
  if (enemy.ai.kind === "forgemaster") return enemy.ai.mode === "windup";
  if (enemy.ai.kind === "elemental") return enemy.ai.fuse !== null;
  if (enemy.ai.kind === "knight" || enemy.ai.kind === "sentry")
    return enemy.ai.mode === "windup";
  if (enemy.ai.kind === "warchief") {
    return enemy.ai.mode === "sweepWindup" || enemy.ai.mode === "chargeWindup";
  }
  return (
    (enemy.ai.kind === "brute" || enemy.ai.kind === "spearman") &&
    enemy.ai.mode === "windup"
  );
}

/** A brute that charged into a wall, standing dazed (D-112). */
export function isDazed(enemy: EnemyState): boolean {
  if (enemy.ai.kind === "warden") return enemy.ai.mode === "dazed";
  if (enemy.ai.kind === "lich") return enemy.ai.mode === "stunned";
  return (
    (enemy.ai.kind === "brute" ||
      enemy.ai.kind === "spearman" ||
      enemy.ai.kind === "warchief") &&
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
        if (circleHitsPlayer(at, WARCHIEF.sweep.radius, t.position)) {
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

/**
 * Whether a circle reaches a player's hurtbox (D-127): any overlap of the
 * circle with the 31×31 box counts, as bullets and touches already do.
 * Used by every floor hazard, sweep, and slam.
 */
export function circleHitsPlayer(
  centre: Vec2,
  radius: number,
  player: Vec2,
): boolean {
  const half = PLAYER_HEALTH.hurtboxSize / 2;
  const dx = Math.max(Math.abs(centre.x - player.x) - half, 0);
  const dy = Math.max(Math.abs(centre.y - player.y) - half, 0);
  return dx * dx + dy * dy <= radius * radius;
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
