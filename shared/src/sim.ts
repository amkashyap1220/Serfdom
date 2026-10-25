import {
  BOSS_KINDS,
  EELPRIEST,
  FORGEMASTER,
  SHAMAN,
  SKELETON,
  STORMCALLER,
  DRAGON,
} from "./enemy-config.ts";
import { burningStrips, waveHits } from "./forge-boss.ts";
import { LIGHTNING, windDrift, type Wind } from "./storm.ts";
import {
  FROST,
  ICICLES,
  coneHits,
  onFrost,
  type ConeShape,
  type FrostPatch,
} from "./frost.ts";
import {
  SURGE,
  TIDES,
  WHIRLPOOL,
  surgeDone,
  surgeHits,
  surgeStart,
  tideAt,
  waterDrift,
  whirlpoolActive,
  type Pull,
  type SurgeShape,
  type WhirlpoolShape,
} from "./temple-water.ts";
import type { Waypoints } from "./pathing.ts";
import type { BlastKind } from "./protocol.ts";
import {
  ARROWS,
  BLADES,
  type BladeSpot,
  BRAZIERS,
  JETS,
  LAVA,
  ROCKFALL,
  SLAG,
  SLUDGE,
} from "./dungeon-layout.ts";
import { boxAround } from "./collision.ts";
import { DUMMY_ENEMY, PLAYER_HEALTH } from "./combat-config.ts";
import { circleHitsPlayer, enemyAct, shieldBlocks } from "./enemy-ai.ts";
import type { EnemyKind } from "./enemy-config.ts";
import {
  damageEnemy,
  isAlive,
  isHittable,
  isPile,
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
  BATTLE_CRY,
  battleCryBonus,
  GUARD,
  guardReduction,
  HEALING,
  healingAmount,
  VANISH,
  vanishSeconds,
  CURSE,
  curseBonus,
  INSPIRATION,
  inspirationBonus,
  arcaneBlastDamage,
  clampToRange,
  VOLLEY,
  volleyArrowDamage,
  type AbilityLoadout,
} from "./abilities.ts";
import { weaponDamage, type WeaponType } from "./items.ts";
import { attackOf, swingCatches } from "./weapon-patterns.ts";
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
  /** Timed buffs on this player (D-098): damage and regen only. */
  buffs: PlayerBuffs;
  /** World px per second over its last input; leading slingers aim with it (D-109). */
  velocity: Vec2;
  /** An eel-priest's pull on them (D-135), and which eel-priest: its death before the pull breaks it. */
  pull?: Pull & { by: number };
  /** Run clock until which blade arms cannot hurt them again (D-137). */
  bladeSafeUntil?: number;
}

/** A timed bonus: `bonus` is a share (0.3 = +30%), `remaining` seconds. */
export interface Buff {
  remaining: number;
  bonus: number;
}

/**
 * Each buff at most once; a recast refreshes it (D-098, D-100). For
 * Battle Cry and Inspiration `bonus` is extra damage dealt; for Guard and
 * Vanish it is the share of incoming damage blocked.
 */
export interface PlayerBuffs {
  battleCry?: Buff;
  inspiration?: Buff;
  guard?: Buff;
  vanish?: Buff;
}

export const PLAYER_BUFF_KEYS = [
  "battleCry",
  "inspiration",
  "guard",
  "vanish",
] as const satisfies readonly (keyof PlayerBuffs)[];

/** Vanished players are out of every enemy's sight (D-100). */
export function isVanished(player: PlayerState): boolean {
  return player.buffs.vanish !== undefined;
}

/** How much a player's damage is multiplied by their buffs (bonuses add). */
export function damageMultiplier(player: PlayerState): number {
  return (
    1 +
    (player.buffs.battleCry?.bonus ?? 0) +
    (player.buffs.inspiration?.bonus ?? 0)
  );
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
  /** Sludge pools (D-113): a player whose centre is in one moves slower. */
  sludge: readonly Rect[];
  /** Burning floor left by bombs (D-115). */
  fires: readonly Fire[];
  /** Lava channels (D-130): they burn players and block enemies. */
  lava?: readonly Rect[];
  /** Seconds until lava next burns (every LAVA.tickSeconds). */
  lavaIn?: number;
  /** Fire jets' beams burning now (D-133). */
  beams?: readonly Beam[];
  /** The Forgemaster's shockwaves (D-134). */
  waves?: readonly Wave[];
  /** The Forgemaster's floor plates, glowing or bursting (D-134). */
  plates?: readonly PlateBurst[];
  /** Seconds since the run began: tides, pulls, and whirlpools keep to it (D-135). */
  clock?: number;
  /** Tide pools (D-135): deep on the tide cycle, slowing players. */
  tides?: readonly Rect[];
  /** The Tide Priest's whirlpools (D-135). */
  whirlpools?: readonly Whirlpool[];
  /** The Tide Priest's tidal surges (D-135). */
  surges?: readonly Surge[];
  /** Frost on the floor (D-136): it slows players. */
  frost?: readonly FrostPatch[];
  /** Breath cones waiting to land, or just landed (drawn a moment, D-136). */
  cones?: readonly Cone[];
  /** The fighting rooms' blade arms, set by the server each tick (D-137). */
  roomBlades?: readonly BladeSpot[];
  /** Every blade arm turning this tick, for drawing (D-137). */
  blades?: readonly LiveBlade[];
  /** Wind channels (D-139): gusts on the run clock push players. */
  winds?: readonly Wind[];
}

/** A blade arm as it is now (D-137): from `pivot` at `angle` (radians), turning `speed` rad/s. */
export interface LiveBlade {
  pivot: Vec2;
  length: number;
  angle: number;
  speed: number;
  damage: number;
  /** The enemy carrying it, or -1 for a room's. */
  ownerId: number;
}

/** A breath cone (D-136): lands once `startsIn` runs out, hitting every player it touches. */
export interface Cone extends ConeShape {
  startsIn: number;
  /** After landing: how much longer it is drawn. */
  shownLeft: number;
  damage: number;
  ownerId: number;
  /** Frost it leaves along its middle. */
  frost?: { radius: number; seconds: number };
  /** Burning floor it leaves along its length (D-140). */
  fire?: {
    radius: number;
    seconds: number;
    tickSeconds: number;
    damage: number;
  };
  /** Its arena: players outside are not hit. */
  area?: Rect;
}

/** A whirlpool (D-135): drags players in while active; its core hurts every tick. */
export interface Whirlpool extends WhirlpoolShape {
  /** Run clock of its core's next hurt. */
  nextTick: number;
  damage: number;
  ownerId: number;
}

/** A tidal surge (D-135): waits out `startsIn`, then sweeps; hits each player once. */
export interface Surge extends SurgeShape {
  startsIn: number;
  damage: number;
  ownerId: number;
  hit: readonly number[];
}

/** A shockwave ring (D-134): grows once `startsIn` runs out; hits each player once. */
export interface Wave {
  at: Vec2;
  radius: number;
  gap: number;
  startsIn: number;
  /** Its arena: players outside are not hit. */
  area?: Rect;
  damage: number;
  ownerId: number;
  hit: readonly number[];
}

/** Floor plates (D-134): all of `area` but the safe lane bursts when `burstsIn` runs out. */
export interface PlateBurst {
  area: Rect;
  lane: number;
  burstsIn: number;
  /** After the burst: how much longer it is drawn burning. */
  burnLeft: number;
  damage: number;
  ownerId: number;
}

/**
 * A fire jet's beam (D-133): fire from `from` to `to`, `width` wide, for
 * `remaining` seconds; it burns each player once.
 */
