import type { TrapWarning } from "./dungeon-run.ts";
import { HAZARD_KINDS, type HazardKind } from "./sim.ts";
import { MAX_SEED } from "./seeded-random.ts";
import { EMAIL_MAX, PASSWORD_MAX } from "./account-rules.ts";
import {
  ABILITIES,
  type AbilityKind,
  type AbilityLoadout,
} from "./abilities.ts";
import { isClassId, type ClassId } from "./classes.ts";
import { STAT_KEYS, type Stats } from "./stats.ts";
import { isDungeonId, type DungeonId } from "./dungeons.ts";
import { isEnemyKind, type EnemyKind } from "./enemy-config.ts";
import {
  EQUIP_SLOTS,
  isValidItemSpec,
  MAX_TIER,
  type EquipSlot,
  type Item,
  type ItemSpec,
  type StatRoll,
} from "./items.ts";
import {
  LIFE_STAT_KEYS,
  SERF_NAME_MAX,
  type LifeStats,
  type SerfSummary,
} from "./serf-rules.ts";
import type { Vec2 } from "./geometry.ts";
import {
  RUN_RESULTS,
  RUN_STAT_KEYS,
  type RunResult,
  type RunStats,
} from "./run-stats.ts";

/**
 * Client/server message protocol. Messages are JSON text over a WebSocket.
 * Everything arriving from the network is untrusted, so both sides parse
 * with the strict validators below instead of casting.
 *
 * Bump PROTOCOL_VERSION whenever a message shape changes incompatibly; the
 * server refuses clients that announce a different version.
 *
 * v1 (4a): hello / welcome / playerJoined / playerLeft / error.
 * v2 (4b): + input (client) and snapshot (server).
 * v3 (5b): input carries fire intent; + playAgain; snapshots carry player
 *          HP and fire cooldown, enemies, and projectiles.
 * v4 (6a): menu → queue → dungeon run → results. - playAgain;
 *          + queue / leaveQueue / exitDungeon (client) and
 *          queueStatus / runStarted / runEnded (server).
 * v5 (6b): snapshot enemies carry their kind; snapshots list closed doors.
 * v6 (6c): enemies carry an alert (telegraph) flag; snapshots carry
 *          hazards and whether the exit portal is open.
 * v7 (6d): runEnded carries the server's per-player reward roll
 *          (placeholder until Phase 9), present only on completion.
 * v20 (10d): Guard and Vanish buffs; heal rings and flashes; optional
 *          `fire.auto` (automatic shots hold fire while vanished).
 * v21 (11a): runStarted carries the run's dungeon `seed`; every client
 *          builds the same generated layout from it (T-050, D-104).
 * v22 (12b): snapshot enemies say whether they lead their shots (D-109);
 *          runEnded's killedBy may be a room hazard ("rockfall", D-110).
 * v23 (12c): snapshot enemies say whether they are dazed (a brute that
 *          charged into a wall, D-112).
 * v24 (12d): snapshots list arrow traps about to fire (room, gap, glow) and
 *          mark trap arrows among projectiles; killedBy may be "arrows" (D-113).
 * v25 (12e): skulkers, bombers, shamans; snapshot enemies say whether a
 *          chant strengthens them, hazards say boulder or bomb, snapshots
 *          list burning floor, and blasts may be a shaman's chant (D-115).
 * v26 (12g): the Goblin Warchief; blasts may be its axe sweep's warning
 *          or hit (D-117).
 * v19 (10c): snapshot players list their buffs, enemies say whether
 *          they are cursed, blasts say which ability made them.
 * v18 (10b): runStarted carries your ability (kind and tier), so the
 *          client aims with that ability's reach; snapshots carry Chain
 *          Lightning paths and Nature's Reach zones (drawing only).
 * v17 (10a): snapshot players carry mp and maxMp; input carries an
 *          optional ability target (Space held, an offset from the player,
 *          clamped by the server); snapshots list the blasts that landed.
 * v16 (9b): equipping. Client equipItem {itemId, serfId, slot} and
 *          unequipItem {serfId, slot}; runStarted carries your weapon's
 *          tier with your (gear-included) stats.
 * v15 (9a): no bag (D-085). Serfs carry only equipped items; rewards
 *          go to the account stash or wait as pending when it is full
 *          (D-086–D-088). Server stash {capacity, gold, items, pending} and
 *          stashError; client getStash and sellItem. runEnded.loot items
 *          carry their id and whether they are pending.
 * v14 (9a): items. Serfs carry their items (bag and equipped);
 *          runEnded's placeholder reward roll becomes `loot`: one item per
 *          chest (one chest per Luck point), with the bag id it was kept as
 *          or null when the bag was full.
 * v13 (8c-2): runStarted carries your stats, so prediction moves and
 *          fires exactly as the server simulates you.
 * v12 (8c): serfs carry their rolled stats; runEnded carries statGains
 *          (all zero unless the run completed).
 * v11 (8b): serfs and leaderboard entries carry classId; client
 *          chooseClass. Queueing requires a class from level 5 (D-073).
 * v10 (8a): serfs carry lifetime EXP; runEnded carries expGained;
 *          client getLeaderboard, server leaderboard.
 * v9 (7b): serfs. Client createSerf / selectSerf; server serfList /
 *          serfError; runEnded carries killedBy and the serf's life.
 *          Queueing requires a chosen living serf.
 * v8 (7a): accounts. Client register / login / resume / logout; server
 *          authOk / authError / loggedOut. Queueing requires being logged in.
 */
export const PROTOCOL_VERSION = 26;

/** Session tokens are 32 random bytes, base64url: 43 characters. */
const TOKEN_LENGTH = 43;

/** Largest client → server message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 1024;

/** Largest server → client message the client accepts (snapshots grow with players and projectiles). */
export const MAX_SERVER_MESSAGE_BYTES = 65536;

/** Longest ability target offset accepted (world px); the sim clamps to range. */
const MAX_ABILITY_OFFSET = 2000;

