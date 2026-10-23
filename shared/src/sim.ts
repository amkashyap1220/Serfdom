import { boxAround } from "./collision.ts";
import {
  DUMMY_ENEMY,
  PLAYER_HEALTH,
  PLAYER_REGEN,
  PLAYER_WEAPON,
} from "./combat-config.ts";
import { enemyAct } from "./enemy-ai.ts";
import type { EnemyKind } from "./enemy-config.ts";
import {
  damageEnemy,
  isAlive,
  newEnemy,
  scaleEnemyForParty,
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
 * Multiplayer combat simulation (Phase 5). Pure: state in, state out. The
 * authoritative server runs it for real; an offline client runs it for one
 * player; the client predictor runs `applyPlayerInput` for itself.
 *
 * Two clocks, on purpose:
 * - **Player timeline** — `applyPlayerInput` advances one player's movement
 *   and fire cooldown by one tick *per input they sent*. The server may
 *   apply 0–4 of a player's inputs in one tick (catch-up, see
 *   server/src/player-movement.ts), but the move-credit rule bounds the
 *   total, so nobody can move or fire faster than allowed.
 * - **World timeline** — `stepWorld` advances projectiles, enemies, and
 *   respawn timers by exactly one tick per server tick.
 */
export interface PlayerState {
  id: number;
  position: Vec2;
  fireCooldown: number;
  hp: number;
  maxHp: number;
}

export interface SimState {
  players: readonly PlayerState[];
  enemies: readonly EnemyState[];
  projectiles: readonly Projectile[];
  nextProjectileId: number;
  nextEnemyId: number;
}

/** An enemy to add to the simulation (dungeon room waves). */
export interface EnemySpawn {
  kind: EnemyKind;
  at: Vec2;
  roomId: string | null;
}

/** One tick of a player's intent: where to move and whether/where to fire. */
export interface PlayerInput {
  /** Unit world direction or (0, 0); see worldDirectionFromInput. */
  move: Vec2;
  fire: FireIntent;
}

export type SimEvent =
  | { type: "shot"; playerId: number; projectileId: number }
  | {
      type: "hit";
      enemyId: number;
      playerId: number;
      damage: number;
      position: Vec2;
    }
  | { type: "defeated"; enemyId: number; playerId: number }
  | { type: "respawned"; enemyId: number }
  | { type: "blocked"; position: Vec2 }
  | { type: "enemyAttack"; enemyId: number; bullets: number }
  | {
      type: "playerHit";
      playerId: number;
      /** The enemy whose bullet it was. */
      enemyId: number;
      damage: number;
      position: Vec2;
    }
  | { type: "playerDied"; playerId: number };

export function isPlayerAlive(player: PlayerState): boolean {
  return player.hp > 0;
}

export interface SimOptions {
  /** Enemy respawn delay; null = defeated enemies stay dead (dungeons). */
  respawnSeconds?: number | null;
}

export function createSimState(
  enemyPositions: readonly Vec2[],
  options: SimOptions = {},
): SimState {
  const respawnSeconds =
    options.respawnSeconds === undefined
      ? DUMMY_ENEMY.respawnSeconds
      : options.respawnSeconds;
  const empty: SimState = {
    players: [],
    enemies: [],
    projectiles: [],
    nextProjectileId: 1,
    nextEnemyId: 1,
  };
  return spawnEnemies(
    empty,
    enemyPositions.map((at) => ({ kind: "dummy", at, roomId: null })),
    respawnSeconds,
  );
}

/** Adds enemies at full (solo) HP; they rescale for the party on the next world tick. */
export function spawnEnemies(
  state: SimState,
  spawns: readonly EnemySpawn[],
  respawnSeconds: number | null = null,
): SimState {
  let nextEnemyId = state.nextEnemyId;
  const added = spawns.map((s) =>
    newEnemy(nextEnemyId++, s.kind, s.at, s.roomId, respawnSeconds),
  );
  return { ...state, enemies: [...state.enemies, ...added], nextEnemyId };
}

export function newPlayer(id: number, spawn: Vec2): PlayerState {
  return {
    id,
    position: { ...spawn },
    fireCooldown: 0,
    hp: PLAYER_HEALTH.maxHp,
    maxHp: PLAYER_HEALTH.maxHp,
  };
}

