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