/** Slack for unit-length checks (JSON round-trips lose a little precision). */
const UNIT_SLACK = 1e-6;

/** Fire intent for one tick: whether to fire and a unit aim direction (null = no valid aim). */
export interface FireInput {
  trigger: boolean;
  aim: Vec2 | null;
  /** The shot fires by itself, not from a click (D-101); optional. */
  auto?: boolean;
}

/** Client → server. */
export type ClientMessage =
  | { type: "hello"; protocol: number }
  /**
   * One tick of intent. `seq` increases by one per input; `move` is a unit
   * world direction or (0, 0); `fire` says whether to shoot and where. The
   * client never says where it is or what it hit, only what it wants to do.
   */
  | {
      type: "input";
      seq: number;
      move: Vec2;
      fire: FireInput;
      /** Space held: where to cast, as an offset from the player (D-094); null when not. */
      ability: Vec2 | null;
    }
  /** From the menu or a results screen: wait for a run of this dungeon (D-048, D-051). */
  | { type: "queue"; dungeon: DungeonId }
  /** Stop waiting. Harmless if not queued. */
  | { type: "leaveQueue" }
  /** R: leave the current run at once (D-036). Harmless if not in a run. */
  | { type: "exitDungeon" }
  /** Create an account and log in (D-058). */
  | { type: "register"; email: string; password: string }
  | { type: "login"; email: string; password: string }
  /** Log back in with the token from an earlier authOk (page reload, reconnect). */
  | { type: "resume"; token: string }
  | { type: "logout" }
  /** Create a serf in a free slot (D-061, D-063). */
  | { type: "createSerf"; name: string }
  /** Play as this serf (must be one of yours and alive). */
  | { type: "selectSerf"; serfId: number }
  /** The lifetime EXP leaderboard (GDD §12). */
  | { type: "getLeaderboard" }
  /** Give one of your serfs its permanent class (level 5+, none yet; D-073). */
  | { type: "chooseClass"; serfId: number; classId: ClassId }
  /** Your stash, gold, and pending rewards. */
  | { type: "getStash" }
  /** Sell one of your stash or pending items to the vendor for gold (D-087). */
  | { type: "sellItem"; itemId: number }
  /** Wear a stash or pending item on one of your serfs (D-086); what it replaces goes to the stash. */
  | { type: "equipItem"; itemId: number; serfId: number; slot: EquipSlot }
  /** Take a worn item off into the stash (needs room). */
  | { type: "unequipItem"; serfId: number; slot: EquipSlot };

/** One reward chest's item and whether it fit in the bag. */
export interface LootDrop {
  /** The item as it now exists on the account (it has an id). */
  item: Item;
  /** True when the stash was full: it waits until the player sells something (D-087, D-088). */
  pending: boolean;
}

/** A reward that did not fit, held for the serf that won it (D-088). */
export interface PendingReward {
  item: Item;
  serfId: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  level: number;
  exp: number;
  classId: ClassId | null;
  alive: boolean;
}

/** One player's authoritative state in a snapshot. */
export interface SnapshotPlayer {
  id: number;
  /** Exact (not rounded): client prediction must match the server bit for bit. */
  x: number;
  y: number;
  /** Last input seq the server has processed for this player (-1 if none yet). */
  ack: number;
  hp: number;
  maxHp: number;
  /** Ability resource (D-093). */
  mp: number;
  maxMp: number;
  /** Active buffs, for the glow (D-098). */
  buffs: BuffKind[];
  /** Seconds until this player may fire again (needed to predict own shots exactly). */
  cooldown: number;
}

export interface SnapshotEnemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  respawnIn: number;
  /** Telegraphing an attack (a brute about to charge). */
  alert: boolean;
  /** Under a Warlock's Curse (D-098). */
  cursed: boolean;
  /** A slinger that aims where you will be (D-109); drawn lighter. */
  leads: boolean;
  /** A brute dazed after charging into a wall (D-112). */
  dazed: boolean;
  /** Strengthened by a shaman's chant (D-115): drawn with a red glow. */
  chanted: boolean;
}

