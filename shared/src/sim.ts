import { boxAround } from "./collision.ts";
import { DUMMY_ENEMY, PLAYER_HEALTH, PLAYER_WEAPON } from "./combat-config.ts";
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
import { rotateVec, type Rect, type Vec2 } from "./geometry.ts";
import { applyDamage } from "./health.ts";
import { PLAYER_BODY } from "./movement-config.ts";
import { stepMovement } from "./movement.ts";
import {
  stepProjectile,
  type HitTarget,
  type Projectile,
} from "./projectile.ts";
import {
  ABILITIES,
  ARCANE_BLAST,
  CHAIN_LIGHTNING,
  chainLightningDamage,
  chainLightningJumps,
  NATURES_REACH,
  naturesReachDamage,
  arcaneBlastDamage,
  clampToRange,
  VOLLEY,
  volleyArrowDamage,
  type AbilityLoadout,
} from "./abilities.ts";
import { weaponDamage } from "./items.ts";
import {
  combatFor,
  SERF_BASE,
  type PlayerCombat,
  type Stats,
} from "./stats.ts";
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
  /** Ability resource (D-093); full at run start, regenerates with WIS. */
  mp: number;
  /** From the serf's stats (D-077): speed, fire rate, damage, defense, regen. */
  combat: PlayerCombat;
  /** What Space casts, from the worn ability item (D-092); null = nothing. */
  ability: AbilityLoadout | null;
  /** Seconds until the ability may be cast again. */
  abilityCooldown: number;
}

export interface SimState {
  players: readonly PlayerState[];
  enemies: readonly EnemyState[];
  projectiles: readonly Projectile[];
  nextProjectileId: number;
  nextEnemyId: number;
  /** Delayed area attacks waiting to land (Warlord rockfall). */
  hazards: readonly Hazard[];
  /** Arcane Blasts cast this tick, resolved by the next world step. */
  blasts: readonly Blast[];
  /** Nature's Reach patches on the ground (D-097). */
  zones: readonly Zone[];
}

/** A warning circle that damages living players inside it when it lands. */
export interface Hazard {
  position: Vec2;
  radius: number;
  damage: number;
  /** Seconds until it lands. */
  landsIn: number;
  /** The enemy that made it. */
  ownerId: number;
}

/** An enemy to add to the simulation (dungeon room waves, boss summons). */
export interface EnemySpawn {
  kind: EnemyKind;
  at: Vec2;
  roomId: string | null;
  /** Dies with this enemy (summons). */
  summonerId?: number | null;
}

/** One tick of a player's intent: where to move and whether/where to fire. */
/** A lingering ability area: hurts every pulse and slows enemies inside. */
export interface Zone {
  ownerId: number;
  at: Vec2;
  radius: number;
  /** Seconds left. */
  remaining: number;
  /** Seconds until the next pulse of damage. */
  pulseIn: number;
  damage: number;
}

/** What one cast puts into the world. */
interface Cast {
  blast?: Blast;
  zone?: Zone;
  projectiles?: Omit<Projectile, "id">[];
  /** Enemies after an instant ability hit them, with its events. */
  enemies?: EnemyState[];
  events?: SimEvent[];
}

/**
 * The effect of casting `ability` toward `target` (an offset from the
 * player); null when it cannot be aimed (nothing is spent then). Damage
 * scales with the item tier (D-095) and the caster's Attack (D-096).
 */
function castAbility(
  ability: AbilityLoadout,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  combat: PlayerCombat,
  enemies: readonly EnemyState[],
): Cast | null {
  if (ability.kind === "naturesReach") {
    const offset = clampToRange(target, NATURES_REACH.range);
    return {
      zone: {
        ownerId,
        at: { x: position.x + offset.x, y: position.y + offset.y },
        radius: NATURES_REACH.radius,
        remaining: NATURES_REACH.seconds,
        // The first pulse lands at once.
        pulseIn: 0,
        damage: naturesReachDamage(ability.tier) * combat.attackFactor,
      },
    };
  }
  if (ability.kind === "chainLightning") {
    return chainLightning(
      ability.tier,
      ownerId,
      position,
      target,
      combat,
      enemies,
    );
  }
  if (ability.kind === "arcaneBlast") {
    const offset = clampToRange(target, ARCANE_BLAST.range);
    return {
      blast: {
        ownerId,
        at: { x: position.x + offset.x, y: position.y + offset.y },
        radius: ARCANE_BLAST.radius,
        damage: arcaneBlastDamage(ability.tier) * combat.attackFactor,
      },
    };
  }
  // Volley (D-097): an even fan around the aim.
  const length = Math.hypot(target.x, target.y);
  if (!(length > 1e-9)) return null;
  const aim = { x: target.x / length, y: target.y / length };
  const step = (VOLLEY.spreadDegrees * Math.PI) / 180 / (VOLLEY.arrows - 1);
  const first = -((VOLLEY.arrows - 1) / 2) * step;
  const damage = volleyArrowDamage(ability.tier) * combat.attackFactor;
  return {
    projectiles: Array.from({ length: VOLLEY.arrows }, (_, i) => ({
      owner: "player" as const,
      ownerId,
      position: { ...position },
      direction: rotateVec(aim, first + i * step),
      speed: VOLLEY.speed,
      remaining: VOLLEY.range,
      damage,
      size: VOLLEY.size,
      fromAbility: true,
    })),
  };
}