export interface Beam {
  from: Vec2;
  to: Vec2;
  width: number;
  damage: number;
  remaining: number;
  /** Players it has already burned. */
  hit: readonly number[];
  /** Seconds of warning before it burns (a Storm Caller's arc, D-139). */
  startsIn?: number;
  /** The enemy whose beam it is (its hits are that enemy's); absent: a room's fire jet. */
  ownerId?: number;
}

/** A warning circle that damages living players inside it when it lands. */
export interface Hazard {
  position: Vec2;
  radius: number;
  damage: number;
  /** Seconds until it lands. */
  landsIn: number;
  /** The enemy that made it (-1 for a room's hazard). */
  ownerId: number;
  /** Set for a room's hazard (D-110): its hits are hazard hits. */
  hazard?: HazardKind;
  /** An icicle (D-136): it leaves frost where it lands. */
  frost?: { radius: number; seconds: number };
  /** A bomb (D-115): it leaves burning floor where it lands. */
  fire?: { seconds: number; tickSeconds: number; damage: number };
  /** Drawn as a rune (the Lich's, D-125). */
  rune?: boolean;
  /** Drawn as a molten boulder (the Elder Dragon's meteors, D-140). */
  meteor?: boolean;
}

/** Burning floor (D-115): hurts every player inside, each tick, until it goes out. */
export interface Fire {
  position: Vec2;
  radius: number;
  /** Seconds until it goes out. */
  remaining: number;
  /** Seconds until it burns again. */
  nextTick: number;
  tickSeconds: number;
  damage: number;
  /** The bomber that made it (named on a death). */
  ownerId: number;
  /** A room's fire (a slag spill's, D-133): its burns are the room's hits. */
  hazard?: HazardKind;
}

/** An enemy to add to the simulation (dungeon room waves, boss summons). */
export interface EnemySpawn {
  kind: EnemyKind;
  at: Vec2;
  roomId: string | null;
  /** Dies with this enemy (summons). */
  summonerId?: number | null;
  /** A slinger that leads its shots (D-109). */
  leads?: boolean;
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
  /** Buffs to give, by player (the caster or allies). */
  buffs?: { playerId: number; kind: keyof PlayerBuffs; buff: Buff }[];
  /** HP to restore, by player. */
  heals?: { playerId: number; amount: number }[];
}

/**
 * The effect of casting `ability` toward `target` (an offset from the
 * player); null when it cannot be aimed (nothing is spent then). Damage
 * scales with the item tier (D-095), the caster's Attack (D-096), and
 * their buffs (D-098).
 */
function castAbility(
  ability: AbilityLoadout,
  caster: PlayerState,
  position: Vec2,
  target: Vec2,
  state: SimState,
): Cast | null {
  const ownerId = caster.id;
  const power = caster.combat.attackFactor * damageMultiplier(caster);
  switch (ability.kind) {
    case "arcaneBlast":
      return arcaneBlast(ability.tier, ownerId, position, target, power);
    case "volley":
      return volley(ability.tier, ownerId, position, target, power);
    case "chainLightning":
      return chainLightning(
        ability.tier,
        ownerId,
        position,
        target,
        power,
        state.enemies,
      );
    case "naturesReach":
      return naturesReach(ability.tier, ownerId, position, target, power);
    case "battleCry":
      return {
        buffs: [
          {
            playerId: ownerId,
            kind: "battleCry",
            buff: {
              remaining: BATTLE_CRY.seconds,
              bonus: battleCryBonus(ability.tier),
            },
          },
        ],
      };
    case "inspiration":
      return {
        buffs: state.players
          .filter(
            (p) =>
              isPlayerAlive(p) &&
              Math.hypot(
                p.position.x - position.x,
                p.position.y - position.y,
              ) <= INSPIRATION.radius,
          )
          .map((p) => ({
            playerId: p.id,
            kind: "inspiration" as const,
            buff: {
              remaining: INSPIRATION.seconds,
              bonus: inspirationBonus(ability.tier),
            },
          })),
        events: [
          {
            type: "blast",
            kind: "inspiration",
            playerId: ownerId,
            at: { ...position },
            radius: INSPIRATION.radius,
          },
        ],
      };
    case "curse":
      return curse(ability.tier, ownerId, position, target, state.enemies);
    case "guard":
      return {
        buffs: [
          {
            playerId: ownerId,
            kind: "guard",
            buff: {
              remaining: GUARD.seconds,
              bonus: guardReduction(ability.tier),
            },
          },
        ],
      };
    case "vanish":
      return {
        buffs: [
          {
            playerId: ownerId,
            kind: "vanish",
            buff: {
              remaining: vanishSeconds(ability.tier),
              bonus: VANISH.damageReduction,
            },
          },
        ],
      };
    case "healing": {
      const healed = state.players.filter(
        (p) =>
          isPlayerAlive(p) &&
          Math.hypot(p.position.x - position.x, p.position.y - position.y) <=
            HEALING.radius,
      );
      return {
        heals: healed.map((p) => ({
          playerId: p.id,
          amount: healingAmount(ability.tier, p.maxHp),
        })),
        events: [
          {
            type: "blast",
            kind: "heal",
            playerId: ownerId,
            at: { ...position },
            radius: HEALING.radius,
          },
          ...healed.map((p): SimEvent => ({
            type: "blast",
            kind: "healed",
            playerId: ownerId,
            at: { ...p.position },
            radius: 12,
          })),
        ],
      };
    }
  }
}

function arcaneBlast(
  tier: number,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  power: number,
): Cast {
  const offset = clampToRange(target, ARCANE_BLAST.range);
  return {
    blast: {
      ownerId,
      at: { x: position.x + offset.x, y: position.y + offset.y },
      radius: ARCANE_BLAST.radius,
      damage: arcaneBlastDamage(tier) * power,
    },
  };
}

function naturesReach(
  tier: number,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  power: number,
): Cast {
  const offset = clampToRange(target, NATURES_REACH.range);
  return {
    zone: {
      ownerId,
      at: { x: position.x + offset.x, y: position.y + offset.y },
      radius: NATURES_REACH.radius,
      remaining: NATURES_REACH.seconds,
      // The first pulse lands at once.
      pulseIn: 0,
      damage: naturesReachDamage(tier) * power,
    },
  };
}

/** Warlock Curse (D-098): every enemy in the area is cursed for 5 s. */
function curse(
  tier: number,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  enemies: readonly EnemyState[],
): Cast {
  const offset = clampToRange(target, CURSE.range);
  const at = { x: position.x + offset.x, y: position.y + offset.y };
  const mark = { remaining: CURSE.seconds, bonus: curseBonus(tier) };
  return {
    enemies: enemies.map((e) =>
      isHittable(e) &&
      Math.hypot(e.position.x - at.x, e.position.y - at.y) <= CURSE.radius
        ? { ...e, curse: mark }
        : e,
    ),
    events: [
      {
        type: "blast",
        kind: "curse",
        playerId: ownerId,
        at,
        radius: CURSE.radius,
      },
    ],
  };
}