/** Burning floor left by a bomb (D-115). */
export interface SnapshotFire {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/** An ability's flash on the ground, drawn once. */
export interface SnapshotBlast {
  /** Which ability: Arcane Blast, the Bard's ring, the Warlock's curse. */
  kind: BlastKind;
  /** The caster, or 0 for a goblin's (a chant, the Warchief's sweep). */
  by: number;
  x: number;
  y: number;
  radius: number;
}

export const BLAST_KINDS = [
  "arcaneBlast",
  "inspiration",
  "curse",
  "heal",
  "healed",
  /** A goblin shaman's chant (D-115). */
  "chant",
  /** The Warchief's axe sweep: where it will hit, then the hit (D-117). */
  "sweepWarning",
  "sweep",
] as const;
export type BlastKind = (typeof BLAST_KINDS)[number];

/** Buffs a snapshot shows on a player (D-098). */
export const BUFF_KINDS = [
  "battleCry",
  "inspiration",
  "guard",
  "vanish",
] as const;
export type BuffKind = (typeof BUFF_KINDS)[number];

export interface SnapshotChain {
  by: number;
  /** The caster, then each enemy hit, in order. */
  points: Vec2[];
}

export interface SnapshotZone {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/** A warning circle that lands after `landsIn` seconds. */
export interface SnapshotHazard {
  x: number;
  y: number;
  radius: number;
  landsIn: number;
  /** A falling boulder, or a goblin's bomb (D-115). */
  kind: "boulder" | "bomb";
}

export interface SnapshotProjectile {
  id: number;
  owner: "player" | "enemy";
  /** Id of the player or enemy that fired it. */
  by: number;
  /** Rounded to 0.01 px: only used for drawing. */
  x: number;
  y: number;
  /** Unit direction of travel. */
  dx: number;
  dy: number;
  speed: number;
  size: number;
  /**
   * From an ability (Volley arrows). The caster's client draws these from
   * the snapshot; its basic shots it predicts and draws itself.
   */
  ability: boolean;
  /** A trap's arrow (D-113): drawn as an arrow. */
  trap: boolean;
}

/** Server → client. */
export type ServerMessage =
  | { type: "welcome"; playerId: number; players: number[] }
  | { type: "playerJoined"; playerId: number }
  | { type: "playerLeft"; playerId: number }
  | { type: "error"; reason: string }
  /** Logged in. `token` keeps this login across reloads (store it; never show it). */
  | { type: "authOk"; email: string; token: string }
  /** Register/login/resume failed; `reason` is safe to show the player. */
  | { type: "authError"; reason: string }
  /** Logged out (by request, or because this account logged in elsewhere). */
  | { type: "loggedOut"; reason: string }
  /** Sent to everyone waiting for a dungeon whenever its queue changes. */
  | {
      type: "queueStatus";
      dungeon: DungeonId;
      /** Players waiting for this dungeon, including you. */
      queued: number;
      /** Seconds until the run starts if nobody else joins. */
      startsIn: number;
    }
  /** You are in a run now; snapshots follow. Seq numbers restart at 0. */
  /**
   * `stats` (gear included) and `weaponTier` are yours, as the server
   * simulates you this run (D-077, D-083).
   */
  | {
      type: "runStarted";
      dungeon: DungeonId;
      /** Builds this run's layout with `layoutFor` (0 = the fixed layout). */
      seed: number;
      players: number[];
      stats: Stats;
      weaponTier: number | null;
      /** What your Space casts this run (D-092), or null. */
      ability: AbilityLoadout | null;
    }
  /** Your run is over; you are back at the menu. */
  | {
      type: "runEnded";
      dungeon: DungeonId;
      result: RunResult;
      stats: RunStats;
      /** One item per chest, rolled by the server for this player only (D-010, D-080); empty unless completed. */
      loot: LootDrop[];
      /** Kind of enemy that landed the killing blow (deaths only). */
      /** An enemy kind, or a room hazard (D-109). */
      killedBy: EnemyKind | HazardKind | null;
      /** The serf's life including this run; on death, its final record. */
      serf: SerfSummary | null;
      /** EXP this run earned (completion only, D-069). */
      expGained: number;
      /** Stats rolled for the levels this run gained (D-074); all zero otherwise. */
      statGains: Stats;
    }
  /** Top serfs by lifetime EXP, living and dead. Names only: no account data. */
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  /** Your serfs (living first, then the fallen) and which one you play as. */
  | {
      type: "serfList";
      slots: number;
      serfs: SerfSummary[];
      selectedId: number | null;
    }
  /** createSerf/selectSerf refused; `reason` is safe to show. */
  | { type: "serfError"; reason: string }
  /** The account's shared stash (D-085), gold (D-087), and rewards waiting for room (D-088). */
  | {
      type: "stash";
      capacity: number;
      gold: number;
      items: Item[];
      pending: PendingReward[];
    }
  /** getStash/sellItem refused; `reason` is safe to show. */
  | { type: "stashError"; reason: string }
  | {
      type: "snapshot";
      tick: number;
      players: SnapshotPlayer[];
      enemies: SnapshotEnemy[];
      projectiles: SnapshotProjectile[];
      /** Ids of doors still closed in this run's dungeon (they block movement and shots). */
      closedDoors: string[];
      hazards: SnapshotHazard[];
      /** Burning floor (D-115). */
      fires: SnapshotFire[];
      /** Arrow traps glowing before a volley (D-113). */
      traps: TrapWarning[];
      /** The exit portal is open: step into it to complete the run (D-057). */
      portalOpen: boolean;
      /** Ability blasts that landed since the last snapshot (drawing only). */
      blasts: SnapshotBlast[];
      /** Chain Lightning paths since the last snapshot (drawing only). */
      chains: SnapshotChain[];
      /** Nature's Reach patches on the ground now. */
      zones: SnapshotZone[];
    };

export type ParseResult<T> =
  { ok: true; message: T } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  const obj = parseObject(raw, MAX_MESSAGE_BYTES);
  if (typeof obj === "string") return fail(obj);
  switch (obj.type) {
    case "hello":
      if (!hasExactKeys(obj, ["type", "protocol"])) {
        return fail("hello: unexpected fields");
      }
      if (!isNonNegativeInt(obj.protocol)) {
        return fail("hello: protocol must be a non-negative integer");
      }
      return { ok: true, message: { type: "hello", protocol: obj.protocol } };
    case "input": {
      if (!hasExactKeys(obj, ["type", "seq", "move", "fire", "ability"])) {
        return fail("input: unexpected fields");
      }
      if (!isNonNegativeInt(obj.seq)) {
        return fail("input: seq must be a non-negative integer");
      }
      const move = parseVec2(obj.move);
      if (!move) return fail("input: move must be {x, y} numbers");
      if (Math.hypot(move.x, move.y) > 1 + UNIT_SLACK) {
        return fail("input: move must have length <= 1");
      }
      const fire = parseFire(obj.fire);
      if (typeof fire === "string") return fail(`input: ${fire}`);
      let ability: Vec2 | null = null;
      if (obj.ability !== null) {
        const target = parseVec2(obj.ability);
        // Any sane length; the sim clamps it to the ability's range.
        if (!target || Math.hypot(target.x, target.y) > MAX_ABILITY_OFFSET) {
          return fail("input: ability must be null or a nearby {x, y}");
        }
        ability = target;
      }
      return {
        ok: true,
        message: { type: "input", seq: obj.seq, move, fire, ability },
      };
    }
    case "queue":
      if (!hasExactKeys(obj, ["type", "dungeon"])) {
        return fail("queue: unexpected fields");
      }
      if (!isDungeonId(obj.dungeon)) return fail("queue: unknown dungeon");
      return { ok: true, message: { type: "queue", dungeon: obj.dungeon } };
    case "leaveQueue":
    case "exitDungeon":
    case "logout":
      if (!hasExactKeys(obj, ["type"])) {
        return fail(`${obj.type}: unexpected fields`);
      }
      return { ok: true, message: { type: obj.type } };
    case "register":
    case "login": {
      if (!hasExactKeys(obj, ["type", "email", "password"])) {
        return fail(`${obj.type}: unexpected fields`);
      }
      // Only shape and size here; the account rules are applied by the server.
      if (typeof obj.email !== "string" || obj.email.length > EMAIL_MAX + 16) {
        return fail(`${obj.type}: email must be a string`);
      }
      if (
        typeof obj.password !== "string" ||
        obj.password.length > PASSWORD_MAX
      ) {
        return fail(`${obj.type}: password must be a string`);
      }
      return {
        ok: true,
        message: { type: obj.type, email: obj.email, password: obj.password },
      };
    }
    case "getStash":
      if (!hasExactKeys(obj, ["type"])) {
        return fail("getStash: unexpected fields");
      }
      return { ok: true, message: { type: "getStash" } };
    case "sellItem":
      if (!hasExactKeys(obj, ["type", "itemId"])) {
        return fail("sellItem: unexpected fields");
      }
      if (!isPlayerId(obj.itemId)) return fail("sellItem: bad itemId");
      return { ok: true, message: { type: "sellItem", itemId: obj.itemId } };
    case "equipItem":
      if (!hasExactKeys(obj, ["type", "itemId", "serfId", "slot"])) {
        return fail("equipItem: unexpected fields");
      }
      if (!isPlayerId(obj.itemId) || !isPlayerId(obj.serfId)) {
        return fail("equipItem: bad id");
      }
      if (!isEquipSlot(obj.slot)) return fail("equipItem: bad slot");
      return {
        ok: true,
        message: {
          type: "equipItem",
          itemId: obj.itemId,
          serfId: obj.serfId,
          slot: obj.slot,
        },
      };
    case "unequipItem":
      if (!hasExactKeys(obj, ["type", "serfId", "slot"])) {
        return fail("unequipItem: unexpected fields");
      }
      if (!isPlayerId(obj.serfId)) return fail("unequipItem: bad serfId");
      if (!isEquipSlot(obj.slot)) return fail("unequipItem: bad slot");
      return {
        ok: true,
        message: { type: "unequipItem", serfId: obj.serfId, slot: obj.slot },
      };
    case "getLeaderboard":
      if (!hasExactKeys(obj, ["type"])) {
        return fail("getLeaderboard: unexpected fields");
      }
      return { ok: true, message: { type: "getLeaderboard" } };
    case "chooseClass":
      if (!hasExactKeys(obj, ["type", "serfId", "classId"])) {
        return fail("chooseClass: unexpected fields");
      }
      if (!isPlayerId(obj.serfId)) return fail("chooseClass: bad serfId");
      if (!isClassId(obj.classId)) return fail("chooseClass: unknown class");
      return {
        ok: true,
        message: {
          type: "chooseClass",
          serfId: obj.serfId,
          classId: obj.classId,
        },
      };
    case "createSerf":
      if (!hasExactKeys(obj, ["type", "name"])) {
        return fail("createSerf: unexpected fields");
      }
      // Shape and size only; the name rules are applied by the server.
      if (typeof obj.name !== "string" || obj.name.length > SERF_NAME_MAX * 4) {
        return fail("createSerf: name must be a string");
      }
      return { ok: true, message: { type: "createSerf", name: obj.name } };
    case "selectSerf":
      if (!hasExactKeys(obj, ["type", "serfId"])) {
        return fail("selectSerf: unexpected fields");
      }
      if (!isPlayerId(obj.serfId)) return fail("selectSerf: bad serfId");
      return {
        ok: true,
        message: { type: "selectSerf", serfId: obj.serfId },
      };
    case "resume":
      if (!hasExactKeys(obj, ["type", "token"])) {
        return fail("resume: unexpected fields");
      }
      if (
        typeof obj.token !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(obj.token) ||
        obj.token.length !== TOKEN_LENGTH
      ) {
        return fail("resume: bad token");
      }
      return { ok: true, message: { type: "resume", token: obj.token } };
    default:
      return fail(`unknown message type ${describe(obj.type)}`);
  }
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  const obj = parseObject(raw, MAX_SERVER_MESSAGE_BYTES);
  if (typeof obj === "string") return fail(obj);
  switch (obj.type) {
    case "welcome":
      if (!hasExactKeys(obj, ["type", "playerId", "players"])) {
        return fail("welcome: unexpected fields");
      }
      if (!isPlayerId(obj.playerId)) return fail("welcome: bad playerId");
      if (!Array.isArray(obj.players) || !obj.players.every(isPlayerId)) {
        return fail("welcome: players must be an array of player ids");
      }
      return {
        ok: true,
        message: {
          type: "welcome",
          playerId: obj.playerId,
          players: [...obj.players],
        },
      };
    case "playerJoined":
    case "playerLeft":
      if (!hasExactKeys(obj, ["type", "playerId"])) {
        return fail(`${obj.type}: unexpected fields`);
      }
      if (!isPlayerId(obj.playerId)) return fail(`${obj.type}: bad playerId`);
      return { ok: true, message: { type: obj.type, playerId: obj.playerId } };
    case "error":
      if (!hasExactKeys(obj, ["type", "reason"])) {
        return fail("error: unexpected fields");
      }
      if (typeof obj.reason !== "string") {
        return fail("error: reason must be a string");
      }
      return { ok: true, message: { type: "error", reason: obj.reason } };
    case "authOk":
      if (!hasExactKeys(obj, ["type", "email", "token"])) {
        return fail("authOk: unexpected fields");
      }
      if (typeof obj.email !== "string" || typeof obj.token !== "string") {
        return fail("authOk: email and token must be strings");
      }
      return {
        ok: true,
        message: { type: "authOk", email: obj.email, token: obj.token },
      };
    case "authError":
    case "loggedOut":
      if (!hasExactKeys(obj, ["type", "reason"])) {
        return fail(`${obj.type}: unexpected fields`);
      }
      if (typeof obj.reason !== "string") {
        return fail(`${obj.type}: reason must be a string`);
      }
      return { ok: true, message: { type: obj.type, reason: obj.reason } };
    case "queueStatus":
      if (!hasExactKeys(obj, ["type", "dungeon", "queued", "startsIn"])) {
        return fail("queueStatus: unexpected fields");
      }
      if (!isDungeonId(obj.dungeon)) return fail("queueStatus: bad dungeon");
      if (!isPlayerId(obj.queued) || !isNonNegative(obj.startsIn)) {
        return fail("queueStatus: bad numbers");
      }
      return {
        ok: true,
        message: {
          type: "queueStatus",
          dungeon: obj.dungeon,
          queued: obj.queued,
          startsIn: obj.startsIn,
        },
      };
    case "runStarted":
      if (
        !hasExactKeys(obj, [
          "type",
          "dungeon",
          "seed",
          "players",
          "stats",
          "weaponTier",
          "ability",
        ])
      ) {
        return fail("runStarted: unexpected fields");
      }
      if (!isNonNegativeInt(obj.seed) || (obj.seed as number) > MAX_SEED) {
        return fail("runStarted: seed must be a whole number 0–4294967295");
      }
      if (
        obj.weaponTier !== null &&
        !(
          isNonNegativeInt(obj.weaponTier) &&
          (obj.weaponTier as number) <= MAX_TIER
        )
      ) {
        return fail("runStarted: bad weaponTier");
      }
      if (!isDungeonId(obj.dungeon)) return fail("runStarted: bad dungeon");
      if (!Array.isArray(obj.players) || !obj.players.every(isPlayerId)) {
        return fail("runStarted: players must be an array of player ids");
      }
      {
        const stats = parseStats(obj.stats);
        if (!stats) return fail("runStarted: bad stats");
        const ability = parseAbility(obj.ability);
        if (ability === undefined) return fail("runStarted: bad ability");
        return {
          ok: true,
          message: {
            type: "runStarted",
            dungeon: obj.dungeon,
            seed: obj.seed as number,
            players: [...obj.players],
            stats,
            weaponTier: obj.weaponTier as number | null,
            ability,
          },
        };
      }
    case "runEnded": {
      if (
        !hasExactKeys(obj, [
          "type",
          "dungeon",
          "result",
          "stats",
          "loot",
          "killedBy",
          "serf",
          "expGained",
          "statGains",
        ])
      ) {
        return fail("runEnded: unexpected fields");
      }
      if (
        obj.killedBy !== null &&
        !isEnemyKind(obj.killedBy) &&
        !(HAZARD_KINDS as readonly unknown[]).includes(obj.killedBy)
      ) {
        return fail("runEnded: bad killedBy");
      }
      const serf = obj.serf === null ? null : parseSerfSummary(obj.serf);
      if (serf === undefined) return fail("runEnded: bad serf");
      if (!isNonNegativeInt(obj.expGained)) {
        return fail("runEnded: bad expGained");
      }
      if (!isDungeonId(obj.dungeon)) return fail("runEnded: bad dungeon");
      const result = RUN_RESULTS.find((r) => r === obj.result);
      if (!result) return fail("runEnded: bad result");
      if (result !== "completed" && obj.expGained !== 0) {
        return fail("runEnded: EXP comes with completion only");
      }
      const statGains = parseStats(obj.statGains);
      if (!statGains) return fail("runEnded: bad statGains");
      if (
        result !== "completed" &&
        STAT_KEYS.some((key) => statGains[key] !== 0)
      ) {
        return fail("runEnded: stat gains come with completion only");
      }
      const stats = parseRunStats(obj.stats);
      if (!stats) return fail("runEnded: bad stats");
      const loot = parseList(obj.loot, parseLootDrop);
      if (!loot) return fail("runEnded: bad loot");
      if (result !== "completed" && loot.length > 0) {
        return fail("runEnded: loot comes with completion only");
      }
      return {
        ok: true,
        message: {
          type: "runEnded",
          dungeon: obj.dungeon,
          result,
          stats,
          loot,
          killedBy: obj.killedBy as EnemyKind | HazardKind | null,
          serf,
          expGained: obj.expGained,
          statGains,
        },
      };
    }
    case "leaderboard": {
      if (!hasExactKeys(obj, ["type", "entries"])) {
        return fail("leaderboard: unexpected fields");
      }
      const entries = parseList(obj.entries, parseLeaderboardEntry);
      if (!entries) return fail("leaderboard: bad entry");
      return { ok: true, message: { type: "leaderboard", entries } };
    }
    case "serfList": {
      if (!hasExactKeys(obj, ["type", "slots", "serfs", "selectedId"])) {
        return fail("serfList: unexpected fields");
      }
      if (!isNonNegativeInt(obj.slots)) return fail("serfList: bad slots");
      if (obj.selectedId !== null && !isPlayerId(obj.selectedId)) {
        return fail("serfList: bad selectedId");
      }
      if (!Array.isArray(obj.serfs)) return fail("serfList: bad serfs");
      const serfs: SerfSummary[] = [];
      for (const s of obj.serfs) {
        const parsed = parseSerfSummary(s);
        if (!parsed) return fail("serfList: bad serf entry");
        serfs.push(parsed);
      }
      return {
        ok: true,
        message: {
          type: "serfList",
          slots: obj.slots,
          serfs,
          selectedId: obj.selectedId,
        },
      };
    }
    case "serfError":
      if (!hasExactKeys(obj, ["type", "reason"])) {
        return fail("serfError: unexpected fields");
      }
      if (typeof obj.reason !== "string") {
        return fail("serfError: reason must be a string");
      }
      return { ok: true, message: { type: "serfError", reason: obj.reason } };
    case "stashError":
      if (!hasExactKeys(obj, ["type", "reason"])) {
        return fail("stashError: unexpected fields");
      }
      if (typeof obj.reason !== "string") {
        return fail("stashError: reason must be a string");
      }
      return { ok: true, message: { type: "stashError", reason: obj.reason } };
    case "stash": {
      if (
        !hasExactKeys(obj, ["type", "capacity", "gold", "items", "pending"])
      ) {
        return fail("stash: unexpected fields");
      }
      if (!isPlayerId(obj.capacity)) return fail("stash: bad capacity");
      if (!isNonNegativeInt(obj.gold)) return fail("stash: bad gold");
      const items = parseList(obj.items, parseUnworn);
      if (!items) return fail("stash: bad item");
      const pending = parseList(obj.pending, parsePending);
      if (!pending) return fail("stash: bad pending reward");
      return {
        ok: true,
        message: {
          type: "stash",
          capacity: obj.capacity,
          gold: obj.gold,
          items,
          pending,
        },
      };
    }
    case "snapshot": {
      if (
        !hasExactKeys(obj, [
          "type",
          "tick",
          "players",
          "enemies",
          "projectiles",
          "closedDoors",
          "hazards",
          "fires",
          "traps",
          "portalOpen",
          "blasts",
          "chains",
          "zones",
        ])
      ) {
        return fail("snapshot: unexpected fields");
      }
      const blasts = parseList(obj.blasts, parseSnapshotBlast);
      if (!blasts) return fail("snapshot: bad blast entry");
      const chains = parseList(obj.chains, parseSnapshotChain);
      if (!chains) return fail("snapshot: bad chain entry");
      const zones = parseList(obj.zones, parseSnapshotZone);
      if (!zones) return fail("snapshot: bad zone entry");
      if (typeof obj.portalOpen !== "boolean") {
        return fail("snapshot: portalOpen must be a boolean");
      }
      const hazards = parseList(obj.hazards, parseSnapshotHazard);
      if (!hazards) return fail("snapshot: bad hazard entry");
      if (
        !Array.isArray(obj.closedDoors) ||
        !obj.closedDoors.every(
          (d) => typeof d === "string" && d.length > 0 && d.length <= 64,
        )
      ) {
        return fail("snapshot: closedDoors must be door ids");
      }
      const closedDoors = obj.closedDoors as string[];
      const traps = parseList(obj.traps, parseTrapWarning);
      if (!traps) return fail("snapshot: bad trap entry");
      const fires = parseList(obj.fires, parseSnapshotFire);
      if (!fires) return fail("snapshot: bad fire entry");
      if (!isNonNegativeInt(obj.tick)) return fail("snapshot: bad tick");
      const players = parseList(obj.players, parseSnapshotPlayer);
      if (!players) return fail("snapshot: bad player entry");
      const enemies = parseList(obj.enemies, parseSnapshotEnemy);
      if (!enemies) return fail("snapshot: bad enemy entry");
      const projectiles = parseList(obj.projectiles, parseSnapshotProjectile);
      if (!projectiles) return fail("snapshot: bad projectile entry");
      return {
        ok: true,
        message: {
          type: "snapshot",
          tick: obj.tick,
          players,
          enemies,
          projectiles,
          closedDoors: [...closedDoors],
          hazards,
          fires,
          traps,
          portalOpen: obj.portalOpen,
          blasts,
          chains,
          zones,
        },
      };
    }
    default:
      return fail(`unknown message type ${describe(obj.type)}`);
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/** Rounds to 0.01 for projectile positions in snapshots (drawing only). */
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

function parseFire(v: unknown): FireInput | string {
  if (
    !isPlainObject(v) ||
    !(
      hasExactKeys(v, ["trigger", "aim"]) ||
      hasExactKeys(v, ["trigger", "aim", "auto"])
    )
  ) {
    return "fire must be {trigger, aim} (auto optional)";
  }
  if (typeof v.trigger !== "boolean") return "fire.trigger must be a boolean";
  if ("auto" in v && typeof v.auto !== "boolean") {
    return "fire.auto must be a boolean";
  }
  const auto = v.auto === true ? { auto: true } : {};
  if (v.aim === null) return { trigger: v.trigger, aim: null, ...auto };
  const aim = parseVec2(v.aim);
  if (!aim) return "fire.aim must be null or {x, y} numbers";
  if (Math.abs(Math.hypot(aim.x, aim.y) - 1) > UNIT_SLACK) {
    return "fire.aim must be a unit vector";
  }
  return { trigger: v.trigger, aim, ...auto };
}

/** undefined means malformed. */
function parseSerfSummary(v: unknown): SerfSummary | undefined {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, [
      "id",
      "name",
      "level",
      "exp",
      "classId",
      "stats",
      "items",
      "alive",
      "life",
      "death",
    ])
  ) {
    return undefined;
  }
  const items = parseList(v.items, parseItem);
  if (!items) return undefined;
  const stats = parseStats(v.stats);
  if (!stats) return undefined;
  if (v.classId !== null && !isClassId(v.classId)) return undefined;
  if (!isPlayerId(v.id) || typeof v.name !== "string") return undefined;
  if (!isPlayerId(v.level) || typeof v.alive !== "boolean") return undefined;
  if (!isNonNegativeInt(v.exp)) return undefined;
  const life = parseLifeStats(v.life);
  if (!life) return undefined;
  let death: SerfSummary["death"] = null;
  if (v.death !== null) {
    const d = v.death;
    if (
      !isPlainObject(d) ||
      !hasExactKeys(d, ["dungeon", "killedBy"]) ||
      typeof d.dungeon !== "string" ||
      (d.killedBy !== null && typeof d.killedBy !== "string")
    ) {
      return undefined;
    }
    death = { dungeon: d.dungeon, killedBy: d.killedBy };
  }
  return {
    id: v.id,
    name: v.name,
    level: v.level,
    exp: v.exp,
    classId: v.classId,
    stats,
    items,
    alive: v.alive,
    life,
    death,
  };
}

function parseLeaderboardEntry(v: unknown): LeaderboardEntry | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["rank", "name", "level", "exp", "classId", "alive"])
  ) {
    return null;
  }
  if (v.classId !== null && !isClassId(v.classId)) return null;
  if (!isPlayerId(v.rank) || typeof v.name !== "string") return null;
  if (!isPlayerId(v.level) || !isNonNegativeInt(v.exp)) return null;
  if (typeof v.alive !== "boolean") return null;
  return {
    rank: v.rank,
    name: v.name,
    level: v.level,
    exp: v.exp,
    classId: v.classId,
    alive: v.alive,
  };
}

