import { EMAIL_MAX, PASSWORD_MAX } from "./account-rules.ts";
import { isClassId, type ClassId } from "./classes.ts";
import { isDungeonId, type DungeonId } from "./dungeons.ts";
import { isEnemyKind, type EnemyKind } from "./enemy-config.ts";
import { isValidRoll, type PlaceholderReward } from "./reward.ts";
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
export const PROTOCOL_VERSION = 11;

/** Session tokens are 32 random bytes, base64url: 43 characters. */
const TOKEN_LENGTH = 43;

/** Largest client → server message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 1024;

/** Largest server → client message the client accepts (snapshots grow with players and projectiles). */
export const MAX_SERVER_MESSAGE_BYTES = 65536;

/** Slack for unit-length checks (JSON round-trips lose a little precision). */
const UNIT_SLACK = 1e-6;

/** Fire intent for one tick: whether to fire and a unit aim direction (null = no valid aim). */
export interface FireInput {
  trigger: boolean;
  aim: Vec2 | null;
}

/** Client → server. */
export type ClientMessage =
  | { type: "hello"; protocol: number }
  /**
   * One tick of intent. `seq` increases by one per input; `move` is a unit
   * world direction or (0, 0); `fire` says whether to shoot and where. The
   * client never says where it is or what it hit, only what it wants to do.
   */
  | { type: "input"; seq: number; move: Vec2; fire: FireInput }
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
  | { type: "chooseClass"; serfId: number; classId: ClassId };

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
}

/** A warning circle that lands after `landsIn` seconds. */
export interface SnapshotHazard {
  x: number;
  y: number;
  radius: number;
  landsIn: number;
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
  | { type: "runStarted"; dungeon: DungeonId; players: number[] }
  /** Your run is over; you are back at the menu. */
  | {
      type: "runEnded";
      dungeon: DungeonId;
      result: RunResult;
      stats: RunStats;
      /** Rolled by the server for this player only; null unless completed (D-010). */
      reward: PlaceholderReward | null;
      /** Kind of enemy that landed the killing blow (deaths only). */
      killedBy: EnemyKind | null;
      /** The serf's life including this run; on death, its final record. */
      serf: SerfSummary | null;
      /** EXP this run earned (completion only, D-069). */
      expGained: number;
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
  | {
      type: "snapshot";
      tick: number;
      players: SnapshotPlayer[];
      enemies: SnapshotEnemy[];
      projectiles: SnapshotProjectile[];
      /** Ids of doors still closed in this run's dungeon (they block movement and shots). */
      closedDoors: string[];
      hazards: SnapshotHazard[];
      /** The exit portal is open: step into it to complete the run (D-057). */
      portalOpen: boolean;
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
      if (!hasExactKeys(obj, ["type", "seq", "move", "fire"])) {
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
      return {
        ok: true,
        message: { type: "input", seq: obj.seq, move, fire },
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
      if (!hasExactKeys(obj, ["type", "dungeon", "players"])) {
        return fail("runStarted: unexpected fields");
      }
      if (!isDungeonId(obj.dungeon)) return fail("runStarted: bad dungeon");
      if (!Array.isArray(obj.players) || !obj.players.every(isPlayerId)) {
        return fail("runStarted: players must be an array of player ids");
      }
      return {
        ok: true,
        message: {
          type: "runStarted",
          dungeon: obj.dungeon,
          players: [...obj.players],
        },
      };
    case "runEnded": {
      if (
        !hasExactKeys(obj, [
          "type",
          "dungeon",
          "result",
          "stats",
          "reward",
          "killedBy",
          "serf",
          "expGained",
        ])
      ) {
        return fail("runEnded: unexpected fields");
      }
      if (obj.killedBy !== null && !isEnemyKind(obj.killedBy)) {
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
      const stats = parseRunStats(obj.stats);
      if (!stats) return fail("runEnded: bad stats");
      const reward = parseReward(obj.reward);
      if (reward === undefined) return fail("runEnded: bad reward");
      if ((reward !== null) !== (result === "completed")) {
        return fail("runEnded: a reward comes with completion only");
      }
      return {
        ok: true,
        message: {
          type: "runEnded",
          dungeon: obj.dungeon,
          result,
          stats,
          reward,
          killedBy: obj.killedBy,
          serf,
          expGained: obj.expGained,
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
          "portalOpen",
        ])
      ) {
        return fail("snapshot: unexpected fields");
      }
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
          portalOpen: obj.portalOpen,
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
  if (!isPlainObject(v) || !hasExactKeys(v, ["trigger", "aim"])) {
    return "fire must be {trigger, aim}";
  }
  if (typeof v.trigger !== "boolean") return "fire.trigger must be a boolean";
  if (v.aim === null) return { trigger: v.trigger, aim: null };
  const aim = parseVec2(v.aim);
  if (!aim) return "fire.aim must be null or {x, y} numbers";
  if (Math.abs(Math.hypot(aim.x, aim.y) - 1) > UNIT_SLACK) {
    return "fire.aim must be a unit vector";
  }
  return { trigger: v.trigger, aim };
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
      "alive",
      "life",
      "death",
    ])
  ) {
    return undefined;
  }
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

/** null is a valid "no reward"; undefined means malformed. */
function parseReward(v: unknown): PlaceholderReward | null | undefined {
  if (v === null) return null;
  if (!isPlainObject(v) || !hasExactKeys(v, ["roll"])) return undefined;
  return isValidRoll(v.roll) ? { roll: v.roll } : undefined;
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
    !hasExactKeys(v, ["id", "x", "y", "ack", "hp", "maxHp", "cooldown"])
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
    !isNonNegative(v.cooldown)
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
    cooldown: v.cooldown,
  };
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
    ])
  ) {
    return null;
  }
  if (!isEnemyKind(v.kind) || typeof v.alert !== "boolean") return null;
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
  };
}

function parseSnapshotHazard(v: unknown): SnapshotHazard | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["x", "y", "radius", "landsIn"])) {
    return null;
  }
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  if (!isNonNegative(v.radius) || !isNonNegative(v.landsIn)) return null;
  return { x: v.x, y: v.y, radius: v.radius, landsIn: v.landsIn };
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
    ])
  ) {
    return null;
  }
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
