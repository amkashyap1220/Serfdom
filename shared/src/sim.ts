import { boxAround } from "./collision.ts";
import {
  DUMMY_ENEMY,
  ENEMY_RING_ATTACK,
  PLAYER_HEALTH,
  PLAYER_WEAPON,
} from "./combat-config.ts";
import {
  damageEnemy,
  isAlive,
  ringDirections,
  stepRespawn,
  type EnemyState,
} from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { applyDamage } from "./health.ts";
import { PLAYER_BODY, PLAYER_SPEED } from "./movement-config.ts";
import { stepMovement } from "./movement.ts";
import {
  stepProjectile,
  type HitTarget,
  type Projectile,
} from "./projectile.ts";
import { stepFireCooldown, type AimTarget, type FireIntent } from "./weapon.ts";

/**
 * One self-contained simulation step for the Phase 3 prototype: player
 * movement, shooting, enemy attacks, projectiles, damage, and the prototype
 * death/respawn. Pure (state in, state out), so the same code can run on the
 * authoritative server in Phase 5.
 */
export interface PlayerState {
  position: Vec2;
  /** Where the player reappears after the prototype respawn. */
  spawn: Vec2;
  fireCooldown: number;
  hp: number;
  maxHp: number;
  /** Seconds until the prototype respawn; 0 while alive. */
  respawnIn: number;
}

export interface SimState {
  player: PlayerState;
  enemies: readonly EnemyState[];
  projectiles: readonly Projectile[];
  nextProjectileId: number;
}

export interface TickInput {
  /** Unit world direction or (0, 0); see worldDirectionFromInput. */
  move: Vec2;
  fire: FireIntent;
}

export type SimEvent =
  | { type: "shot"; projectileId: number }
  | { type: "hit"; enemyId: number; damage: number; position: Vec2 }
  | { type: "defeated"; enemyId: number }
  | { type: "respawned"; enemyId: number }
  | { type: "blocked"; position: Vec2 }
  | { type: "enemyAttack"; enemyId: number; bullets: number }
  | { type: "playerHit"; damage: number; position: Vec2 }
  | { type: "playerDied" }
  | { type: "playerRespawned" };

/** Target id used for the player in projectile hit tests (enemy ids start at 1). */
const PLAYER_TARGET_ID = 0;

export function createSimState(
  playerStart: Vec2,
  enemyPositions: readonly Vec2[],
): SimState {
  return {
    player: {
      position: { ...playerStart },
      spawn: { ...playerStart },
      fireCooldown: 0,
      hp: PLAYER_HEALTH.maxHp,
      maxHp: PLAYER_HEALTH.maxHp,
      respawnIn: 0,
    },
    enemies: enemyPositions.map((position, i) => ({
      id: i + 1,
      position: { ...position },
      size: DUMMY_ENEMY.size,
      hp: DUMMY_ENEMY.maxHp,
      maxHp: DUMMY_ENEMY.maxHp,
      respawnIn: 0,
      attackCooldown: 0,
    })),
    projectiles: [],
    nextProjectileId: 1,
  };
}

export function isPlayerAlive(player: PlayerState): boolean {
  return player.hp > 0;
}

/** Living enemies as auto-aim candidates. */
export function aimTargets(state: SimState): AimTarget[] {
  return state.enemies
    .filter(isAlive)
    .map((e) => ({ id: e.id, position: e.position }));
}

/**
 * Order within a step:
 * 1. Player moves and maybe fires (only while alive).
 * 2. Enemies in aggro range of a living player maybe fire a ring.
 * 3. Every projectile moves and resolves hits (player shots → enemies,
 *    enemy bullets → the player's hurtbox).
 * 4. Enemy respawn timers, then the prototype player respawn timer.
 */