/** Exactly the stat keys, each a whole number ≥ 0. */
function parseStats(v: unknown): Stats | null {
  if (!isPlainObject(v) || !hasExactKeys(v, STAT_KEYS)) return null;
  const stats: Partial<Stats> = {};
  for (const key of STAT_KEYS) {
    const n = v[key];
    if (!isNonNegativeInt(n)) return null;
    stats[key] = n;
  }
  return stats as Stats;
}

function parseLifeStats(v: unknown): LifeStats | null {
  if (!isPlainObject(v) || !hasExactKeys(v, LIFE_STAT_KEYS)) return null;
  const life: Partial<LifeStats> = {};
  for (const key of LIFE_STAT_KEYS) {
    const n = v[key];
    if (!isNonNegative(n)) return null;
    life[key] = n;
  }
  return life as LifeStats;
}

/** An item as the server could have rolled it, or null (D-067 checks inside). */
function parseItemSpec(v: unknown): ItemSpec | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["slot", "type", "tier", "rolls", "luck"]) ||
    typeof v.slot !== "string" ||
    (v.type !== null && typeof v.type !== "string") ||
    typeof v.tier !== "number" ||
    typeof v.luck !== "number" ||
    !Array.isArray(v.rolls)
  ) {
    return null;
  }
  const rolls: StatRoll[] = [];
  for (const r of v.rolls) {
    if (
      !isPlainObject(r) ||
      !hasExactKeys(r, ["stat", "amount"]) ||
      typeof r.stat !== "string" ||
      typeof r.amount !== "number"
    ) {
      return null;
    }
    rolls.push({ stat: r.stat as StatRoll["stat"], amount: r.amount });
  }
  const spec = {
    slot: v.slot,
    type: v.type,
    tier: v.tier,
    rolls,
    luck: v.luck,
  } as ItemSpec;
  return isValidItemSpec(spec) ? spec : null;
}

