import { describe, expect, it } from "vitest";
import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "./protocol.ts";

describe("parseClientMessage", () => {
  it("accepts a valid hello", () => {
    expect(
      parseClientMessage(`{"type":"hello","protocol":${PROTOCOL_VERSION}}`),
    ).toEqual({
      ok: true,
      message: { type: "hello", protocol: PROTOCOL_VERSION },
    });
  });

  it("round-trips through encodeMessage", () => {
    const msg = { type: "hello", protocol: 7 } as const;
    expect(parseClientMessage(encodeMessage(msg))).toEqual({
      ok: true,
      message: msg,
    });
  });

  it.each([
    ["not JSON", "hello", "invalid JSON"],
    ["a JSON array", "[1,2]", "message must be a JSON object"],
    ["JSON null", "null", "message must be a JSON object"],
    ["a JSON string", '"hello"', "message must be a JSON object"],
    ["a missing type", '{"protocol":1}', "message type must be a string"],
    ["a numeric type", '{"type":5}', "message type must be a string"],
    [
      "an unknown type",
      '{"type":"teleport","x":1}',
      'unknown message type "teleport"',
    ],
    [
      "an extra field",
      '{"type":"hello","protocol":1,"admin":true}',
      "hello: unexpected fields",
    ],
    ["a missing field", '{"type":"hello"}', "hello: unexpected fields"],
    [
      "a string protocol",
      '{"type":"hello","protocol":"1"}',
      "hello: protocol must be a non-negative integer",
    ],
    [
      "a fractional protocol",
      '{"type":"hello","protocol":1.5}',
      "hello: protocol must be a non-negative integer",
    ],
    [
      "a negative protocol",
      '{"type":"hello","protocol":-1}',
      "hello: protocol must be a non-negative integer",
    ],
  ])("rejects %s", (_label, raw, error) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error });
  });

  it("rejects messages over the size limit before parsing", () => {
    const big = `{"type":"hello","protocol":1,"pad":"${"x".repeat(MAX_MESSAGE_BYTES)}"}`;
    expect(parseClientMessage(big)).toEqual({
      ok: false,
      error: "message too large",
    });
  });

  it("is not fooled by a __proto__ key", () => {
    expect(
      parseClientMessage('{"type":"hello","__proto__":{"protocol":1}}').ok,
    ).toBe(false);
  });
});

describe("parseServerMessage", () => {
  it("accepts each server message type", () => {
    const messages: ServerMessage[] = [
      { type: "welcome", playerId: 3, players: [1, 3] },
      { type: "playerJoined", playerId: 4 },
      { type: "playerLeft", playerId: 1 },
      { type: "error", reason: "bad" },
    ];
    for (const msg of messages) {
      expect(parseServerMessage(encodeMessage(msg))).toEqual({
        ok: true,
        message: msg,
      });
    }
  });

  it("rejects bad player ids and malformed lists", () => {
    expect(parseServerMessage('{"type":"playerJoined","playerId":0}').ok).toBe(
      false,
    );
    expect(
      parseServerMessage('{"type":"playerJoined","playerId":"2"}').ok,
    ).toBe(false);
    expect(
      parseServerMessage('{"type":"welcome","playerId":1,"players":[1,"x"]}')
        .ok,
    ).toBe(false);
    expect(
      parseServerMessage('{"type":"welcome","playerId":1,"players":{}}').ok,
    ).toBe(false);
  });
});

describe("input messages (v2)", () => {
  const input = (seq: unknown, move: unknown) =>
    JSON.stringify({ type: "input", seq, move });

  it("accepts a unit or zero direction", () => {
    expect(parseClientMessage(input(0, { x: 0, y: 0 }))).toEqual({
      ok: true,
      message: { type: "input", seq: 0, move: { x: 0, y: 0 } },
    });
    const d = Math.SQRT1_2;
    expect(parseClientMessage(input(41, { x: d, y: -d })).ok).toBe(true);
  });

  it.each([
    [
      "a too-long direction (speed hack)",
      input(1, { x: 1, y: 1 }),
      "input: move must have length <= 1",
    ],
    [
      "a huge direction",
      input(1, { x: 1e9, y: 0 }),
      "input: move must have length <= 1",
    ],
    [
      "a string coordinate",
      input(1, { x: "1", y: 0 }),
      "input: move must be {x, y} numbers",
    ],
    [
      "a missing coordinate",
      input(1, { x: 1 }),
      "input: move must be {x, y} numbers",
    ],
    [
      "an extra coordinate",
      input(1, { x: 0, y: 0, z: 1 }),
      "input: move must be {x, y} numbers",
    ],
    [
      "an array direction",
      input(1, [1, 0]),
      "input: move must be {x, y} numbers",
    ],
    [
      "a negative seq",
      input(-1, { x: 0, y: 0 }),
      "input: seq must be a non-negative integer",
    ],
    [
      "a fractional seq",
      input(1.5, { x: 0, y: 0 }),
      "input: seq must be a non-negative integer",
    ],
    [
      "a position instead of a direction",
      JSON.stringify({ type: "input", seq: 1, x: 500, y: 500 }),
      "input: unexpected fields",
    ],
  ])("rejects %s", (_label, raw, error) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error });
  });
});

describe("snapshot messages (v2)", () => {
  it("round-trips a snapshot", () => {
    const msg: ServerMessage = {
      type: "snapshot",
      tick: 120,
      players: [
        { id: 1, x: 1000, y: 1000, ack: -1 },
        { id: 2, x: 1012.5, y: 990.25, ack: 57 },
      ],
    };
    expect(parseServerMessage(encodeMessage(msg))).toEqual({
      ok: true,
      message: msg,
    });
  });

  it("rejects malformed player entries", () => {
    const bad = (p: unknown) =>
      parseServerMessage(
        JSON.stringify({ type: "snapshot", tick: 1, players: [p] }),
      ).ok;
    expect(bad({ id: 1, x: 0, y: 0 })).toBe(false);
    expect(bad({ id: 0, x: 0, y: 0, ack: 0 })).toBe(false);
    expect(bad({ id: 1, x: "0", y: 0, ack: 0 })).toBe(false);
    expect(bad({ id: 1, x: 0, y: 0, ack: -2 })).toBe(false);
    expect(bad({ id: 1, x: 0, y: 0, ack: 0, hp: 1 })).toBe(false);
  });
});