/** Adds a player, or resets an existing one to a fresh state at `spawn` (D-046 "play again"). */
export function addPlayer(state: SimState, id: number, spawn: Vec2): SimState {
  const others = state.players.filter((p) => p.id !== id);
  return { ...state, players: [...others, newPlayer(id, spawn)] };
}

/** Removes a player (disconnect). Their projectiles keep flying. */
export function removePlayer(state: SimState, id: number): SimState {
  return { ...state, players: state.players.filter((p) => p.id !== id) };
}

export function findPlayer(
  state: SimState,
  id: number,
): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

/** Living enemies as auto-aim candidates. */
export function aimTargets(state: SimState): AimTarget[] {
  return state.enemies
    .filter(isAlive)
    .map((e) => ({ id: e.id, position: e.position }));
}

/**
 * One tick of one player's own timeline: move, then advance the fire
 * cooldown and maybe fire from the new position. Dead or unknown players
 * are unchanged.
 */
export function applyPlayerInput(
  state: SimState,
  playerId: number,
  input: PlayerInput,
  walls: readonly Rect[],
  dtSeconds: number,
): { state: SimState; events: SimEvent[] } {
  const player = findPlayer(state, playerId);
  if (!player || !isPlayerAlive(player)) return { state, events: [] };

  const aim = input.fire.aim;
  if (aim && !(Math.abs(Math.hypot(aim.x, aim.y) - 1) < 1e-6)) {
    throw new RangeError(`aim must be a unit vector, got (${aim.x}, ${aim.y})`);
  }
  const position = stepMovement(
    player.position,
    input.move,
    PLAYER_BODY,
    walls,
    dtSeconds,
    PLAYER_SPEED,
  );
  const cooldown = stepFireCooldown(
    player.fireCooldown,
    dtSeconds,
    input.fire.trigger && aim !== null,
    PLAYER_WEAPON.shotsPerSecond,
  );

  const updated: PlayerState = {
    ...player,
    position,
    fireCooldown: cooldown.remaining,
  };
  let next: SimState = {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? updated : p)),
  };
  const events: SimEvent[] = [];
  if (cooldown.fired && aim) {
    const id = next.nextProjectileId;
    next = {
      ...next,
      projectiles: [
        ...next.projectiles,
        {
          id,
          owner: "player",
          ownerId: playerId,
          position: { ...position },
          direction: aim,
          speed: PLAYER_WEAPON.projectileSpeed,
          remaining: PLAYER_WEAPON.range,
          damage: PLAYER_WEAPON.damage,
          size: PLAYER_WEAPON.projectileSize,
        },
      ],
      nextProjectileId: id + 1,
    };
    events.push({ type: "shot", playerId, projectileId: id });
  }
  return { state: next, events };
}

/**
 * One world tick, in order:
 * 0. Living players regenerate HP (D-056), capped at max HP.
 * 1. Rescale enemy HP for the number of living players (D-045).
 * 2. Each enemy acts by kind (enemy-ai.ts): moves, fires, or lands a
 *    contact hit on a living player.
 * 3. Projectiles move and resolve hits (player shots → enemies; enemy
 *    bullets → any living player's 15×15 hurtbox at their server position,
 *    D-044).
 * 4. Enemy respawn timers. Defeated enemies that never respawn (dungeons)
 *    are removed, so snapshots do not grow with the dead.
 * A player reaching 0 HP stays in the state as dead until removed or reset
 * (D-046); only the caller decides what "back to the menu" means.
 */