function parseItem(v: unknown): Item | null {
  if (!isPlainObject(v) || !isPlayerId(v.id)) return null;
  const { id, equipped, ...rest } = v;
  if (
    equipped !== null &&
    !(EQUIP_SLOTS as readonly unknown[]).includes(equipped)
  ) {
    return null;
  }
  const spec = parseItemSpec(rest);
  if (!spec) return null;
  return { ...spec, id: id as number, equipped: equipped as EquipSlot | null };
}

/** null is "no ability"; undefined means malformed. */
function parseAbility(v: unknown): AbilityLoadout | null | undefined {
  if (v === null) return null;
  if (!isPlainObject(v) || !hasExactKeys(v, ["kind", "tier"])) return undefined;
  if (typeof v.kind !== "string" || !(v.kind in ABILITIES)) return undefined;
  if (!isNonNegativeInt(v.tier) || (v.tier as number) > MAX_TIER) {
    return undefined;
  }
  return { kind: v.kind as AbilityKind, tier: v.tier as number };
}

function isEquipSlot(v: unknown): v is EquipSlot {
  return (EQUIP_SLOTS as readonly unknown[]).includes(v);
}

/** An owned item that is not worn (stash, pending, or a fresh drop). */
function parseUnworn(v: unknown): Item | null {
  const item = parseItem(v);
  return item && item.equipped === null ? item : null;
}