/** Volley (D-097): an even fan around the aim. */
function volley(
  tier: number,
  ownerId: number,
  position: Vec2,
  target: Vec2,
  power: number,
): Cast | null {
  const length = Math.hypot(target.x, target.y);
  if (!(length > 1e-9)) return null;
  const aim = { x: target.x / length, y: target.y / length };
  const step = (VOLLEY.spreadDegrees * Math.PI) / 180 / (VOLLEY.arrows - 1);
  const first = -((VOLLEY.arrows - 1) / 2) * step;
  const damage = volleyArrowDamage(tier) * power;
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
  power: number,
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
      if (!isHittable(e) || hit.has(e.id) || (also && !also(e))) continue;
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
  let damage = chainLightningDamage(tier) * power;
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
      damage: result.damage,
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
      /** A further enemy hit by the same swing, burst, or arrow: not another accurate shot (D-141). */
      extra?: boolean;
    }
  /** A melee swing (D-141): its arc, for drawing and for accuracy. */
  | {
      type: "swing";
      playerId: number;
      at: Vec2;
      angle: number;
      arcDegrees: number;
      reach: number;
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
  /** Damage from a room hazard (D-110), not an enemy. */
  | {
      type: "hazardHit";
      playerId: number;
      hazard: HazardKind;
      damage: number;
      position: Vec2;
    }
  | { type: "playerDied"; playerId: number }
  /** An ability landed (drawn by every client). */
  | {
      type: "blast";
      kind: BlastKind;
      /** The caster, or GOBLIN_BLAST_BY for a goblin's (chant, sweep). */
      playerId: number;
      at: Vec2;
      radius: number;
    }
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
    sludge: [],
    fires: [],
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
      s.leads ?? false,
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
  weaponType: WeaponType | null = null,
): PlayerState {
  const combat = combatFor(stats, weaponDamage(weaponTier), weaponType);
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
    buffs: {},
    velocity: { x: 0, y: 0 },
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
  weaponType: WeaponType | null = null,
): SimState {
  const others = state.players.filter((p) => p.id !== id);
  return {
    ...state,
    players: [
      ...others,
      newPlayer(id, spawn, stats, weaponTier, ability, weaponType),
    ],
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
    .filter(isHittable)
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
  // Sludge slows the player wading in it (D-113), and so does deep tide
  // water (D-135); prediction runs this too.
  const clock = state.clock ?? 0;
  const inSludge = (state.sludge ?? []).some((r) =>
    insideRect(r, player.position),
  );
  const inDeep =
    (state.tides ?? []).length > 0 &&
    tideAt(clock) === "deep" &&
    (state.tides ?? []).some((r) => insideRect(r, player.position));
  // Frost slows too (D-136).
  const frozen = onFrost(player.position, clock, state.frost ?? []);
  const slow = Math.min(
    inSludge ? SLUDGE.speedFactor : 1,
    inDeep ? TIDES.speedFactor : 1,
    frozen ? FROST.speedFactor : 1,
  );
  const walked = stepMovement(
    player.position,
    input.move,
    PLAYER_BODY,
    walls,
    dtSeconds,
    player.combat.moveSpeed * slow,
  );
  // Water drags them on top (D-135): an eel-priest's pull, whirlpools.
  const drift = {
    ...waterDrift(
      walked,
      clock,
      player.pull,
      state.whirlpools ?? [],
      dtSeconds,
    ),
  };
  // Gusts push too (D-139).
  const gust = windDrift(walked, clock, state.winds ?? []);
  drift.x += gust.x;
  drift.y += gust.y;
  const driftSpeed = Math.hypot(drift.x, drift.y);
  const position =
    driftSpeed > 1e-9
      ? stepMovement(
          walked,
          { x: drift.x / driftSpeed, y: drift.y / driftSpeed },
          PLAYER_BODY,
          walls,
          dtSeconds,
          driftSpeed,
        )
      : walked;
  const pulling = player.pull && clock >= player.pull.from - 1e-9;
  const pullLeft = player.pull
    ? pulling
      ? player.pull.left - dtSeconds
      : player.pull.left
    : 0;
  // A vanished player's automatic shots hold fire, so Vanish lasts in the
  // auto modes; a click still shoots and ends it (D-101).
  const holdFire = isVanished(player) && input.fire.auto === true;
  const cooldown = stepFireCooldown(
    player.fireCooldown,
    dtSeconds,
    input.fire.trigger && aim !== null && !holdFire,
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
    cast = castAbility(ability, player, position, target, state);
    if (cast) {
      mp -= ABILITIES[ability.kind].mpCost;
      abilityCooldown = ABILITIES[ability.kind].cooldownSeconds;
    }
  }

  const updated: PlayerState = {
    ...withoutPull(player),
    position,
    velocity: {
      x: (position.x - player.position.x) / dtSeconds,
      y: (position.y - player.position.y) / dtSeconds,
    },
    fireCooldown: cooldown.remaining,
    mp,
    abilityCooldown,
    // The pull counts down only while it pulls; spent, it is gone (D-135).
    ...(player.pull && pullLeft > 1e-9
      ? { pull: { ...player.pull, left: pullLeft } }
      : {}),
  };
  // Shooting or casting anything (but Vanish itself) ends Vanish (D-100).
  if (
    updated.buffs.vanish &&
    (cooldown.fired || (cast && ability?.kind !== "vanish"))
  ) {
    updated.buffs = Object.fromEntries(
      Object.entries(updated.buffs).filter(([key]) => key !== "vanish"),
    );
  }
  // Buffs from the cast land on the caster or on allies (D-098); heals
  // restore HP, never above max (D-100).
  const buffed = (p: PlayerState): PlayerState => {
    const gain = cast?.buffs?.find((b) => b.playerId === p.id);
    const heal = cast?.heals?.find((h) => h.playerId === p.id);
    let out = gain
      ? { ...p, buffs: { ...p.buffs, [gain.kind]: gain.buff } }
      : p;
    if (heal) out = { ...out, hp: Math.min(out.maxHp, out.hp + heal.amount) };
    return out;
  };
  let next: SimState = {
    ...state,
    players: state.players.map((p) => buffed(p.id === playerId ? updated : p)),
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
  // The weapon's attack (D-141): a shot, or a swing that cuts at once.
  // Prediction runs this too (with no enemies, so a swing only draws).
  if (cooldown.fired && aim) {
    const attack = attackOf(player.combat.weapon);
    const damage =
      player.combat.shotDamage * attack.damage * damageMultiplier(player);
    if (attack.kind === "shot") {
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
            speed: attack.speed,
            remaining: attack.range,
            damage,
            size: attack.size,
            ...(attack.pierce ? { pierce: true, pierced: [] } : {}),
            ...(attack.burst ? { burst: attack.burst } : {}),
          },
        ],
        nextProjectileId: id + 1,
      };
      events.push({ type: "shot", playerId, projectileId: id });
    } else {
      events.push({
        type: "swing",
        playerId,
        at: { ...position },
        angle: Math.atan2(aim.y, aim.x),
        arcDegrees: attack.arcDegrees,
        reach: attack.reach,
      });
      let first = true;
      const enemies = [...next.enemies];
      enemies.forEach((target, i) => {
        if (!isHittable(target)) return;
        if (!swingCatches(attack, position, aim, target.position, target.size))
          return;
        // A shield stops a swing from the front, as it stops a shot (D-122).
        const dx = target.position.x - position.x;
        const dy = target.position.y - position.y;
        const len = Math.hypot(dx, dy) || 1;
        if (shieldBlocks(target, { x: dx / len, y: dy / len })) {
          events.push({
            type: "blast",
            kind: "shieldBlock",
            playerId: GOBLIN_BLAST_BY,
            at: { ...target.position },
            radius: 6,
          });
          return;
        }
        const result = damageEnemy(target, damage);
        enemies[i] = result.enemy;
        events.push({
          type: "hit",
          enemyId: target.id,
          playerId,
          damage: result.damage,
          position: { ...target.position },
          // One swing counts once towards accuracy, however many it cuts.
          ...(first ? {} : { extra: true }),
        });
        first = false;
        if (result.defeated) {
          events.push({ type: "defeated", enemyId: target.id, playerId });
        }
      });
      next = { ...next, enemies };
    }
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
 *    bullets → any living player's 31×31 hurtbox at their server position,
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
  /** The server's grid for `walls` (D-114); without it, enemies only corner-steer. */
  navigator?: Waypoints,
  /** A room's holes, where the Warchief's war cry calls goblins from (D-117). */
  holesOf?: (roomId: string) => readonly Vec2[],
  /** A room's floor: the Forgemaster's arena (D-134). */
  boundsOf?: (roomId: string) => Rect | undefined,
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
    const curse =
      scaled.curse && scaled.curse.remaining - dtSeconds > 1e-9
        ? { ...scaled.curse, remaining: scaled.curse.remaining - dtSeconds }
        : undefined;
    if (scaled.slowed === slowed && !scaled.curse && !curse) return scaled;
    return { ...scaled, slowed, curse };
  });
  const projectiles = [...state.projectiles];
  let nextId = state.nextProjectileId;

  // 2. Enemies act. Living players are re-read for each enemy, so a
  // player killed by one enemy is not targeted by the next.
  const summons: EnemySpawn[] = [];
  const newHazards: Hazard[] = [];
  const allies = state.enemies.filter(isAlive);
  // Enemies walk round lava as if it were wall (D-130).
  const enemyWalls =
    state.lava && state.lava.length > 0 ? [...walls, ...state.lava] : walls;
  const chants: { at: Vec2; radius: number }[] = [];
  /** Bone piles necromancers raise this tick (D-122). */
  const raises: number[] = [];
  /** Bellows-keepers' heal pulses this tick (D-132). */
  const stokes: { at: Vec2; radius: number; share: number }[] = [];
  /** The Forgemaster's new shockwaves and plates this tick (D-134). */
  const newWaves: Wave[] = [];
  const newPlates: PlateBurst[] = [];
  /** The Tide Priest's new whirlpools and surges, and eel-priests' pulls, this tick (D-135). */
  const clock = state.clock ?? 0;
  const newWhirlpools: Whirlpool[] = [];
  const newSurges: Surge[] = [];
  /** The Storm Caller's arcs this tick (D-139). */
  const newArcs: Beam[] = [];
  /** Blade arms carried by enemies this tick (D-137). */
  const carried: LiveBlade[] = [];
  /** Frost and breath cones made this tick (D-136). */
  const newFrost: FrostPatch[] = [];
  const newCones: Cone[] = [];
  const pulls: { playerId: number; pull: Pull & { by: number } }[] = [];
  const context = {
    allies: () => allies,
    aliveSummons: (id: number) =>
      state.enemies.filter((e) => e.summonerId === id && isAlive(e)).length,
    ...(navigator
      ? {
          waypoint: (from: Vec2, to: Vec2, half: number) =>
            navigator.next(from, to, half),
        }
      : {}),
    ...(holesOf ? { holesOf } : {}),
    ...(boundsOf ? { boundsOf } : {}),
  };
  enemies = enemies.map((enemy) => {
    // A vanished player is out of sight: not aimed at, chased, or touched.
    const action = enemyAct(
      enemy,
      alivePlayers().filter((p) => !isVanished(p)),
      enemyWalls,
      dtSeconds,
      context,
    );
    for (const s of action.summons) {
      summons.push({ ...s, roomId: enemy.roomId, summonerId: enemy.id });
    }
    if (action.chant) chants.push(action.chant);
    if (action.sweep) {
      events.push({
        type: "blast",
        kind: action.sweep.warning ? "sweepWarning" : "sweep",
        playerId: GOBLIN_BLAST_BY,
        at: { ...action.sweep.at },
        radius: action.sweep.radius,
      });
    }
    if (action.slam) {
      events.push({
        type: "blast",
        kind: action.slam.warning ? "slamWarning" : "slam",
        playerId: GOBLIN_BLAST_BY,
        at: { ...action.slam.at },
        radius: action.slam.radius,
      });
    }
    if (action.raise !== undefined) raises.push(action.raise);
    if (action.stoke) stokes.push(action.stoke);
    if (action.wave) {
      newWaves.push({
        at: { ...action.wave.at },
        radius: 0,
        gap: action.wave.gap,
        startsIn: action.wave.startsIn,
        ...(action.wave.area ? { area: action.wave.area } : {}),
        damage: FORGEMASTER.wave.damage,
        ownerId: enemy.id,
        hit: [],
      });
    }
    if (action.pull) {
      pulls.push({
        playerId: action.pull.playerId,
        pull: {
          to: { ...action.pull.to },
          from: clock + action.pull.startsIn,
          speed: EELPRIEST.pull.speed,
          left: EELPRIEST.pull.seconds,
          by: enemy.id,
        },
      });
    }
    if (action.arc) {
      newArcs.push({
        from: { ...action.arc.from },
        to: { ...action.arc.to },
        width: STORMCALLER.arcs.width,
        damage: STORMCALLER.arcs.damage,
        remaining: STORMCALLER.arcs.seconds,
        hit: [],
        startsIn: STORMCALLER.arcs.warnSeconds,
        ownerId: enemy.id,
      });
    }
    for (const b of action.blades ?? []) {
      const turn = (b.degreesPerSecond * Math.PI) / 180;
      carried.push({
        pivot: { ...action.enemy.position },
        length: b.length,
        angle:
          ((b.phaseDegrees * Math.PI) / 180 + turn * clock) % (2 * Math.PI),
        speed: turn,
        damage: b.damage,
        ownerId: enemy.id,
      });
    }
    for (const f of action.frost ?? []) {
      newFrost.push({
        at: { ...f.at },
        radius: f.radius,
        from: clock,
        until: clock + f.seconds,
      });
    }
    if (action.cone) {
      const c = action.cone;
      newCones.push({
        at: { ...c.at },
        angle: c.angle,
        range: c.range,
        halfAngle: c.halfAngle,
        startsIn: c.startsIn,
        shownLeft: 0.25,
        damage: c.damage,
        ownerId: enemy.id,
        ...(c.frost ? { frost: c.frost } : {}),
        ...(c.fire ? { fire: c.fire } : {}),
        ...(c.area ? { area: c.area } : {}),
      });
    }
    if (action.gust) {
      // The Elder Dragon's wing gust (D-140): a short push away, after a warning.
      const from = clock + DRAGON.gust.warnSeconds;
      newWhirlpools.push({
        at: { ...action.gust.at },
        radius: action.gust.radius,
        from,
        until: from + DRAGON.gust.seconds,
        nextTick: Number.POSITIVE_INFINITY,
        damage: 0,
        ownerId: enemy.id,
        dragSpeed: DRAGON.gust.dragSpeed,
      });
    }
    for (const at of action.whirlpools ?? []) {
      const from = clock + WHIRLPOOL.warnSeconds;
      newWhirlpools.push({
        at: { ...at },
        radius: WHIRLPOOL.radius,
        from,
        until: from + WHIRLPOOL.seconds,
        nextTick: from,
        damage: WHIRLPOOL.damage,
        ownerId: enemy.id,
      });
    }
    if (action.surge) {
      const s = action.surge;
      newSurges.push({
        area: s.area,
        axis: s.axis,
        dir: s.dir,
        pos: surgeStart(s.area, s.axis, s.dir),
        gaps: s.gaps,
        startsIn: SURGE.warnSeconds,
        damage: SURGE.damage,
        ownerId: enemy.id,
        hit: [],
      });
    }
    if (action.plates) {
      newPlates.push({
        area: action.plates.area,
        lane: action.plates.lane,
        burstsIn: FORGEMASTER.plates.warnSeconds,
        burnLeft: FORGEMASTER.plates.burnSeconds,
        damage: FORGEMASTER.plates.damage,
        ownerId: enemy.id,
      });
    }
    if (action.explosion) {
      events.push({
        type: "blast",
        kind: "explosion",
        playerId: GOBLIN_BLAST_BY,
        at: { ...action.explosion.at },
        radius: action.explosion.radius,
      });
    }
    // A shaman's chant (D-115): everything this goblin deals is stronger.
    const boost = (enemy.chant ?? 0) > 0 ? 1 + SHAMAN.damageBonus : 1;
    for (const h of action.hazards) {
      newHazards.push({
        position: h.at,
        radius: h.radius,
        damage: h.damage * boost,
        landsIn: h.delaySeconds,
        ownerId: enemy.id,
        ...(h.fire
          ? { fire: { ...h.fire, damage: h.fire.damage * boost } }
          : {}),
        ...(h.rune ? { rune: true } : {}),
        ...(h.meteor ? { meteor: true } : {}),
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
        damage: spec.damage * boost,
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
          ? damagePlayer(pl, enemy.id, damage * boost, pl.position, events)
          : pl,
      );
    }
    // A chant runs down.
    const left = (action.enemy.chant ?? 0) - dtSeconds;
    if (left > 1e-9) return { ...action.enemy, chant: left };
    return action.enemy.chant === undefined
      ? action.enemy
      : (Object.fromEntries(
          Object.entries(action.enemy).filter(([key]) => key !== "chant"),
        ) as unknown as EnemyState);
  });
  // Raised bone piles stand up whole; their next death is final (D-122).
  for (const id of raises) {
    const pile = enemies.find((e) => e.id === id);
    if (!pile || !isPile(pile)) continue;
    enemies = enemies.map((e) =>
      e.id === id
        ? {
            ...e,
            hp: e.maxHp,
            attackCooldown: SKELETON.contactCooldownSeconds / 2,
            ai: { kind: "skeleton", pile: null, revived: true },
          }
        : e,
    );
    events.push({
      type: "blast",
      kind: "raise",
      playerId: GOBLIN_BLAST_BY,
      at: { ...pile.position },
      radius: 18,
    });
  }
  // Bellows-keepers heal everyone in their circle but themselves, each
  // other, bone piles, and bosses (D-132).
  for (const k of stokes) {
    enemies = enemies.map((e) =>
      isAlive(e) &&
      e.kind !== "bellows" &&
      !isPile(e) &&
      !BOSS_KINDS.includes(e.kind) &&
      e.hp < e.maxHp &&
      Math.hypot(e.position.x - k.at.x, e.position.y - k.at.y) <= k.radius
        ? { ...e, hp: Math.min(e.maxHp, e.hp + e.maxHp * k.share) }
        : e,
    );
    events.push({
      type: "blast",
      kind: "stoke",
      playerId: GOBLIN_BLAST_BY,
      at: { ...k.at },
      radius: k.radius,
    });
  }
  // Chants land on every other goblin inside their circle (not shamans).
  for (const c of chants) {
    enemies = enemies.map((e) =>
      isAlive(e) &&
      e.kind !== "shaman" &&
      Math.hypot(e.position.x - c.at.x, e.position.y - c.at.y) <= c.radius
        ? { ...e, chant: SHAMAN.chantSeconds }
        : e,
    );
    events.push({
      type: "blast",
      kind: "chant",
      playerId: GOBLIN_BLAST_BY,
      at: { ...c.at },
      radius: c.radius,
    });
  }
  let nextEnemyId = state.nextEnemyId;
  if (summons.length > 0) {
    const added = spawnEnemies({ ...state, enemies, nextEnemyId }, summons);
    enemies = [...added.enemies];
    nextEnemyId = added.nextEnemyId;
  }

  // 2a. Lava burns every player whose hurtbox touches it (D-130).
  let lavaIn = state.lavaIn ?? LAVA.tickSeconds;
  if (state.lava && state.lava.length > 0) {
    lavaIn -= dtSeconds;
    if (lavaIn <= 1e-9) {
      lavaIn += LAVA.tickSeconds;
      players = players.map((pl) => {
        const box = boxAround(pl.position, PLAYER_HEALTH.hurtboxSize);
        if (
          !isPlayerAlive(pl) ||
          !state.lava!.some((l) => overlapsBox(l, box))
        ) {
          return pl;
        }
        return hazardDamage(pl, "lava", LAVA.damage, events);
      });
    }
  }

  // 2a. Fire jets' beams burn every player they touch, each once (D-133).
  const beams: Beam[] = [];
  for (const beam of [...(state.beams ?? []), ...newArcs]) {
    if ((beam.startsIn ?? 0) > 1e-9) {
      beams.push({
        ...beam,
        startsIn: Math.max(0, beam.startsIn! - dtSeconds),
      });
      continue;
    }
    const strip = beamBox(beam);
    const hit = [...beam.hit];
    players = players.map((pl) => {
      if (
        !isPlayerAlive(pl) ||
        hit.includes(pl.id) ||
        !overlapsBox(strip, boxAround(pl.position, PLAYER_HEALTH.hurtboxSize))
      ) {
        return pl;
      }
      hit.push(pl.id);
      return beam.ownerId !== undefined
        ? damagePlayer(pl, beam.ownerId, beam.damage, pl.position, events)
        : hazardDamage(pl, "jets", beam.damage, events);
    });
    const remaining = beam.remaining - dtSeconds;
    if (remaining > 1e-9) beams.push({ ...beam, remaining, hit });
  }

  // 2a. The Forgemaster's shockwaves grow from the hammer once the windup
  // ends, hitting each player in their band (outside the gap) once (D-134).
  const waves: Wave[] = [];
  for (const w of [...(state.waves ?? []), ...newWaves]) {
    const waiting = w.startsIn > 1e-9;
    const startsIn = waiting ? Math.max(0, w.startsIn - dtSeconds) : 0;
    const radius = waiting
      ? w.radius
      : w.radius + FORGEMASTER.wave.speed * dtSeconds;
    const hit = [...w.hit];
    if (!waiting) {
      players = players.map((pl) => {
        if (
          !isPlayerAlive(pl) ||
          hit.includes(pl.id) ||
          (w.area && !inside(w.area, pl.position)) ||
          !waveHits({ at: w.at, radius, gap: w.gap }, pl.position)
        ) {
          return pl;
        }
        hit.push(pl.id);
        return damagePlayer(pl, w.ownerId, w.damage, pl.position, events);
      });
    }
    if (radius <= FORGEMASTER.wave.maxRadius) {
      waves.push({ ...w, radius, startsIn, hit });
    }
  }
  // Eel-priests' tethers take hold (D-135); a pull whose eel-priest is
  // dead before it starts is broken.
  const living = new Set(enemies.filter(isAlive).map((e) => e.id));
  players = players.map((pl) => {
    const fresh = pulls.find((p) => p.playerId === pl.id)?.pull;
    if (fresh && isPlayerAlive(pl)) return { ...pl, pull: fresh };
    if (pl.pull && !living.has(pl.pull.by) && clock < pl.pull.from - 1e-9) {
      return withoutPull(pl);
    }
    return pl;
  });
  // Blade arms cut whoever they touch, at most once a second each (D-137).
  const blades: LiveBlade[] = [
    ...(state.roomBlades ?? []).map((b) => {
      const turn = (b.degreesPerSecond * Math.PI) / 180;
      return {
        pivot: b.pivot,
        length: b.length,
        angle: (turn * clock) % (2 * Math.PI),
        speed: turn,
        damage: BLADES.damage,
        ownerId: -1,
      };
    }),
    ...carried,
  ];
  if (blades.length > 0) {
    players = players.map((pl) => {
      if (!isPlayerAlive(pl) || (pl.bladeSafeUntil ?? 0) > clock + 1e-9)
        return pl;
      const cut = blades.find((b) => bladeHits(b, pl.position));
      if (!cut) return pl;
      const safe = { ...pl, bladeSafeUntil: clock + BLADES.hitCooldownSeconds };
      return cut.ownerId < 0
        ? hazardDamage(safe, "blades", cut.damage, events)
        : damagePlayer(safe, cut.ownerId, cut.damage, safe.position, events);
    });
  }
  // Breath cones land once their warning ends (D-136), leaving frost or fire.
  const cones: Cone[] = [];
  const coneFires: Fire[] = [];
  for (const c of [...(state.cones ?? []), ...newCones]) {
    if (c.startsIn > 1e-9) {
      const startsIn = c.startsIn - dtSeconds;
      if (startsIn <= 1e-9) {
        players = players.map((pl) =>
          isPlayerAlive(pl) &&
          (!c.area || inside(c.area, pl.position)) &&
          coneHits(c, pl.position)
            ? damagePlayer(pl, c.ownerId, c.damage, pl.position, events)
            : pl,
        );
        // Fire breath leaves burning floor along its length (D-140).
        if (c.fire) {
          for (const share of [0.35, 0.65, 0.92]) {
            const d = c.range * share;
            coneFires.push({
              position: {
                x: c.at.x + Math.cos(c.angle) * d,
                y: c.at.y + Math.sin(c.angle) * d,
              },
              radius: c.fire.radius,
              remaining: c.fire.seconds,
              nextTick: c.fire.tickSeconds,
              tickSeconds: c.fire.tickSeconds,
              damage: c.fire.damage,
              ownerId: c.ownerId,
            });
          }
        }
        if (c.frost) {
          const mid = c.range * 0.6;
          newFrost.push({
            at: {
              x: c.at.x + Math.cos(c.angle) * mid,
              y: c.at.y + Math.sin(c.angle) * mid,
            },
            radius: c.frost.radius,
            from: clock,
            until: clock + c.frost.seconds,
          });
        }
      }
      cones.push({ ...c, startsIn: Math.max(0, startsIn) });
      continue;
    }
    const shownLeft = c.shownLeft - dtSeconds;
    if (shownLeft > 1e-9) cones.push({ ...c, shownLeft });
  }
  // Whirlpools' cores hurt each tick while they turn (D-135).
  const whirlpools: Whirlpool[] = [];
  for (const w of [...(state.whirlpools ?? []), ...newWhirlpools]) {
    let nextTick = w.nextTick;
    if (whirlpoolActive(w, clock) && clock >= nextTick - 1e-9) {
      nextTick += WHIRLPOOL.tickSeconds;
      players = players.map((pl) =>
        isPlayerAlive(pl) &&
        circleHitsPlayer(w.at, WHIRLPOOL.coreRadius, pl.position)
          ? damagePlayer(pl, w.ownerId, w.damage, pl.position, events)
          : pl,
      );
    }
    if (clock + dtSeconds < w.until - 1e-9) whirlpools.push({ ...w, nextTick });
  }
  // Tidal surges sweep their arena, hitting each player outside the gaps once.
  const surges: Surge[] = [];
  for (const s of [...(state.surges ?? []), ...newSurges]) {
    if (s.startsIn > 1e-9) {
      surges.push({ ...s, startsIn: Math.max(0, s.startsIn - dtSeconds) });
      continue;
    }
    const moved = { ...s, pos: s.pos + s.dir * SURGE.speed * dtSeconds };
    const hit = [...s.hit];
    players = players.map((pl) => {
      if (
        !isPlayerAlive(pl) ||
        hit.includes(pl.id) ||
        !surgeHits(moved, pl.position)
      ) {
        return pl;
      }
      hit.push(pl.id);
      return damagePlayer(pl, s.ownerId, s.damage, pl.position, events);
    });
    if (!surgeDone(moved)) surges.push({ ...moved, hit });
  }
  // Floor plates glow, then burst on every player touching the burning floor.
  const plates: PlateBurst[] = [];
  for (const p of [...(state.plates ?? []), ...newPlates]) {
    if (p.burstsIn > 1e-9) {
      const burstsIn = p.burstsIn - dtSeconds;
      if (burstsIn <= 1e-9) {
        const strips = burningStrips(p.area, p.lane);
        players = players.map((pl) => {
          const box = boxAround(pl.position, PLAYER_HEALTH.hurtboxSize);
          return isPlayerAlive(pl) && strips.some((s) => overlapsBox(s, box))
            ? damagePlayer(pl, p.ownerId, p.damage, pl.position, events)
            : pl;
        });
      }
      plates.push({ ...p, burstsIn: Math.max(0, burstsIn) });
      continue;
    }
    const burnLeft = p.burnLeft - dtSeconds;
    if (burnLeft > 1e-9) plates.push({ ...p, burnLeft });
  }

  // 2b. Hazards: existing ones count down and land; new ones wait a full delay.
  const hazards: Hazard[] = [];
  // Fires from earlier bombs, plus any lit this tick.
  const fires: Fire[] = [...(state.fires ?? []), ...coneFires];
  for (const h of state.hazards) {
    const landsIn = h.landsIn - dtSeconds;
    if (landsIn > 1e-9) {
      hazards.push({ ...h, landsIn });
      continue;
    }
    players = players.map((pl) => {
      if (
        !isPlayerAlive(pl) ||
        // Any overlap with the hurtbox counts (D-127).
        !circleHitsPlayer(h.position, h.radius, pl.position)
      ) {
        return pl;
      }
      const before = events.length;
      const hit = damagePlayer(pl, h.ownerId, h.damage, pl.position, events);
      // A room's boulder is not an enemy's hit (D-110).
      const reported = events[before];
      if (h.hazard && reported?.type === "playerHit") {
        events[before] = {
          type: "hazardHit",
          playerId: pl.id,
          hazard: h.hazard,
          damage: reported.damage,
          position: reported.position,
        };
      }
      return hit;
    });
    // A rune's burst flashes for everyone (D-123), and so does lightning (D-139).
    if (h.hazard === "runes" || h.hazard === "lightning") {
      events.push({
        type: "blast",
        kind: "rune",
        playerId: GOBLIN_BLAST_BY,
        at: { ...h.position },
        radius: h.radius,
      });
    }
    // An icicle leaves frost (D-136).
    if (h.frost) {
      newFrost.push({
        at: { ...h.position },
        radius: h.frost.radius,
        from: clock,
        until: clock + h.frost.seconds,
      });
    }
    // A bomb leaves burning floor (D-115).
    if (h.fire) {
      fires.push({
        position: { ...h.position },
        radius: h.radius,
        remaining: h.fire.seconds,
        nextTick: h.fire.tickSeconds,
        tickSeconds: h.fire.tickSeconds,
        damage: h.fire.damage,
        ownerId: h.ownerId,
        ...(h.hazard ? { hazard: h.hazard } : {}),
      });
    }
  }
  hazards.push(...newHazards);
  // Burning floor hurts whoever stands in it, every tick of the fire.
  const burning: Fire[] = [];
  for (const f of fires) {
    const remaining = f.remaining - dtSeconds;
    let nextTick = f.nextTick - dtSeconds;
    if (nextTick <= 1e-9) {
      nextTick += f.tickSeconds;
      players = players.map((pl) =>
        !isPlayerAlive(pl) ||
        !circleHitsPlayer(f.position, f.radius, pl.position)
          ? pl
          : f.hazard
            ? hazardDamage(pl, f.hazard, f.damage, events)
            : damagePlayer(pl, f.ownerId, f.damage, pl.position, events),
      );
    }
    if (remaining > 1e-9) burning.push({ ...f, remaining, nextTick });
  }

  // 2c. Blasts cast since the last step hit every living enemy in their
  // area once (D-096), credited to the caster like a shot.
  for (const b of state.blasts) {
    events.push({
      type: "blast",
      kind: "arcaneBlast",
      playerId: b.ownerId,
      at: b.at,
      radius: b.radius,
    });
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !isHittable(e)) continue;
      if (Math.hypot(e.position.x - b.at.x, e.position.y - b.at.y) > b.radius) {
        continue;
      }
      const result = damageEnemy(e, b.damage);
      enemies[i] = result.enemy;
      events.push({
        type: "hit",
        enemyId: e.id,
        playerId: b.ownerId,
        damage: result.damage,
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
        if (!e || !isHittable(e)) continue;
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
          damage: result.damage,
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
  /** The staff's orb bursting where it stopped (D-141): every hittable enemy in reach, once. */
  const burstAt = (p: Projectile, at: Vec2) => {
    const radius = p.burst ?? 0;
    events.push({
      type: "blast",
      kind: "burst",
      playerId: p.ownerId,
      at: { ...at },
      radius,
    });
    let first = true;
    enemies = enemies.map((e) => {
      if (!isHittable(e)) return e;
      if (
        Math.hypot(e.position.x - at.x, e.position.y - at.y) >
        radius + e.size / 2
      )
        return e;
      const result = damageEnemy(e, p.damage);
      events.push({
        type: "hit",
        enemyId: e.id,
        playerId: p.ownerId,
        damage: result.damage,
        position: { ...e.position },
        ...(first ? {} : { extra: true }),
      });
      first = false;
      if (result.defeated)
        events.push({ type: "defeated", enemyId: e.id, playerId: p.ownerId });
      return result.enemy;
    });
  };
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
      if (p.burst) burstAt(p, outcome.position);
    } else if (outcome.kind === "expired") {
      if (p.burst) burstAt(p, outcome.position);
    } else if (outcome.kind === "hit" && p.owner === "enemy") {
      players = players.map((pl) => {
        if (pl.id !== outcome.targetId) return pl;
        const before = events.length;
        const hit = damagePlayer(
          pl,
          p.ownerId,
          p.damage,
          outcome.position,
          events,
        );
        // A trap's arrow is the room's hit, not an enemy's (D-113).
        const reported = events[before];
        if (p.hazard && reported?.type === "playerHit") {
          events[before] = {
            type: "hazardHit",
            playerId: pl.id,
            hazard: p.hazard,
            damage: reported.damage,
            position: reported.position,
          };
        }
        return hit;
      });
    } else if (outcome.kind === "hit") {
      const i = enemies.findIndex((e) => e.id === outcome.targetId);
      const target = enemies[i];
      if (!target) continue;
      // A grave knight's shield stops shots at its front (D-122).
      if (shieldBlocks(target, p.direction)) {
        events.push({
          type: "blast",
          kind: "shieldBlock",
          playerId: GOBLIN_BLAST_BY,
          at: { ...outcome.position },
          radius: 6,
        });
        continue;
      }
      // The staff's orb bursts on whatever it hits (D-141).
      if (p.burst) {
        burstAt(p, outcome.position);
        continue;
      }
      const result = damageEnemy(target, p.damage);
      enemies[i] = result.enemy;
      events.push({
        type: "hit",
        enemyId: target.id,
        playerId: p.ownerId,
        damage: result.damage,
        position: outcome.position,
        // An arrow's second and later victims are not further accurate shots.
        ...((p.pierced ?? []).length > 0 ? { extra: true } : {}),
      });
      // A piercing arrow flies on from where it hit, never hitting that
      // enemy again (D-141).
      if (p.pierce) {
        const moved = Math.hypot(
          outcome.position.x - p.position.x,
          outcome.position.y - p.position.y,
        );
        surviving.push({
          ...p,
          position: { ...outcome.position },
          remaining: Math.max(0, p.remaining - moved),
          pierced: [...(p.pierced ?? []), target.id],
        });
      }
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
      lavaIn,
      beams,
      waves,
      plates,
      clock: clock + dtSeconds,
      whirlpools,
      surges,
      cones,
      blades,
      // Frost lasts until its time (D-136).
      frost: [...(state.frost ?? []), ...newFrost].filter(
        (f) => clock + dtSeconds < f.until - 1e-9,
      ),
      hazards,
      fires: burning,
      blasts: [],
      zones,
    },
    events,
  };
}

