import type { Vec2 } from "./geometry.ts";

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
 */
export const PROTOCOL_VERSION = 2;

/** Largest client → server message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 1024;

/** Largest server → client message the client accepts (snapshots grow with player count). */
export const MAX_SERVER_MESSAGE_BYTES = 65536;

/** Slack when checking that a direction is at most unit length (JSON round-trips lose a little precision). */
const UNIT_SLACK = 1e-6;

/** Client → server. */
export type ClientMessage =
  | { type: "hello"; protocol: number }
  /**
   * One simulation tick of movement intent. `seq` increases by one per
   * input; `move` is a unit world direction or (0, 0). The client never
   * says where it is, only where it wants to go.
   */
  | { type: "input"; seq: number; move: Vec2 };

/** One player's authoritative state in a snapshot. */
export interface SnapshotPlayer {
  id: number;
  x: number;
  y: number;
  /** Last input seq the server has applied for this player (-1 if none yet). */
  ack: number;
}

/** Server → client. */
export type ServerMessage =
  | { type: "welcome"; playerId: number; players: number[] }
  | { type: "playerJoined"; playerId: number }
  | { type: "playerLeft"; playerId: number }
  | { type: "error"; reason: string }
  | { type: "snapshot"; tick: number; players: SnapshotPlayer[] };

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
      if (!hasExactKeys(obj, ["type", "seq", "move"])) {
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
      return { ok: true, message: { type: "input", seq: obj.seq, move } };
    }
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
    case "snapshot": {
      if (!hasExactKeys(obj, ["type", "tick", "players"])) {
        return fail("snapshot: unexpected fields");
      }
      if (!isNonNegativeInt(obj.tick)) return fail("snapshot: bad tick");
      if (!Array.isArray(obj.players)) {
        return fail("snapshot: players must be an array");
      }
      const players: SnapshotPlayer[] = [];
      for (const p of obj.players) {
        const player = parseSnapshotPlayer(p);
        if (!player) return fail("snapshot: bad player entry");
        players.push(player);
      }
      return {
        ok: true,
        message: { type: "snapshot", tick: obj.tick, players },
      };
    }
    default:
      return fail(`unknown message type ${describe(obj.type)}`);
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

function parseSnapshotPlayer(v: unknown): SnapshotPlayer | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["id", "x", "y", "ack"])) {
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
  return { id: v.id, x: v.x, y: v.y, ack: v.ack };
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