function parseLootDrop(v: unknown): LootDrop | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["item", "pending"])) return null;
  if (typeof v.pending !== "boolean") return null;
  const item = parseUnworn(v.item);
  return item ? { item, pending: v.pending } : null;
}

function parsePending(v: unknown): PendingReward | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["item", "serfId"])) return null;
  if (!isPlayerId(v.serfId)) return null;
  const item = parseUnworn(v.item);
  return item ? { item, serfId: v.serfId } : null;
}

function parseRunStats(v: unknown): RunStats | null {
  if (!isPlainObject(v) || !hasExactKeys(v, RUN_STAT_KEYS)) return null;
  const stats: Partial<RunStats> = {};
  for (const key of RUN_STAT_KEYS) {
    const n = v[key];
    if (!isNonNegative(n)) return null;
    stats[key] = n;
  }
  return stats as RunStats;
}

function parseList<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const parsed = item(x);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseSnapshotPlayer(v: unknown): SnapshotPlayer | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, [
      "id",
      "x",
      "y",
      "ack",
      "hp",
      "maxHp",
      "mp",
      "maxMp",
      "buffs",
      "cooldown",
    ])
  ) {
    return null;
  }
  if (!isPlayerId(v.id) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    return null;
  }
  if (!(
    typeof v.ack === "number" &&
    Number.isSafeInteger(v.ack) &&
    v.ack >= -1
  )) {
    return null;
  }
  if (
    !isNonNegative(v.hp) ||
    !isNonNegative(v.maxHp) ||
    !isNonNegative(v.mp) ||
    !isNonNegative(v.maxMp) ||
    !isNonNegative(v.cooldown)
  ) {
    return null;
  }
  if (
    !Array.isArray(v.buffs) ||
    v.buffs.length > BUFF_KINDS.length ||
    !v.buffs.every((b) => (BUFF_KINDS as readonly unknown[]).includes(b))
  ) {
    return null;
  }
  return {
    id: v.id,
    x: v.x,
    y: v.y,
    ack: v.ack,
    hp: v.hp,
    maxHp: v.maxHp,
    mp: v.mp,
    maxMp: v.maxMp,
    buffs: v.buffs as BuffKind[],
    cooldown: v.cooldown,
  };
}

