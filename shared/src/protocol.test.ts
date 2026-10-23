import { describe, expect, it } from "vitest";
import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  roundCoord,
  type ServerMessage,
  type SnapshotProjectile,
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

const NO_FIRE = { trigger: false, aim: null };

describe("input messages", () => {
  const input = (seq: unknown, move: unknown, fire: unknown = NO_FIRE) =>
    JSON.stringify({ type: "input", seq, move, fire });

  it("accepts a unit or zero direction with fire intent", () => {
    expect(parseClientMessage(input(0, { x: 0, y: 0 }))).toEqual({
      ok: true,
      message: { type: "input", seq: 0, move: { x: 0, y: 0 }, fire: NO_FIRE },
    });
    const d = Math.SQRT1_2;
    const fire = { trigger: true, aim: { x: 0.6, y: -0.8 } };
    expect(parseClientMessage(input(41, { x: d, y: -d }, fire))).toEqual({
      ok: true,
      message: { type: "input", seq: 41, move: { x: d, y: -d }, fire },
    });
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
      "a position instead of an intent",
      JSON.stringify({ type: "input", seq: 1, x: 500, y: 500 }),
      "input: unexpected fields",
    ],
    [
      "missing fire",
      JSON.stringify({ type: "input", seq: 1, move: { x: 0, y: 0 } }),
      "input: unexpected fields",
    ],
    [
      "a non-boolean trigger",
      input(1, { x: 0, y: 0 }, { trigger: 1, aim: null }),
      "input: fire.trigger must be a boolean",
    ],
    [
      "a non-unit aim",
      input(1, { x: 0, y: 0 }, { trigger: true, aim: { x: 3, y: 0 } }),
      "input: fire.aim must be a unit vector",
    ],
    [
      "a zero aim",
      input(1, { x: 0, y: 0 }, { trigger: true, aim: { x: 0, y: 0 } }),
      "input: fire.aim must be a unit vector",
    ],
    [
      "a claimed hit",
      input(1, { x: 0, y: 0 }, { trigger: true, aim: null, hit: 7 }),
      "input: fire must be {trigger, aim}",
    ],
  ])("rejects %s", (_label, raw, error) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error });
  });

  it("no longer accepts the v3 playAgain message", () => {
    expect(parseClientMessage(JSON.stringify({ type: "playAgain" }))).toEqual({
      ok: false,
      error: 'unknown message type "playAgain"',
    });
  });
});

describe("menu, queue, and run messages (v4)", () => {
  const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
  const server = (m: unknown) => parseServerMessage(JSON.stringify(m));

  it("accepts queue for a known dungeon only", () => {
    expect(client({ type: "queue", dungeon: "goblin-warrens" })).toEqual({
      ok: true,
      message: { type: "queue", dungeon: "goblin-warrens" },
    });
    expect(client({ type: "queue", dungeon: "dragon-lair" })).toEqual({
      ok: false,
      error: "queue: unknown dungeon",
    });
    expect(client({ type: "queue" }).ok).toBe(false);
    expect(
      client({ type: "queue", dungeon: "goblin-warrens", party: [1, 2] }).ok,
    ).toBe(false);
  });

  it("accepts leaveQueue and exitDungeon with no extra fields", () => {
    expect(client({ type: "leaveQueue" })).toEqual({
      ok: true,
      message: { type: "leaveQueue" },
    });
    expect(client({ type: "exitDungeon" })).toEqual({
      ok: true,
      message: { type: "exitDungeon" },
    });
    // A client cannot claim it completed the dungeon on the way out.
    expect(client({ type: "exitDungeon", completed: true }).ok).toBe(false);
  });

  const stats = {
    seconds: 61.5,
    shotsFired: 120,
    shotsHit: 80,
    damageDealt: 2000,
    enemiesDefeated: 3,
    damageTaken: 140,
  };

  it("round-trips queueStatus, runStarted, and runEnded", () => {
    const msgs: ServerMessage[] = [
      {
        type: "queueStatus",
        dungeon: "goblin-warrens",
        queued: 2,
        startsIn: 3.5,
      },
      { type: "runStarted", dungeon: "goblin-warrens", players: [1, 4] },
      { type: "runEnded", dungeon: "goblin-warrens", result: "died", stats },
    ];
    for (const m of msgs) {
      expect(parseServerMessage(encodeMessage(m))).toEqual({
        ok: true,
        message: m,
      });
    }
  });

  it("rejects malformed run messages", () => {
    const ended = { type: "runEnded", dungeon: "goblin-warrens" };
    expect(server({ ...ended, result: "won", stats }).ok).toBe(false);
    expect(
      server({ ...ended, result: "died", stats: { ...stats, seconds: -1 } }).ok,
    ).toBe(false);
    expect(
      server({ ...ended, result: "died", stats: { ...stats, gold: 5 } }).ok,
    ).toBe(false);
    expect(
      server({ type: "runStarted", dungeon: "goblin-warrens", players: [0] })
        .ok,
    ).toBe(false);
    expect(
      server({
        type: "queueStatus",
        dungeon: "goblin-warrens",
        queued: 0,
        startsIn: 1,
      }).ok,
    ).toBe(false);
  });
});

