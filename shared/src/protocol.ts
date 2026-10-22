/**
 * Client/server message protocol (Phase 4a). Messages are JSON text over a
 * WebSocket. Everything arriving from the network is untrusted, so both
 * sides parse with the strict validators below instead of casting.
 *
 * Bump PROTOCOL_VERSION whenever a message shape changes incompatibly; the
 * server refuses clients that announce a different version.
 */
export const PROTOCOL_VERSION = 1;

/** Largest message either side accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 1024;

/** Client → server. */
export type ClientMessage = { type: "hello"; protocol: number };

/** Server → client. */
export type ServerMessage =
  | { type: "welcome"; playerId: number; players: number[] }
  | { type: "playerJoined"; playerId: number }
  | { type: "playerLeft"; playerId: number }
  | { type: "error"; reason: string };

export type ParseResult<T> =
  { ok: true; message: T } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  const obj = parseObject(raw);
  if (typeof obj === "string") return fail(obj);
  switch (obj.type) {
    case "hello":
      if (!hasExactKeys(obj, ["type", "protocol"]))
        return fail("hello: unexpected fields");
      if (!isNonNegativeInt(obj.protocol))
        return fail("hello: protocol must be a non-negative integer");
      return { ok: true, message: { type: "hello", protocol: obj.protocol } };
    default:
      return fail(`unknown message type ${describe(obj.type)}`);
  }
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  const obj = parseObject(raw);
  if (typeof obj === "string") return fail(obj);
  switch (obj.type) {
    case "welcome":
      if (!hasExactKeys(obj, ["type", "playerId", "players"]))
        return fail("welcome: unexpected fields");
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
      if (!hasExactKeys(obj, ["type", "playerId"]))
        return fail(`${obj.type}: unexpected fields`);
      if (!isPlayerId(obj.playerId)) return fail(`${obj.type}: bad playerId`);
      return { ok: true, message: { type: obj.type, playerId: obj.playerId } };
    case "error":
      if (!hasExactKeys(obj, ["type", "reason"]))
        return fail("error: unexpected fields");
      if (typeof obj.reason !== "string")
        return fail("error: reason must be a string");
      return { ok: true, message: { type: "error", reason: obj.reason } };
    default:
      return fail(`unknown message type ${describe(obj.type)}`);
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/** Parses JSON and checks it is a plain object with a string `type`; returns an error string otherwise. */
function parseObject(raw: string): Record<string, unknown> | string {
  // Length in UTF-16 units is ≤ byte length, so this is a cheap first guard;
  // the server also enforces MAX_MESSAGE_BYTES on raw bytes before decoding.
  if (raw.length > MAX_MESSAGE_BYTES) return "message too large";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "invalid JSON";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "message must be a JSON object";
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== "string") return "message type must be a string";
  return obj;
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