function parseSnapshotBlast(v: unknown): SnapshotBlast | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["kind", "by", "x", "y", "radius"]) ||
    !(BLAST_KINDS as readonly unknown[]).includes(v.kind)
  ) {
    return null;
  }
  // 0: a goblin's (D-115, D-117), not a player's.
  const by = v.by === 0 || isPlayerId(v.by);
  if (!by || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    return null;
  }
  if (!isNonNegative(v.radius)) return null;
  return {
    kind: v.kind as BlastKind,
    by: v.by as number,
    x: v.x,
    y: v.y,
    radius: v.radius,
  };
}

function parseSnapshotChain(v: unknown): SnapshotChain | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["by", "points"])) return null;
  if (!isPlayerId(v.by) || !Array.isArray(v.points)) return null;
  // The caster plus at most 6 hits (5 jumps at T10).
  if (v.points.length < 2 || v.points.length > 7) return null;
  const points: Vec2[] = [];
  for (const p of v.points) {
    const point = parseVec2(p);
    if (!point) return null;
    points.push(point);
  }
  return { by: v.by, points };
}

function parseSnapshotZone(v: unknown): SnapshotZone | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["x", "y", "radius", "remaining"]) ||
    !isFiniteNumber(v.x) ||
    !isFiniteNumber(v.y) ||
    !isNonNegative(v.radius) ||
    !isNonNegative(v.remaining)
  ) {
    return null;
  }
  return { x: v.x, y: v.y, radius: v.radius, remaining: v.remaining };
}

