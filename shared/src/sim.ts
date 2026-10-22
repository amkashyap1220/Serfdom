import { boxAround } from "./collision.ts";
import { DUMMY_ENEMY, PLAYER_WEAPON } from "./combat-config.ts";
import { damageEnemy, isAlive, stepRespawn, type EnemyState } from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { PLAYER_BODY, PLAYER_SPEED } from "./movement-config.ts";
import { stepMovement } from "./movement.ts";
import { stepProjectile, type Projectile } from "./projectile.ts";
import { stepFireCooldown, type AimTarget, type FireIntent } from "./weapon.ts";

/**
 * One self-contained simulation step for the Phase 3 prototype: player
 * movement, shooting, projectiles, and enemies. Pure (state in, state out),
 * so the same code can run on the authoritative server in Phase 5.
 */
export interface SimState {
  player: { position: Vec2; fireCooldown: number };
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
  | { type: "blocked"; position: Vec2 };

export function createSimState(
  playerStart: Vec2,
  enemyPositions: readonly Vec2[],
): SimState {
  return {
    player: { position: { ...playerStart }, fireCooldown: 0 },
    enemies: enemyPositions.map((position, i) => ({
      id: i + 1,
      position: { ...position },
      size: DUMMY_ENEMY.size,
      hp: DUMMY_ENEMY.maxHp,
      maxHp: DUMMY_ENEMY.maxHp,
      respawnIn: 0,
    })),
    projectiles: [],
    nextProjectileId: 1,
  };
}

/** Living enemies as auto-aim candidates. */
export function aimTargets(state: SimState): AimTarget[] {
  return state.enemies
    .filter(isAlive)
    .map((e) => ({ id: e.id, position: e.position }));
}

/**
 * Order within a step: move the player, maybe fire (from the new position),
 * move every projectile (including the new one), then tick respawn timers.
 */
export function stepSim(
  state: SimState,
  input: TickInput,
  walls: readonly Rect[],
  dtSeconds: number,
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const position = stepMovement(
    state.player.position,
    input.move,
    PLAYER_BODY,
    walls,
    dtSeconds,
    PLAYER_SPEED,
  );

  const aim = input.fire.aim;
  if (aim && !(Math.abs(Math.hypot(aim.x, aim.y) - 1) < 1e-6)) {
    throw new RangeError(`aim must be a unit vector, got (${aim.x}, ${aim.y})`);
  }
  const cooldown = stepFireCooldown(
    state.player.fireCooldown,
    dtSeconds,
    input.fire.trigger && aim !== null,
    PLAYER_WEAPON.shotsPerSecond,
  );

  let projectiles = [...state.projectiles];
  let nextProjectileId = state.nextProjectileId;
  if (cooldown.fired && aim) {
    projectiles.push({
      id: nextProjectileId,
      position: { ...position },
      direction: aim,
      speed: PLAYER_WEAPON.projectileSpeed,
      remaining: PLAYER_WEAPON.range,
      damage: PLAYER_WEAPON.damage,
      size: PLAYER_WEAPON.projectileSize,
    });
    events.push({ type: "shot", projectileId: nextProjectileId });
    nextProjectileId++;
  }

  const enemies = [...state.enemies];
  const surviving: Projectile[] = [];
  for (const p of projectiles) {
    // Rebuilt per projectile so a defeated enemy stops absorbing later shots.
    const targets = enemies
      .filter(isAlive)
      .map((e) => ({ id: e.id, box: boxAround(e.position, e.size) }));
    const outcome = stepProjectile(p, dtSeconds, walls, targets);
    if (outcome.kind === "flying") {
      surviving.push(outcome.projectile);
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
    } else if (outcome.kind === "blocked") {
      events.push({ type: "blocked", position: outcome.position });
    }
  }
  projectiles = surviving;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy) continue;
    const result = stepRespawn(enemy, dtSeconds);
    enemies[i] = result.enemy;
    if (result.respawned) events.push({ type: "respawned", enemyId: enemy.id });
  }

  return {
    state: {
      player: { position, fireCooldown: cooldown.remaining },
      enemies,
      projectiles,
      nextProjectileId,
    },
    events,
  };
}