/**
 * Always-on HP and MP regeneration (D-056, D-096), plus Inspiration's
 * extra HP (D-098); buffs run down. The dead do not regenerate.
 */
function regenerate(player: PlayerState, dtSeconds: number): PlayerState {
  if (!isPlayerAlive(player)) return player;
  const { combat } = player;
  const buffs = tickBuffs(player.buffs, dtSeconds);
  const hpPerSecond =
    combat.regenPerSecond +
    (player.buffs.inspiration ? INSPIRATION.regenPerSecond : 0);
  if (
    player.hp >= player.maxHp &&
    player.mp >= combat.maxMp &&
    buffs === player.buffs
  ) {
    return player;
  }
  return {
    ...player,
    hp: Math.min(player.maxHp, player.hp + hpPerSecond * dtSeconds),
    mp: Math.min(combat.maxMp, player.mp + combat.mpRegenPerSecond * dtSeconds),
    buffs,
  };
}

/** Counts buffs down; expired ones go. Unchanged buffs keep their object. */
function tickBuffs(buffs: PlayerBuffs, dtSeconds: number): PlayerBuffs {
  if (PLAYER_BUFF_KEYS.every((key) => !buffs[key])) return buffs;
  const next: PlayerBuffs = {};
  for (const key of PLAYER_BUFF_KEYS) {
    const b = buffs[key];
    if (b && b.remaining - dtSeconds > 1e-9) {
      next[key] = { ...b, remaining: b.remaining - dtSeconds };
    }
  }
  return next;
}