export function stepSim(
  state: SimState,
  input: TickInput,
  walls: readonly Rect[],
  dtSeconds: number,
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let player = { ...state.player };
  let enemies = [...state.enemies];
  const projectiles = [...state.projectiles];
  let nextId = state.nextProjectileId;
  const spawn = (p: Omit<Projectile, "id">): number => {
    projectiles.push({ ...p, id: nextId });
    return nextId++;
  };

  // 1. Player movement and shooting.
  if (isPlayerAlive(player)) {
    player.position = stepMovement(
      player.position,
      input.move,
      PLAYER_BODY,
      walls,
      dtSeconds,
      PLAYER_SPEED,
    );
    const aim = input.fire.aim;
    if (aim && !(Math.abs(Math.hypot(aim.x, aim.y) - 1) < 1e-6)) {
      throw new RangeError(
        `aim must be a unit vector, got (${aim.x}, ${aim.y})`,
      );
    }
    const cooldown = stepFireCooldown(
      player.fireCooldown,
      dtSeconds,
      input.fire.trigger && aim !== null,
      PLAYER_WEAPON.shotsPerSecond,
    );
    player.fireCooldown = cooldown.remaining;
    if (cooldown.fired && aim) {
      const id = spawn({
        owner: "player",
        position: { ...player.position },
        direction: aim,
        speed: PLAYER_WEAPON.projectileSpeed,
        remaining: PLAYER_WEAPON.range,
        damage: PLAYER_WEAPON.damage,
        size: PLAYER_WEAPON.projectileSize,
      });
      events.push({ type: "shot", projectileId: id });
    }
  }

  // 2. Enemy ring attacks.
  enemies = enemies.map((enemy) => {
    const inRange =
      isAlive(enemy) &&
      isPlayerAlive(player) &&
      Math.hypot(
        player.position.x - enemy.position.x,
        player.position.y - enemy.position.y,
      ) <= ENEMY_RING_ATTACK.aggroRange;
    const attack = stepFireCooldown(
      enemy.attackCooldown,
      dtSeconds,
      inRange,
      1 / ENEMY_RING_ATTACK.intervalSeconds,
    );
    if (attack.fired) {
      for (const direction of ringDirections(ENEMY_RING_ATTACK.bullets)) {
        spawn({
          owner: "enemy",
          position: { ...enemy.position },
          direction,
          speed: ENEMY_RING_ATTACK.speed,
          remaining: ENEMY_RING_ATTACK.range,
          damage: ENEMY_RING_ATTACK.damage,
          size: ENEMY_RING_ATTACK.size,
        });
      }
      events.push({
        type: "enemyAttack",
        enemyId: enemy.id,
        bullets: ENEMY_RING_ATTACK.bullets,
      });
    }
    return { ...enemy, attackCooldown: attack.remaining };
  });

  // 3. Projectiles. Targets are rebuilt per projectile so anything defeated
  // earlier in this step stops absorbing hits.
  const surviving: Projectile[] = [];
  for (const p of projectiles) {
    const outcome = stepProjectile(
      p,
      dtSeconds,
      walls,
      targetsFor(p, player, enemies),
    );
    if (outcome.kind === "flying") {
      surviving.push(outcome.projectile);
    } else if (outcome.kind === "blocked") {
      events.push({ type: "blocked", position: outcome.position });
    } else if (outcome.kind === "hit" && p.owner === "enemy") {
      const { hp, died } = applyDamage(player.hp, p.damage);
      player = {
        ...player,
        hp,
        respawnIn: died ? PLAYER_HEALTH.respawnSeconds : player.respawnIn,
      };
      events.push({
        type: "playerHit",
        damage: p.damage,
        position: outcome.position,
      });
      if (died) events.push({ type: "playerDied" });
    } else if (outcome.kind === "hit") {
      const i = enemies.findIndex((e) => e.id === outcome.targetId);
      const target = enemies[i];
      if (!target) continue;
      const result = damageEnemy(target, p.damage, DUMMY_ENEMY.respawnSeconds);
      enemies[i] = result.enemy;
      events.push({
        type: "hit",
        enemyId: target.id,
        damage: p.damage,
        position: outcome.position,
      });
      if (result.defeated)
        events.push({ type: "defeated", enemyId: target.id });
    }
  }

  // 4. Respawn timers.
  enemies = enemies.map((enemy) => {
    const result = stepRespawn(enemy, dtSeconds);
    if (result.respawned) events.push({ type: "respawned", enemyId: enemy.id });
    return result.enemy;
  });

  let next: SimState = {
    player,
    enemies,
    projectiles: surviving,
    nextProjectileId: nextId,
  };
  if (!isPlayerAlive(player) && !events.some((e) => e.type === "playerDied")) {
    next = stepPlayerRespawn(next, dtSeconds, events);
  }
  return { state: next, events };
}

/** What a projectile can hit: enemies for player shots, the player's hurtbox for enemy bullets. */
function targetsFor(
  p: Projectile,
  player: PlayerState,
  enemies: readonly EnemyState[],
): HitTarget[] {
  if (p.owner === "enemy") {
    return isPlayerAlive(player)
      ? [
          {
            id: PLAYER_TARGET_ID,
            box: boxAround(player.position, PLAYER_HEALTH.hurtboxSize),
          },
        ]
      : [];
  }
  return enemies
    .filter(isAlive)
    .map((e) => ({ id: e.id, box: boxAround(e.position, e.size) }));
}

/**
 * PROTOTYPE ONLY (not the final permadeath rules): counts down while dead,
 * then resets the encounter: player back at spawn with full HP, all
 * projectiles cleared, every enemy at full HP with a fresh attack timer.
 */
function stepPlayerRespawn(
  state: SimState,
  dtSeconds: number,
  events: SimEvent[],
): SimState {
  const respawnIn = state.player.respawnIn - dtSeconds;
  if (respawnIn > 1e-9) {
    return { ...state, player: { ...state.player, respawnIn } };
  }
  events.push({ type: "playerRespawned" });
  return {
    ...state,
    player: {
      ...state.player,
      position: { ...state.player.spawn },
      hp: state.player.maxHp,
      fireCooldown: 0,
      respawnIn: 0,
    },
    enemies: state.enemies.map((e) => ({
      ...e,
      hp: e.maxHp,
      respawnIn: 0,
      attackCooldown: 0,
    })),
    projectiles: [],
  };
}