function parseTrapWarning(v: unknown): TrapWarning | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["room", "gap", "warn"]))
    return null;
  if (typeof v.room !== "string" || v.room.length === 0 || v.room.length > 64) {
    return null;
  }
  if (
    !isNonNegativeInt(v.gap) ||
    !isNonNegative(v.warn) ||
    (v.warn as number) > 1
  ) {
    return null;
  }
  return { room: v.room, gap: v.gap as number, warn: v.warn as number };
}

function parseSnapshotEnemy(v: unknown): SnapshotEnemy | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, [
      "id",
      "kind",
      "x",
      "y",
      "size",
      "hp",
      "maxHp",
      "respawnIn",
      "alert",
      "cursed",
      "leads",
      "dazed",
      "chanted",
    ])
  ) {
    return null;
  }
  if (!isEnemyKind(v.kind) || typeof v.alert !== "boolean") return null;
  if (
    typeof v.cursed !== "boolean" ||
    typeof v.leads !== "boolean" ||
    typeof v.dazed !== "boolean" ||
    typeof v.chanted !== "boolean"
  ) {
    return null;
  }
  if (!isPlayerId(v.id) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    return null;
  }
  if (
    !isNonNegative(v.size) ||
    !isNonNegative(v.hp) ||
    !isNonNegative(v.maxHp) ||
    !isNonNegative(v.respawnIn)
  ) {
    return null;
  }
  return {
    id: v.id,
    kind: v.kind,
    x: v.x,
    y: v.y,
    size: v.size,
    hp: v.hp,
    maxHp: v.maxHp,
    respawnIn: v.respawnIn,
    alert: v.alert,
    cursed: v.cursed,
    leads: v.leads,
    dazed: v.dazed,
    chanted: v.chanted,
  };
}

function parseSnapshotHazard(v: unknown): SnapshotHazard | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["x", "y", "radius", "landsIn", "kind"])
  ) {
    return null;
  }
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  if (!isNonNegative(v.radius) || !isNonNegative(v.landsIn)) return null;
  if (v.kind !== "boulder" && v.kind !== "bomb") return null;
  return { x: v.x, y: v.y, radius: v.radius, landsIn: v.landsIn, kind: v.kind };
}

function parseSnapshotFire(v: unknown): SnapshotFire | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, ["x", "y", "radius", "remaining"])
  ) {
    return null;
  }
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  if (!isNonNegative(v.radius) || !isNonNegative(v.remaining)) return null;
  return { x: v.x, y: v.y, radius: v.radius, remaining: v.remaining };
}

function parseSnapshotProjectile(v: unknown): SnapshotProjectile | null {
  if (
    !isPlainObject(v) ||
    !hasExactKeys(v, [
      "id",
      "owner",
      "by",
      "x",
      "y",
      "dx",
      "dy",
      "speed",
      "size",
      "ability",
      "trap",
    ])
  ) {
    return null;
  }
  if (typeof v.ability !== "boolean" || typeof v.trap !== "boolean")
    return null;
  if (!isPlayerId(v.id) || (v.owner !== "player" && v.owner !== "enemy")) {
    return null;
  }
  if (!isNonNegativeInt(v.by)) return null;
  for (const n of [v.x, v.y, v.dx, v.dy]) if (!isFiniteNumber(n)) return null;
  if (!isNonNegative(v.speed) || !isNonNegative(v.size)) return null;
  return {
    id: v.id,
    owner: v.owner,
    by: v.by as number,
    x: v.x as number,
    y: v.y as number,
    dx: v.dx as number,
    dy: v.dy as number,
    speed: v.speed,
    size: v.size,
    ability: v.ability,
    trap: v.trap,
  };
}

function parseVec2(v: unknown): Vec2 | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["x", "y"])) return null;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  return { x: v.x, y: v.y };
}

/** Parses JSON and checks it is a plain object with a string `type`; returns an error string otherwise. */
function parseObject(
  raw: string,
  maxBytes: number,
): Record<string, unknown> | string {
  // Length in UTF-16 units is ≤ byte length, so this is a cheap first guard;
  // the server also enforces MAX_MESSAGE_BYTES on raw bytes before decoding.
  if (raw.length > maxBytes) return "message too large";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "invalid JSON";
  }
  if (!isPlainObject(value)) return "message must be a JSON object";
  if (typeof value.type !== "string") return "message type must be a string";
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasExactKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(obj);
  return (
    actual.length === keys.length && keys.every((k) => Object.hasOwn(obj, k))
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegative(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isPlayerId(v: unknown): v is number {
  return isNonNegativeInt(v) && v > 0;
}

function describe(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v.slice(0, 32)) : typeof v;
}

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}