export function stepWorld(
  state: SimState,
  walls: readonly Rect[],
  dtSeconds: number,
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let players = state.players.map((p) => regenerate(p, dtSeconds));
  const alivePlayers = () => players.filter(isPlayerAlive);
  const partySize = alivePlayers().length;
  let enemies = state.enemies.map((e) => scaleEnemyForParty(e, partySize));
  const projectiles = [...state.projectiles];
  let nextId = state.nextProjectileId;

  // 2. Enemies act. Living players are re-read for each enemy, so a
  // player killed by one enemy is not targeted by the next.
  enemies = enemies.map((enemy) => {
    const action = enemyAct(enemy, alivePlayers(), walls, dtSeconds);
    for (const { direction, spec } of action.bullets) {
      projectiles.push({
        id: nextId++,
        owner: "enemy",
        ownerId: enemy.id,
        position: { ...action.enemy.position },
        direction,
        speed: spec.speed,
        remaining: spec.range,
        damage: spec.damage,
        size: spec.size,
      });
    }
    if (action.bullets.length > 0) {
      events.push({
        type: "enemyAttack",
        enemyId: enemy.id,
        bullets: action.bullets.length,
      });
    }
    if (action.contact) {
      const { playerId, damage } = action.contact;
      players = players.map((pl) =>
        pl.id === playerId
          ? damagePlayer(pl, enemy.id, damage, pl.position, events)
          : pl,
      );
    }
    return action.enemy;
  });

  // 3. Projectiles. Targets are rebuilt per projectile so anything defeated
  // earlier in this tick stops absorbing hits.
  const surviving: Projectile[] = [];
  for (const p of projectiles) {
    const outcome = stepProjectile(
      p,
      dtSeconds,
      walls,
      targetsFor(p, players, enemies),
    );
    if (outcome.kind === "flying") {
      surviving.push(outcome.projectile);
    } else if (outcome.kind === "blocked") {
      events.push({ type: "blocked", position: outcome.position });
    } else if (outcome.kind === "hit" && p.owner === "enemy") {
      players = players.map((pl) =>
        pl.id === outcome.targetId
          ? damagePlayer(pl, p.ownerId, p.damage, outcome.position, events)
          : pl,
      );
    } else if (outcome.kind === "hit") {
      const i = enemies.findIndex((e) => e.id === outcome.targetId);
      const target = enemies[i];
      if (!target) continue;
      const result = damageEnemy(target, p.damage);
      enemies[i] = result.enemy;
      events.push({
        type: "hit",
        enemyId: target.id,
        playerId: p.ownerId,
        damage: p.damage,
        position: outcome.position,
      });
      if (result.defeated) {
        events.push({
          type: "defeated",
          enemyId: target.id,
          playerId: p.ownerId,
        });
      }
    }
  }

  // 4. Enemy respawn timers; the permanently dead are dropped.
  enemies = enemies
    .filter((enemy) => isAlive(enemy) || enemy.respawnSeconds !== null)
    .map((enemy) => {
      const result = stepRespawn(enemy, dtSeconds);
      if (result.respawned)
        events.push({ type: "respawned", enemyId: enemy.id });
      return result.enemy;
    });

  return {
    state: {
      ...state,
      players,
      enemies,
      projectiles: surviving,
      nextProjectileId: nextId,
    },
    events,
  };
}

/** Always-on regeneration (D-056); the dead do not regenerate. */
function regenerate(player: PlayerState, dtSeconds: number): PlayerState {
  if (!isPlayerAlive(player) || player.hp >= player.maxHp) return player;
  const hp = Math.min(
    player.maxHp,
    player.hp + PLAYER_REGEN.hpPerSecond * dtSeconds,
  );
  return { ...player, hp };
}

/** Applies an enemy's hit to a player, recording playerHit (and playerDied on the killing blow). */
function damagePlayer(
  player: PlayerState,
  enemyId: number,
  damage: number,
  position: Vec2,
  events: SimEvent[],
): PlayerState {
  if (!isPlayerAlive(player)) return player;
  const { hp, died } = applyDamage(player.hp, damage);
  events.push({
    type: "playerHit",
    playerId: player.id,
    enemyId,
    damage,
    position,
  });
  if (died) events.push({ type: "playerDied", playerId: player.id });
  return { ...player, hp };
}

/**
 * Convenience for the offline client and tests: apply each player's input
 * for this tick (one per player), then advance the world one tick.
 */
export function stepSim(
  state: SimState,
  inputs: ReadonlyMap<number, PlayerInput>,
  walls: readonly Rect[],
  dtSeconds: number,
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let next = state;
  for (const [id, input] of inputs) {
    const r = applyPlayerInput(next, id, input, walls, dtSeconds);
    next = r.state;
    events.push(...r.events);
  }
  const world = stepWorld(next, walls, dtSeconds);
  return { state: world.state, events: [...events, ...world.events] };
}

/** What a projectile can hit: enemies for player shots, living players' hurtboxes for enemy bullets. */
function targetsFor(
  p: Projectile,
  players: readonly PlayerState[],
  enemies: readonly EnemyState[],
): HitTarget[] {
  if (p.owner === "enemy") {
    return players.filter(isPlayerAlive).map((pl) => ({
      id: pl.id,
      box: boxAround(pl.position, PLAYER_HEALTH.hurtboxSize),
    }));
  }
  return enemies
    .filter(isAlive)
    .map((e) => ({ id: e.id, box: boxAround(e.position, e.size) }));
}