/**
 * Chain Lightning (D-097): the first enemy is the one nearest the target
 * point (within 80 px of it and 250 px of the caster); each jump then goes
 * to the nearest enemy not hit yet within 120 px of the last, for 80% of
 * the previous hit. No first enemy: no cast.
 */
function chainLightning(
  tier: number,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  combat: PlayerCombat,
  enemies: readonly EnemyState[],
): Cast | null {
  const offset = clampToRange(target, CHAIN_LIGHTNING.range);
  const point = { x: position.x + offset.x, y: position.y + offset.y };
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  const nearestTo = (
    from: Vec2,
    within: number,
    hit: Set<number>,
    also?: (e: EnemyState) => boolean,
  ) => {
    let best: EnemyState | null = null;
    for (const e of enemies) {
      if (!isAlive(e) || hit.has(e.id) || (also && !also(e))) continue;
      const d = dist(e.position, from);
      if (d > within) continue;
      if (
        !best ||
        d < dist(best.position, from) ||
        (d === dist(best.position, from) && e.id < best.id)
      )
        best = e;
    }
    return best;
  };
  const hit = new Set<number>();
  let current = nearestTo(
    point,
    CHAIN_LIGHTNING.pickRadius,
    hit,
    (e) => dist(e.position, position) <= CHAIN_LIGHTNING.range,
  );
  if (!current) return null;
  const updated = [...enemies];
  const events: SimEvent[] = [];
  const points: Vec2[] = [{ ...position }];
  let damage = chainLightningDamage(tier) * combat.attackFactor;
  for (let n = 0; current && n <= chainLightningJumps(tier); n++) {
    hit.add(current.id);
    points.push({ ...current.position });
    const i = updated.findIndex((e) => e.id === current?.id);
    const result = damageEnemy(updated[i]!, damage);
    updated[i] = result.enemy;
    events.push({
      type: "hit",
      enemyId: current.id,
      playerId: ownerId,
      damage,
      position: current.position,
    });
    if (result.defeated)
      events.push({ type: "defeated", enemyId: current.id, playerId: ownerId });
    damage *= CHAIN_LIGHTNING.falloff;
    current = nearestTo(current.position, CHAIN_LIGHTNING.jumpRange, hit);
  }
  events.push({ type: "chain", playerId: ownerId, points });
  return { enemies: updated, events };
}

/** An ability's area hit waiting for the world step (D-096). */
export interface Blast {
  ownerId: number;
  at: Vec2;
  radius: number;
  damage: number;
}

export interface PlayerInput {
  /** Unit world direction or (0, 0); see worldDirectionFromInput. */
  move: Vec2;
  fire: FireIntent;
  /** Space held: where to cast, as an offset from the player (D-094); none if absent. */
  ability?: Vec2 | null;
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
  | { type: "playerDied"; playerId: number }
  /** An ability landed (drawn by every client). */
  | { type: "blast"; playerId: number; at: Vec2; radius: number }
  /** Chain Lightning's path: the caster, then each enemy hit (drawn). */
  | { type: "chain"; playerId: number; points: Vec2[] };

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
    hazards: [],
    blasts: [],
    zones: [],
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
    newEnemy(
      nextEnemyId++,
      s.kind,
      s.at,
      s.roomId,
      respawnSeconds,
      s.summonerId ?? null,
    ),
  );
  return { ...state, enemies: [...state.enemies, ...added], nextEnemyId };
}

/**
 * A player at full HP; a fresh Serf's stats and no weapon unless given
 * (D-055, D-078, D-083).
 */
export function newPlayer(
  id: number,
  spawn: Vec2,
  stats: Stats = SERF_BASE,
  weaponTier: number | null = null,
  ability: AbilityLoadout | null = null,
): PlayerState {
  const combat = combatFor(stats, weaponDamage(weaponTier));
  return {
    id,
    position: { ...spawn },
    fireCooldown: 0,
    hp: combat.maxHp,
    maxHp: combat.maxHp,
    mp: combat.maxMp,
    combat,
    ability,
    abilityCooldown: 0,
  };
}