describe("snapshot messages", () => {
  const player = {
    id: 1,
    x: 1000,
    y: 1000,
    ack: -1,
    hp: 200,
    maxHp: 200,
    cooldown: 0,
  };
  const enemy = {
    id: 1,
    kind: "dummy" as const,
    x: 1300,
    y: 1100,
    size: 16,
    hp: 875,
    maxHp: 875,
    respawnIn: 0,
    alert: false,
  };
  const shot: SnapshotProjectile = {
    id: 5,
    owner: "player",
    by: 1,
    x: 1010.25,
    y: 1000,
    dx: 1,
    dy: 0,
    speed: 400,
    size: 4,
  };

  it("round-trips a full snapshot", () => {
    const msg: ServerMessage = {
      type: "snapshot",
      tick: 120,
      players: [
        player,
        { ...player, id: 2, x: 1012.5, ack: 57, cooldown: 0.2 },
      ],
      enemies: [enemy],
      projectiles: [shot],
      closedDoors: ["tunnel-camp"],
      hazards: [{ x: 3700, y: 980, radius: 32, landsIn: 0.4 }],
      portalOpen: false,
    };
    expect(parseServerMessage(encodeMessage(msg))).toEqual({
      ok: true,
      message: msg,
    });
  });

  it("rejects malformed entries", () => {
    const snap = (p: unknown[], e: unknown[] = [], pr: unknown[] = []) =>
      parseServerMessage(
        JSON.stringify({
          type: "snapshot",
          tick: 1,
          players: p,
          enemies: e,
          projectiles: pr,
          closedDoors: [],
          hazards: [],
          portalOpen: true,
        }),
      ).ok;
    expect(snap([player])).toBe(true);
    expect(snap([{ ...player, cooldown: undefined }])).toBe(false);
    expect(snap([{ ...player, id: 0 }])).toBe(false);
    expect(snap([{ ...player, ack: -2 }])).toBe(false);
    expect(snap([{ ...player, hp: -5 }])).toBe(false);
    expect(snap([], [{ ...enemy, hp: "1" }])).toBe(false);
    expect(snap([], [{ ...enemy, kind: "dragon" }])).toBe(false);
    expect(snap([], [{ ...enemy, kind: undefined }])).toBe(false);
    expect(snap([], [{ ...enemy, alert: "yes" }])).toBe(false);
    expect(snap([], [], [{ ...shot, owner: "boss" }])).toBe(false);
    expect(snap([], [], [{ ...shot, damage: 9999 }])).toBe(false);
  });

  it("rejects closedDoors that are not a list of door ids", () => {
    const base = {
      type: "snapshot",
      tick: 1,
      players: [],
      enemies: [],
      projectiles: [],
      hazards: [],
      portalOpen: false,
    };
    const ok = (closedDoors: unknown) =>
      parseServerMessage(JSON.stringify({ ...base, closedDoors })).ok;
    expect(ok(["a", "b"])).toBe(true);
    expect(ok("a")).toBe(false);
    expect(ok([1])).toBe(false);
    expect(ok([""])).toBe(false);
    expect(ok(["x".repeat(65)])).toBe(false);
    expect(parseServerMessage(JSON.stringify(base)).ok).toBe(false);
  });

  it("rejects malformed hazards and portal flags", () => {
    const base = {
      type: "snapshot",
      tick: 1,
      players: [],
      enemies: [],
      projectiles: [],
      closedDoors: [],
      hazards: [],
      portalOpen: false,
    };
    const ok = (extra: object) =>
      parseServerMessage(JSON.stringify({ ...base, ...extra })).ok;
    expect(ok({})).toBe(true);
    expect(ok({ portalOpen: "open" })).toBe(false);
    expect(ok({ hazards: [{ x: 1, y: 2, radius: -1, landsIn: 1 }] })).toBe(
      false,
    );
    expect(
      ok({ hazards: [{ x: 1, y: 2, radius: 5, landsIn: 1, damage: 99 }] }),
    ).toBe(false);
  });

  it("roundCoord keeps two decimals", () => {
    expect(roundCoord(1234.56789)).toBe(1234.57);
  });
});
