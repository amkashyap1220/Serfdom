import { isDungeonId, type DungeonId } from "./dungeons.ts";
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
 */
export const PROTOCOL_VERSION = 4;

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
  | { type: "exitDungeon" };

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
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  respawnIn: number;
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
    }
  | {
      type: "snapshot";
      tick: number;
      players: SnapshotPlayer[];
      enemies: SnapshotEnemy[];
      projectiles: SnapshotProjectile[];
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
      if (!hasExactKeys(obj, ["type"])) {
        return fail(`${obj.type}: unexpected fields`);
      }
      return { ok: true, message: { type: obj.type } };
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
      if (!hasExactKeys(obj, ["type", "dungeon", "result", "stats"])) {
        return fail("runEnded: unexpected fields");
      }
      if (!isDungeonId(obj.dungeon)) return fail("runEnded: bad dungeon");
      const result = RUN_RESULTS.find((r) => r === obj.result);
      if (!result) return fail("runEnded: bad result");
      const stats = parseRunStats(obj.stats);
      if (!stats) return fail("runEnded: bad stats");
      return {
        ok: true,
        message: { type: "runEnded", dungeon: obj.dungeon, result, stats },
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
        ])
      ) {
        return fail("snapshot: unexpected fields");
      }
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
    !hasExactKeys(v, ["id", "x", "y", "size", "hp", "maxHp", "respawnIn"])
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
    x: v.x,
    y: v.y,
    size: v.size,
    hp: v.hp,
    maxHp: v.maxHp,
    respawnIn: v.respawnIn,
  };
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