/** Adds a player, or resets an existing one to a fresh state at `spawn` (D-046 "play again"). */
export function addPlayer(
  state: SimState,
  id: number,
  spawn: Vec2,
  stats: Stats = SERF_BASE,
  weaponTier: number | null = null,
  ability: AbilityLoadout | null = null,
): SimState {
  const others = state.players.filter((p) => p.id !== id);
  return {
    ...state,
    players: [...others, newPlayer(id, spawn, stats, weaponTier, ability)],
  };
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
    player.combat.moveSpeed,
  );
  const cooldown = stepFireCooldown(
    player.fireCooldown,
    dtSeconds,
    input.fire.trigger && aim !== null,
    player.combat.shotsPerSecond,
  );

  // The ability (D-092–D-096): its cooldown runs on the player's own
  // timeline like the fire cooldown; casting needs the item, MP, and a
  // target (an offset from the player, clamped to the range here).
  let abilityCooldown = Math.max(0, player.abilityCooldown - dtSeconds);
  let mp = player.mp;
  const target = input.ability ?? null;
  const ability = player.ability;
  let cast: Cast | null = null;
  if (
    target &&
    ability &&
    abilityCooldown <= 1e-9 &&
    mp >= ABILITIES[ability.kind].mpCost
  ) {
    cast = castAbility(
      ability,
      playerId,
      position,
      target,
      player.combat,
      state.enemies,
    );
    if (cast) {
      mp -= ABILITIES[ability.kind].mpCost;
      abilityCooldown = ABILITIES[ability.kind].cooldownSeconds;
    }
  }

  const updated: PlayerState = {
    ...player,
    position,
    fireCooldown: cooldown.remaining,
    mp,
    abilityCooldown,
  };
  let next: SimState = {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? updated : p)),
    blasts: cast?.blast ? [...state.blasts, cast.blast] : state.blasts,
    zones: cast?.zone ? [...state.zones, cast.zone] : state.zones,
  };
  const events: SimEvent[] = [];
  // Chain Lightning hits at once (it needs the enemies where they are now).
  if (cast?.enemies) next = { ...next, enemies: cast.enemies };
  events.push(...(cast?.events ?? []));
  // Ability projectiles (Volley) fly and hit like shots from here on.
  for (const arrow of cast?.projectiles ?? []) {
    const id = next.nextProjectileId;
    next = {
      ...next,
      projectiles: [...next.projectiles, { ...arrow, id }],
      nextProjectileId: id + 1,
    };
  }
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
          damage: player.combat.shotDamage,
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
 * 2. Each enemy acts by kind (enemy-ai.ts): moves, fires, lands contact
 *    hits, summons, or marks hazards. Summons join after every enemy acted.
 * 2b. Hazards count down; landing ones hit living players inside them.
 * 3. Projectiles move and resolve hits (player shots → enemies; enemy
 *    bullets → any living player's 15×15 hurtbox at their server position,
 *    D-044).
 * 4. Enemy respawn timers. Defeated enemies that never respawn (dungeons)
 *    are removed, so snapshots do not grow with the dead; summons die
 *    with their summoner.
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
  // Enemies inside a Nature's Reach move at half speed this tick (D-097).
  const inZone = (e: EnemyState) =>
    state.zones.some(
      (z) =>
        Math.hypot(e.position.x - z.at.x, e.position.y - z.at.y) <= z.radius,
    );
  let enemies = state.enemies.map((e) => {
    const scaled = scaleEnemyForParty(e, partySize);
    const slowed = inZone(scaled);
    return scaled.slowed === slowed ? scaled : { ...scaled, slowed };
  });
  const projectiles = [...state.projectiles];
  let nextId = state.nextProjectileId;

  // 2. Enemies act. Living players are re-read for each enemy, so a
  // player killed by one enemy is not targeted by the next.
  const summons: EnemySpawn[] = [];
  const newHazards: Hazard[] = [];
  const context = {
    aliveSummons: (id: number) =>
      state.enemies.filter((e) => e.summonerId === id && isAlive(e)).length,
  };
  enemies = enemies.map((enemy) => {
    const action = enemyAct(enemy, alivePlayers(), walls, dtSeconds, context);
    for (const s of action.summons) {
      summons.push({ ...s, roomId: enemy.roomId, summonerId: enemy.id });
    }
    for (const h of action.hazards) {
      newHazards.push({
        position: h.at,
        radius: h.radius,
        damage: h.damage,
        landsIn: h.delaySeconds,
        ownerId: enemy.id,
      });
    }
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
    for (const { playerId, damage } of action.contacts) {
      players = players.map((pl) =>
        pl.id === playerId
          ? damagePlayer(pl, enemy.id, damage, pl.position, events)
          : pl,
      );
    }
    return action.enemy;
  });
  let nextEnemyId = state.nextEnemyId;
  if (summons.length > 0) {
    const added = spawnEnemies({ ...state, enemies, nextEnemyId }, summons);
    enemies = [...added.enemies];
    nextEnemyId = added.nextEnemyId;
  }

  // 2b. Hazards: existing ones count down and land; new ones wait a full delay.
  const hazards: Hazard[] = [];
  for (const h of state.hazards) {
    const landsIn = h.landsIn - dtSeconds;
    if (landsIn > 1e-9) {
      hazards.push({ ...h, landsIn });
      continue;
    }
    players = players.map((pl) =>
      isPlayerAlive(pl) &&
      Math.hypot(pl.position.x - h.position.x, pl.position.y - h.position.y) <=
        h.radius
        ? damagePlayer(pl, h.ownerId, h.damage, pl.position, events)
        : pl,
    );
  }
  hazards.push(...newHazards);

  // 2c. Blasts cast since the last step hit every living enemy in their
  // area once (D-096), credited to the caster like a shot.
  for (const b of state.blasts) {
    events.push({
      type: "blast",
      playerId: b.ownerId,
      at: b.at,
      radius: b.radius,
    });
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !isAlive(e)) continue;
      if (Math.hypot(e.position.x - b.at.x, e.position.y - b.at.y) > b.radius) {
        continue;
      }
      const result = damageEnemy(e, b.damage);
      enemies[i] = result.enemy;
      events.push({
        type: "hit",
        enemyId: e.id,
        playerId: b.ownerId,
        damage: b.damage,
        position: e.position,
      });
      if (result.defeated) {
        events.push({ type: "defeated", enemyId: e.id, playerId: b.ownerId });
      }
    }
  }

  // 2d. Nature's Reach: a pulse of damage to every enemy inside, every
  // 0.5 s while it lasts (D-097); expired patches go.
  const zones: Zone[] = [];
  for (const z of state.zones) {
    let pulseIn = z.pulseIn;
    if (pulseIn <= 1e-9) {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !isAlive(e)) continue;
        if (
          Math.hypot(e.position.x - z.at.x, e.position.y - z.at.y) > z.radius
        ) {
          continue;
        }
        const result = damageEnemy(e, z.damage);
        enemies[i] = result.enemy;
        events.push({
          type: "hit",
          enemyId: e.id,
          playerId: z.ownerId,
          damage: z.damage,
          position: e.position,
        });
        if (result.defeated) {
          events.push({ type: "defeated", enemyId: e.id, playerId: z.ownerId });
        }
      }
      pulseIn += NATURES_REACH.pulseSeconds;
    }
    const remaining = z.remaining - dtSeconds;
    if (remaining > 1e-9)
      zones.push({ ...z, remaining, pulseIn: pulseIn - dtSeconds });
  }

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

  // 4. Enemy respawn timers; the permanently dead are dropped, and so are
  // the summons of anything dead.
  const deadIds = new Set(enemies.filter((e) => !isAlive(e)).map((e) => e.id));
  enemies = enemies
    .filter(
      (enemy) =>
        (isAlive(enemy) || enemy.respawnSeconds !== null) &&
        !(enemy.summonerId !== null && deadIds.has(enemy.summonerId)),
    )
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
      nextEnemyId,
      hazards,
      blasts: [],
      zones,
    },
    events,
  };
}

/** Always-on HP and MP regeneration (D-056, D-096); the dead do not regenerate. */
function regenerate(player: PlayerState, dtSeconds: number): PlayerState {
  if (!isPlayerAlive(player)) return player;
  const { combat } = player;
  if (player.hp >= player.maxHp && player.mp >= combat.maxMp) return player;
  return {
    ...player,
    hp: Math.min(player.maxHp, player.hp + combat.regenPerSecond * dtSeconds),
    mp: Math.min(combat.maxMp, player.mp + combat.mpRegenPerSecond * dtSeconds),
  };
}

/**
 * Applies an enemy's hit to a player, reduced by their Defense (D-078),
 * recording playerHit with the damage actually taken (and playerDied on
 * the killing blow).
 */
function damagePlayer(
  player: PlayerState,
  enemyId: number,
  hit: number,
  position: Vec2,
  events: SimEvent[],
): PlayerState {
  if (!isPlayerAlive(player)) return player;
  const damage = hit * player.combat.damageTakenFactor;
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