/**
 * Applies an enemy's hit to a player, reduced by their Defense (D-078),
 * recording playerHit with the damage actually taken (and playerDied on
 * the killing blow).
 */
/** Room hazards that can hurt a player (D-110). */
export const HAZARD_KINDS = [
  "rockfall",
  "arrows",
  "braziers",
  "runes",
  "lava",
  "jets",
  "slag",
  "icicles",
  "blades",
  "lightning",
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** Arrow traps' projectiles have this owner: no enemy has id 0 (D-113). */
export const TRAP_OWNER_ID = 0;

/** The `playerId` of a blast a goblin made (a chant, a sweep): no player is 0. */
export const GOBLIN_BLAST_BY = 0;

/**
 * An arrow trap fires (D-113): each arrow flies across the room like an
 * enemy bullet and stops at walls and obstacles; its hits are hazard hits.
 */
export function fireArrows(
  state: SimState,
  shots: readonly {
    at: Vec2;
    direction: Vec2;
    damage: number;
    fire?: boolean;
  }[],
  range: number,
): SimState {
  if (shots.length === 0) return state;
  let nextProjectileId = state.nextProjectileId;
  const arrows: Projectile[] = shots.map((s) => {
    // A spirit brazier's fireball is slower and bigger (D-123).
    const t = s.fire ? BRAZIERS : ARROWS;
    return {
      id: nextProjectileId++,
      owner: "enemy",
      ownerId: TRAP_OWNER_ID,
      position: { ...s.at },
      direction: { ...s.direction },
      speed: t.speed,
      remaining: range,
      damage: s.damage,
      size: t.size,
      hazard: s.fire ? "braziers" : "arrows",
    };
  });
  return {
    ...state,
    projectiles: [...state.projectiles, ...arrows],
    nextProjectileId,
  };
}

/**
 * Boulders start falling (D-110): each is a hazard that lands after
 * ROCKFALL.warnSeconds, like the Warlord's rockfall, but belongs to the
 * room, so its hits are hazard hits (a death names the rockfall).
 */
/**
 * Cursed runes burst (D-123): each a hazard landing on the next step, so
 * its hits are the room's (a death names the rune) and Defense counts.
 */
export function burstRunes(
  state: SimState,
  bursts: readonly { at: Vec2; radius: number; damage: number }[],
): SimState {
  if (bursts.length === 0) return state;
  return {
    ...state,
    hazards: [
      ...state.hazards,
      ...bursts.map((b) => ({
        position: { ...b.at },
        radius: b.radius,
        damage: b.damage,
        landsIn: 0,
        ownerId: -1,
        hazard: "runes" as const,
      })),
    ],
  };
}

export function dropBoulders(
  state: SimState,
  drops: readonly {
    at: Vec2;
    damage: number;
    slag?: boolean;
    icicle?: boolean;
    lightning?: boolean;
  }[],
): SimState {
  if (drops.length === 0) return state;
  return {
    ...state,
    hazards: [
      ...state.hazards,
      ...drops.map((d): Hazard =>
        d.lightning
          ? {
              position: { ...d.at },
              radius: LIGHTNING.radius,
              damage: d.damage,
              landsIn: LIGHTNING.warnSeconds,
              ownerId: -1,
              hazard: "lightning",
              // Drawn as a strike filling in, like the Lich's runes (D-139).
              rune: true,
            }
          : {
              position: { ...d.at },
              radius: ROCKFALL.radius,
              damage: d.damage,
              landsIn: ROCKFALL.warnSeconds,
              ownerId: -1,
              // A slag spill leaves burning floor where it lands (D-133);
              // an icicle leaves frost (D-136).
              ...(d.slag
                ? { hazard: "slag" as const, fire: { ...SLAG.fire } }
                : d.icicle
                  ? {
                      hazard: "icicles" as const,
                      frost: {
                        radius: ICICLES.frostRadius,
                        seconds: ICICLES.frostSeconds,
                      },
                    }
                  : { hazard: "rockfall" as const }),
            },
      ),
    ],
  };
}

/**
 * Fire jets fire (D-133): each beam runs from its nozzle along its
 * direction to the first wall or obstacle in `walls`, or the edge of its
 * room, and burns for JETS.beamSeconds.
 */
export function fireJets(
  state: SimState,
  jets: readonly { at: Vec2; direction: Vec2; damage: number; room?: Rect }[],
  walls: readonly Rect[],
): SimState {
  if (jets.length === 0) return state;
  const fired = jets.map((j): Beam => ({
    from: { ...j.at },
    to: beamEnd(j.at, j.direction, walls, j.room),
    width: JETS.width,
    damage: j.damage,
    remaining: JETS.beamSeconds,
    hit: [],
  }));
  return { ...state, beams: [...(state.beams ?? []), ...fired] };
}

/** How far a beam runs before something stops it (a beam with no room: 2,000 px at most). */
function beamEnd(
  from: Vec2,
  direction: Vec2,
  walls: readonly Rect[],
  room?: Rect,
): Vec2 {
  let reach = room ? (rayThrough(from, direction, room)?.exit ?? 0) : 2000;
  for (const w of walls) {
    const t = rayThrough(from, direction, w);
    if (t && t.exit > 0) reach = Math.min(reach, Math.max(0, t.enter));
  }
  return { x: from.x + direction.x * reach, y: from.y + direction.y * reach };
}

/** Where a ray from `from` enters and leaves `r` (in distances along `d`), if it crosses it. */
function rayThrough(
  from: Vec2,
  d: Vec2,
  r: Rect,
): { enter: number; exit: number } | null {
  let enter = -Infinity;
  let exit = Infinity;
  const axes: [number, number, number, number][] = [
    [from.x, d.x, r.x, r.x + r.width],
    [from.y, d.y, r.y, r.y + r.height],
  ];
  for (const [o, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / dir;
    const b = (hi - o) / dir;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit ? { enter, exit } : null;
}

/**
 * The strip a beam burns: its line, `width` across. Beams run along an
 * axis (nozzles fire straight out of a wall, and rooms turn by quarters).
 */
export function beamBox(beam: Pick<Beam, "from" | "to" | "width">): Rect {
  const { from, to, width } = beam;
  const half = width / 2;
  const across = Math.abs(to.x - from.x) < Math.abs(to.y - from.y);
  return across
    ? {
        x: from.x - half,
        y: Math.min(from.y, to.y),
        width,
        height: Math.abs(to.y - from.y),
      }
    : {
        x: Math.min(from.x, to.x),
        y: from.y - half,
        width: Math.abs(to.x - from.x),
        height: width,
      };
}

/**
 * A room hazard's hit (D-110): Defense counts as for any hit, and it is
 * reported as the room's (a death names the hazard), not an enemy's.
 */
function hazardDamage(
  player: PlayerState,
  hazard: HazardKind,
  damage: number,
  events: SimEvent[],
): PlayerState {
  const before = events.length;
  const hit = damagePlayer(player, -1, damage, player.position, events);
  const reported = events[before];
  if (reported?.type === "playerHit") {
    events[before] = {
      type: "hazardHit",
      playerId: player.id,
      hazard,
      damage: reported.damage,
      position: reported.position,
    };
  }
  return hit;
}

function damagePlayer(
  player: PlayerState,
  enemyId: number,
  hit: number,
  position: Vec2,
  events: SimEvent[],
): PlayerState {
  if (!isPlayerAlive(player)) return player;
  // Defense, then Guard and Vanish, each block a share (D-078, D-100).
  const damage =
    hit *
    player.combat.damageTakenFactor *
    (1 - (player.buffs.guard?.bonus ?? 0)) *
    (1 - (player.buffs.vanish?.bonus ?? 0));
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
    .filter((e) => isHittable(e) && !(p.pierced ?? []).includes(e.id))
    .map((e) => ({ id: e.id, box: boxAround(e.position, e.size) }));
}

/** Whether point `p` is inside `r` (edges included). */
function insideRect(r: Rect, p: Vec2): boolean {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}

/** Whether two rectangles overlap (edges touching do not count). */
/**
 * Does a blade arm touch a player at `p` (D-137)? Its band against the
 * hurtbox, taken as a circle of half its width.
 */
export function bladeHits(
  b: { pivot: Vec2; length: number; angle: number },
  p: Vec2,
): boolean {
  const ex = b.pivot.x + Math.cos(b.angle) * b.length;
  const ey = b.pivot.y + Math.sin(b.angle) * b.length;
  const dx = ex - b.pivot.x;
  const dy = ey - b.pivot.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0
      ? Math.max(
          0,
          Math.min(1, ((p.x - b.pivot.x) * dx + (p.y - b.pivot.y) * dy) / len2),
        )
      : 0;
  const d = Math.hypot(p.x - (b.pivot.x + t * dx), p.y - (b.pivot.y + t * dy));
  return d <= BLADES.thickness / 2 + PLAYER_HEALTH.hurtboxSize / 2;
}

/** The player with no pull on them (D-135). */
function withoutPull(player: PlayerState): PlayerState {
  const copy = { ...player };
  delete copy.pull;
  return copy;
}

/** Is `p` inside `r` (edges included)? */
function inside(r: Rect, p: Vec2): boolean {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}

function overlapsBox(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
