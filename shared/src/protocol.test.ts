import { ANY_LISTING } from "./exchange.ts";
import { DEFAULT_BINDS, DEFAULT_SETTINGS } from "./settings.ts";
import { rollArtifact } from "./items.ts";
import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import { SERF_BASE, zeroStats } from "./stats.ts";
import type { ItemSpec } from "./items.ts";

const RING: ItemSpec = {
  slot: "ring",
  type: "defense",
  tier: 4,
  rolls: [
    { stat: "attack", amount: 2 },
    { stat: "speed", amount: -1 },
  ],
  luck: 1,
};
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

  it("accepts the party requests (v44, D-143) and refuses odd shapes", () => {
    const good = [
      { type: "partyInvite", name: "Wynne Ashby" },
      { type: "partyAnswer", inviteId: 4, accept: true },
      { type: "partyAnswer", inviteId: 4, accept: false },
      { type: "partyLeave" },
      { type: "partyKick", playerId: 9 },
    ] as const;
    for (const m of good) {
      expect(parseClientMessage(encodeMessage(m))).toEqual({
        ok: true,
        message: m,
      });
    }
    for (const raw of [
      '{"type":"partyInvite","name":7}',
      `{"type":"partyInvite","name":"${"x".repeat(200)}"}`,
      '{"type":"partyAnswer","inviteId":4,"accept":"yes"}',
      '{"type":"partyAnswer","inviteId":0,"accept":true}',
      '{"type":"partyLeave","party":1}',
      '{"type":"partyKick","playerId":-2}',
      '{"type":"partyKick","playerId":2.5}',
    ]) {
      expect(parseClientMessage(raw).ok, raw).toBe(false);
    }
  });

  it("accepts an Exchange browse by tier T0-T10 or Artifact, nothing else (D-156)", () => {
    for (const tier of [null, 0, 10, "artifact"] as const) {
      const m = {
        type: "exchangeBrowse",
        query: { ...ANY_LISTING, tier },
      } as const;
      expect(parseClientMessage(encodeMessage(m))).toEqual({
        ok: true,
        message: m,
      });
    }
    for (const tier of [11, -1, 2.5, "epic", "10"]) {
      const raw = JSON.stringify({
        type: "exchangeBrowse",
        query: { ...ANY_LISTING, tier },
      });
      expect(parseClientMessage(raw).ok, raw).toBe(false);
    }
    const old = JSON.stringify({
      type: "exchangeBrowse",
      query: { ...ANY_LISTING, tier: undefined, rarity: "rare" },
    });
    expect(parseClientMessage(old).ok).toBe(false);
  });

  it("takes settings only when every key is bindable and used once (D-159)", () => {
    const ok = { type: "saveSettings", settings: DEFAULT_SETTINGS } as const;
    expect(parseClientMessage(encodeMessage(ok))).toEqual({
      ok: true,
      message: ok,
    });
    for (const settings of [
      { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_BINDS, left: "KeyW" } },
      { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_BINDS, up: "Enter" } },
      { ...DEFAULT_SETTINGS, fireMode: "turbo" },
      { binds: DEFAULT_BINDS },
    ]) {
      const raw = JSON.stringify({ type: "saveSettings", settings });
      expect(parseClientMessage(raw).ok, raw).toBe(false);
    }
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
  const input = (
    seq: unknown,
    move: unknown,
    fire: unknown = NO_FIRE,
    ability: unknown = null,
  ) => JSON.stringify({ type: "input", seq, move, fire, ability });

  it("accepts a unit or zero direction with fire intent", () => {
    expect(parseClientMessage(input(0, { x: 0, y: 0 }))).toEqual({
      ok: true,
      message: {
        type: "input",
        seq: 0,
        move: { x: 0, y: 0 },
        fire: NO_FIRE,
        ability: null,
      },
    });
    const d = Math.SQRT1_2;
    const fire = { trigger: true, aim: { x: 0.6, y: -0.8 } };
    expect(parseClientMessage(input(41, { x: d, y: -d }, fire))).toEqual({
      ok: true,
      message: {
        type: "input",
        seq: 41,
        move: { x: d, y: -d },
        fire,
        ability: null,
      },
    });
  });

  it("accepts an optional boolean fire.auto (D-101), nothing else", () => {
    const auto = { trigger: true, aim: { x: 1, y: 0 }, auto: true };
    expect(parseClientMessage(input(1, { x: 0, y: 0 }, auto))).toMatchObject({
      ok: true,
      message: { fire: auto },
    });
    expect(
      parseClientMessage(
        input(1, { x: 0, y: 0 }, { trigger: true, aim: null, auto: "yes" }),
      ),
    ).toEqual({ ok: false, error: "input: fire.auto must be a boolean" });
  });

  it("takes an ability target (Space held) as null or a nearby offset (v17)", () => {
    const ok = (ability: unknown) =>
      parseClientMessage(input(1, { x: 0, y: 0 }, NO_FIRE, ability)).ok;
    expect(ok(null)).toBe(true);
    expect(ok({ x: 120, y: -40 })).toBe(true);
    expect(ok({ x: 1900, y: 0 })).toBe(true); // the sim clamps it to range
    expect(ok({ x: 5000, y: 0 })).toBe(false);
    expect(ok({ x: Number.NaN, y: 0 })).toBe(false);
    expect(ok(true)).toBe(false);
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "input",
          seq: 1,
          move: { x: 0, y: 0 },
          fire: NO_FIRE,
        }),
      ).ok,
    ).toBe(false); // the field is required
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
      "input: fire must be {trigger, aim} (auto optional)",
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
      {
        type: "runStarted",
        dungeon: "goblin-warrens",
        seed: 0,
        players: [1, 4],
        stats: { ...SERF_BASE, speed: 14 },
        weaponTier: 2,
        weaponType: null,
        ability: null,
      },
      {
        type: "runEnded",
        dungeon: "goblin-warrens",
        result: "died",
        stats,
        loot: [],
        potions: [],
        killedBy: "brute",
        expGained: 0,
        statGains: zeroStats(),
        serf: {
          id: 3,
          name: "Aldric Mudfoot",
          level: 1,
          exp: 400,
          classId: "rogue",
          stats: { ...SERF_BASE, hp: 31 },
          potionStats: { ...zeroStats(), hp: 5 },
          items: [],
          alive: false,
          life: { ...stats, runs: 4, clears: 2 },
          death: { dungeon: "goblin-warrens", killedBy: "brute" },
          classSetOffered: false,
        },
      },
      {
        type: "runEnded",
        dungeon: "goblin-warrens",
        result: "completed",
        stats,
        loot: [
          { item: { ...RING, id: 12, equipped: null }, pending: false },
          { item: { ...RING, id: 13, equipped: null, luck: 0 }, pending: true },
        ],
        potions: [
          { potion: { id: 7, stat: "attack" }, pending: false },
          { potion: { id: 8, stat: "hp" }, pending: true },
        ],
        killedBy: null,
        serf: null,
        expGained: 100,
        statGains: { ...zeroStats(), hp: 3, attack: 1 },
      },
      { type: "serfList", slots: 2, serfs: [], selectedId: null },
      { type: "serfError", reason: "That name is taken." },
      {
        type: "party",
        party: {
          leaderId: 3,
          members: [
            { playerId: 3, name: "Bran", classId: "fighter", level: 20 },
            { playerId: 7, name: null, classId: null, level: 1 },
          ],
        },
        invited: [{ inviteId: 4, name: "Wynne" }],
      },
      { type: "party", party: null, invited: [] },
      {
        type: "partyInvited",
        inviteId: 4,
        from: { name: "Bran", classId: "fighter", level: 20 },
        expiresIn: 60,
      },
      { type: "partyInviteGone", inviteId: 4 },
      { type: "queueLeft", reason: null },
      { type: "rooms", seen: ["entrance", "tunnel"], cleared: ["entrance"] },
      { type: "queueLeft", reason: "Bran left the queue." },
      { type: "partyNotice", text: "Wynne joined the party." },
      { type: "partyError", reason: "Your party is full." },
    ];
    for (const m of msgs) {
      expect(parseServerMessage(encodeMessage(m))).toEqual({
        ok: true,
        message: m,
      });
    }
  });

  it("rejects malformed run messages", () => {
    const ended = {
      type: "runEnded",
      dungeon: "goblin-warrens",
      loot: [],
      potions: [],
      killedBy: null,
      serf: null,
      expGained: 0,
      statGains: zeroStats(),
    };
    const won = { ...ended, result: "completed", stats, expGained: 100 };
    // Potions (v27, D-118): completion only, real stats, never Luck.
    const sip = { potion: { id: 2, stat: "defense" }, pending: false };
    expect(server({ ...won, potions: [sip] }).ok).toBe(true);
    expect(server({ ...ended, result: "died", stats, potions: [sip] }).ok).toBe(
      false,
    );
    expect(
      server({ ...won, potions: [{ ...sip, potion: { id: 2, stat: "luck" } }] })
        .ok,
    ).toBe(false);
    expect(
      server({ ...won, potions: [{ ...sip, potion: { id: 0, stat: "hp" } }] })
        .ok,
    ).toBe(false);
    expect(
      server({
        ...won,
        potions: [{ ...sip, potion: { id: 2, stat: "hp", amount: 50 } }],
      }).ok,
    ).toBe(false);
    // Stat gains (v12): whole, non-negative, every stat, completion only.
    const gains = { ...zeroStats(), hp: 2 };
    expect(server({ ...won, statGains: gains }).ok).toBe(true);
    expect(
      server({ ...ended, result: "died", stats, statGains: gains }).ok,
    ).toBe(false);
    expect(server({ ...won, statGains: { ...gains, hp: -1 } }).ok).toBe(false);
    expect(server({ ...won, statGains: { ...gains, luck: 1 } }).ok).toBe(false);
    expect(server({ ...won, statGains: { hp: 2 } }).ok).toBe(false);
    // EXP only with completion (D-069), and only whole non-negative amounts.
    expect(server({ ...ended, result: "died", stats, expGained: 100 }).ok).toBe(
      false,
    );
    expect(server({ ...won, expGained: -5 }).ok).toBe(false);
    expect(server({ ...won, expGained: 2.5 }).ok).toBe(false);
    // Loot (v14): only with completion, only items the server could roll.
    const drop = { item: { ...RING, id: 3, equipped: null }, pending: false };
    expect(server({ ...won, loot: [drop] }).ok).toBe(true);
    expect(server({ ...ended, result: "died", stats, loot: [drop] }).ok).toBe(
      false,
    );
    expect(server({ ...won, loot: [{ ...drop, pending: "yes" }] }).ok).toBe(
      false,
    );
    expect(
      server({
        ...won,
        loot: [{ ...drop, item: { ...drop.item, equipped: "ring1" } }],
      }).ok,
    ).toBe(false);
    // A bare item spec (no id) is not an owned item.
    expect(server({ ...won, loot: [{ ...drop, item: RING }] }).ok).toBe(false);
    expect(server({ ...won, loot: [{ ...drop, gold: 5 }] }).ok).toBe(false);
    expect(
      server({ ...won, loot: [{ ...drop, item: { ...drop.item, luck: -1 } }] })
        .ok,
    ).toBe(false);
    expect(
      server({ ...won, loot: [{ ...drop, item: { ...drop.item, luck: 2 } }] })
        .ok,
    ).toBe(false);
    expect(
      server({
        ...won,
        loot: [
          {
            ...drop,
            item: {
              ...drop.item,
              rolls: [{ stat: "attack", amount: 9 }],
            },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(server({ ...won, reward: { roll: 5 } }).ok).toBe(false);
    expect(server({ ...ended, result: "won", stats }).ok).toBe(false);
    expect(
      server({ ...ended, result: "died", stats, killedBy: "kraken" }).ok,
    ).toBe(false);
    expect(
      server({ ...ended, result: "died", stats, serf: { id: 1 } }).ok,
    ).toBe(false);
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
    // v13: your stats come with runStarted, whole and complete.
    const started = {
      type: "runStarted",
      dungeon: "goblin-warrens",
      seed: 0,
      players: [1],
      stats: SERF_BASE,
      weaponTier: null,
      weaponType: null,
      ability: null,
    };
    expect(server(started).ok).toBe(true);
    expect(server({ ...started, weaponTier: 3 }).ok).toBe(true);
    // Up to an Artifact's T12 power (D-153), no further.
    expect(server({ ...started, weaponTier: 12 }).ok).toBe(true);
    expect(server({ ...started, weaponTier: 13 }).ok).toBe(false);
    expect(server({ ...started, weaponTier: -1 }).ok).toBe(false);
    // v18: your ability, a known kind with a tier in range.
    expect(
      server({ ...started, ability: { kind: "volley", tier: 2 } }).ok,
    ).toBe(true);
    expect(
      server({ ...started, ability: { kind: "fireball", tier: 2 } }).ok,
    ).toBe(false);
    expect(
      server({ ...started, ability: { kind: "volley", tier: 12 } }).ok,
    ).toBe(true);
    expect(
      server({ ...started, ability: { kind: "volley", tier: 13 } }).ok,
    ).toBe(false);
    expect(server({ ...started, ability: undefined }).ok).toBe(false);
    // v22: a room's rockfall can be the killer; nothing else unknown (D-110).
    expect(
      server({ ...ended, result: "died", stats, killedBy: "rockfall" }).ok,
    ).toBe(true);
    // v33: lava is a room hazard too (D-130); a made-up one is not.
    expect(
      server({ ...ended, result: "died", stats, killedBy: "lava" }).ok,
    ).toBe(true);
    expect(
      server({ ...ended, result: "died", stats, killedBy: "quicksand" }).ok,
    ).toBe(false);
    // v35: fire jets and slag spills (D-133).
    for (const killedBy of ["jets", "slag"]) {
      expect(server({ ...ended, result: "died", stats, killedBy }).ok).toBe(
        true,
      );
    }
    // v21: the layout seed, an unsigned 32-bit whole number (D-104).
    expect(server({ ...started, seed: 4294967295 }).ok).toBe(true);
    for (const seed of [-1, 1.5, 4294967296, "7", null, undefined]) {
      expect(server({ ...started, seed }).ok).toBe(false);
    }
    expect(server({ ...started, stats: undefined }).ok).toBe(false);
    expect(server({ ...started, stats: { ...SERF_BASE, speed: -1 } }).ok).toBe(
      false,
    );
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
    mp: 12.5,
    maxMp: 16,
    buffs: [] as ("battleCry" | "inspiration")[],
    cooldown: 0,
    abilityCooldown: 0,
    boost: 0,
    pull: null,
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
    cursed: false,
    leads: false,
    dazed: false,
    chanted: false,
    pile: false,
    faded: false,
    facing: null,
    spinning: false,
    vented: false,
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
    ability: false,
    trap: false,
    fireball: false,
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
      hazards: [
        { x: 3700, y: 980, radius: 32, landsIn: 0.4, kind: "boulder" },
        { x: 3720, y: 960, radius: 28, landsIn: 0.9, kind: "slag" },
      ],
      fires: [],
      beams: [
        {
          x1: 400,
          y1: 10,
          x2: 400,
          y2: 300,
          width: 32,
          remaining: 0.3,
          startsIn: 0,
          arc: false,
        },
      ],
      waves: [{ x: 500, y: 500, radius: 120, gap: 1.2, startsIn: 0 }],
      plates: [
        {
          x: 100,
          y: 100,
          width: 720,
          height: 640,
          lane: 3,
          warn: 0.5,
          burning: false,
        },
      ],
      clock: 12.5,
      whirlpools: [
        { x: 300, y: 300, radius: 150, from: 13.5, until: 17.5, dragSpeed: 70 },
        { x: 500, y: 300, radius: 260, from: 13.5, until: 14, dragSpeed: -300 },
      ],
      surges: [
        {
          x: 0,
          y: 0,
          width: 760,
          height: 640,
          axis: "x",
          dir: 1,
          pos: 120,
          gaps: [{ from: 100, to: 196 }],
          startsIn: 0,
        },
      ],
      frost: [{ x: 200, y: 200, radius: 48, from: 12, until: 16 }],
      cones: [
        {
          x: 400,
          y: 400,
          angle: 0.5,
          range: 280,
          halfAngle: 0.61,
          startsIn: 0.4,
        },
      ],
      blades: [
        { x: 300, y: 300, length: 150, angle: 1, speed: 1.05, laser: false },
      ],
      swings: [
        { by: 2, x: 400, y: 300, angle: 0.5, arcDegrees: 100, reach: 70 },
      ],
      traps: [],
      runes: [],
      portalOpen: false,
      blasts: [
        { kind: "arcaneBlast", by: 2, x: 1100.5, y: 990, radius: 40 },
        // A goblin's blasts have no player (D-115, D-117).
        { kind: "chant", by: 0, x: 900, y: 990, radius: 120 },
        { kind: "sweepWarning", by: 0, x: 950, y: 990, radius: 60 },
        { kind: "sweep", by: 0, x: 950, y: 990, radius: 60 },
      ],
      chains: [
        {
          by: 2,
          points: [
            { x: 1000, y: 1000 },
            { x: 1080, y: 1010 },
          ],
        },
      ],
      zones: [{ x: 1200, y: 1000, radius: 60, remaining: 2.5 }],
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
          fires: [],
          beams: [],
          waves: [],
          plates: [],
          clock: 0,
          whirlpools: [],
          surges: [],
          frost: [],
          cones: [],
          blades: [],
          swings: [],
          traps: [],
          runes: [],
          portalOpen: true,
          blasts: [],
          chains: [],
          zones: [],
        }),
      ).ok;
    expect(snap([player])).toBe(true);
    expect(snap([{ ...player, cooldown: undefined }])).toBe(false);
    expect(snap([{ ...player, id: 0 }])).toBe(false);
    expect(snap([{ ...player, ack: -2 }])).toBe(false);
    expect(snap([{ ...player, hp: -5 }])).toBe(false);
    expect(snap([], [{ ...enemy, hp: "1" }])).toBe(false);
    expect(snap([], [{ ...enemy, kind: "kraken" }])).toBe(false);
    expect(snap([], [{ ...enemy, kind: undefined }])).toBe(false);
    expect(snap([], [{ ...enemy, alert: "yes" }])).toBe(false);
    expect(snap([], [], [{ ...shot, owner: "boss" }])).toBe(false);
    expect(snap([], [], [{ ...shot, damage: 9999 }])).toBe(false);
    // v18: ability projectiles are flagged so their caster draws them.
    expect(snap([], [], [{ ...shot, ability: true }])).toBe(true);
    expect(snap([], [], [{ ...shot, ability: "yes" }])).toBe(false);
    expect(snap([], [], [{ ...shot, ability: undefined }])).toBe(false);
  });

  it("rejects closedDoors that are not a list of door ids", () => {
    const base = {
      type: "snapshot",
      tick: 1,
      players: [],
      enemies: [],
      projectiles: [],
      hazards: [],
      fires: [],
      beams: [],
      waves: [],
      plates: [],
      clock: 0,
      whirlpools: [],
      surges: [],
      frost: [],
      cones: [],
      blades: [],
      swings: [],
      traps: [],
      runes: [],
      portalOpen: false,
      blasts: [],
      chains: [],
      zones: [],
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
      fires: [],
      beams: [],
      waves: [],
      plates: [],
      clock: 0,
      whirlpools: [],
      surges: [],
      frost: [],
      cones: [],
      blades: [],
      swings: [],
      traps: [],
      runes: [],
      portalOpen: false,
      blasts: [],
      chains: [],
      zones: [],
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

describe("serf messages (v9)", () => {
  const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
  const server = (m: unknown) => parseServerMessage(JSON.stringify(m));
  const life = {
    runs: 1,
    clears: 0,
    seconds: 10,
    shotsFired: 4,
    shotsHit: 2,
    damageDealt: 50,
    enemiesDefeated: 1,
    damageTaken: 6,
  };

  it("accepts createSerf and selectSerf with the right shapes only", () => {
    expect(client({ type: "createSerf", name: "Edda Rye" })).toEqual({
      ok: true,
      message: { type: "createSerf", name: "Edda Rye" },
    });
    expect(client({ type: "createSerf", name: 5 }).ok).toBe(false);
    expect(client({ type: "createSerf", name: "x".repeat(65) }).ok).toBe(false);
    expect(client({ type: "createSerf", name: "Edda", level: 20 }).ok).toBe(
      false,
    );
    expect(client({ type: "selectSerf", serfId: 7 }).ok).toBe(true);
    expect(client({ type: "selectSerf", serfId: 0 }).ok).toBe(false);
    expect(client({ type: "selectSerf", serfId: "7" }).ok).toBe(false);
  });

  it("validates serf lists", () => {
    const serf = {
      id: 1,
      name: "Edda",
      level: 1,
      exp: 0,
      classId: null,
      stats: SERF_BASE,
      potionStats: zeroStats(),
      items: [] as unknown[],
      alive: true,
      life,
      death: null,
      classSetOffered: false,
    };
    const list = (serfs: unknown[], selectedId: unknown = 1) =>
      server({ type: "serfList", slots: 2, serfs, selectedId }).ok;
    expect(list([serf])).toBe(true);
    expect(list([{ ...serf, life: { ...life, runs: -1 } }])).toBe(false);
    expect(list([{ ...serf, gold: 5 }])).toBe(false);
    expect(list([{ ...serf, death: { dungeon: "x" } }])).toBe(false);
    expect(list([serf], "1")).toBe(false);
    expect(list([{ ...serf, classId: "wizard" }])).toBe(true);
    expect(list([{ ...serf, classId: "paladin" }])).toBe(false);
    // A v10 serf (no classId field) is refused, not read as classless.
    const v10 = Object.fromEntries(
      Object.entries(serf).filter(([key]) => key !== "classId"),
    );
    expect(list([v10])).toBe(false);
    expect(list([{ ...serf, stats: { ...SERF_BASE, attack: 1.5 } }])).toBe(
      false,
    );
    expect(list([{ ...serf, stats: { ...SERF_BASE, luck: 9 } }])).toBe(false);
    // The potion tally (v49, D-151) is required and is a set of stats.
    const untallied: Record<string, unknown> = { ...serf };
    delete untallied.potionStats;
    expect(list([untallied])).toBe(false);
    expect(list([{ ...serf, potionStats: { hp: 5 } }])).toBe(false);
    // v14 items: owned items with an id and where they are worn.
    const owned = { ...RING, id: 5, equipped: "ring2" };
    expect(
      list([{ ...serf, items: [owned, { ...owned, id: 6, equipped: null }] }]),
    ).toBe(true);
    expect(list([{ ...serf, items: [{ ...owned, equipped: "belt" }] }])).toBe(
      false,
    );
    expect(list([{ ...serf, items: [{ ...owned, id: 0 }] }])).toBe(false);
    expect(list([{ ...serf, items: [{ ...owned, luck: -1 }] }])).toBe(false);
    expect(list([{ ...serf, items: [{ ...owned, owner: 2 }] }])).toBe(false);
  });
});

describe("class choice (v11, D-073)", () => {
  const client = (m: unknown) => parseClientMessage(JSON.stringify(m));

  it("accepts chooseClass only with a known class and a valid serf id", () => {
    expect(
      client({ type: "chooseClass", serfId: 3, classId: "druid" }),
    ).toEqual({
      ok: true,
      message: { type: "chooseClass", serfId: 3, classId: "druid" },
    });
    for (const classId of CLASS_IDS) {
      expect(client({ type: "chooseClass", serfId: 3, classId }).ok).toBe(true);
    }
    expect(
      client({ type: "chooseClass", serfId: 3, classId: "Druid" }).ok,
    ).toBe(false);
    expect(client({ type: "chooseClass", serfId: 3, classId: "serf" }).ok).toBe(
      false,
    );
    expect(client({ type: "chooseClass", serfId: 3, classId: null }).ok).toBe(
      false,
    );
    expect(
      client({ type: "chooseClass", serfId: 0, classId: "druid" }).ok,
    ).toBe(false);
    expect(
      client({ type: "chooseClass", serfId: 3, classId: "druid", level: 5 }).ok,
    ).toBe(false);
  });
});

describe("leaderboard messages (v10, class in v11, boards in v48)", () => {
  const query = {
    board: "fastest",
    classId: null,
    dungeon: "goblin-warrens",
    soloOnly: true,
  };
  it("round-trips a leaderboard and rejects account data in it", () => {
    const entry = {
      rank: 1,
      name: "Edda",
      level: 9,
      value: 184.5,
      classId: "bard",
      alive: false,
      partySize: 1,
    };
    const board = { type: "leaderboard", query, entries: [entry] };
    expect(parseServerMessage(JSON.stringify(board))).toEqual({
      ok: true,
      message: board,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          ...board,
          entries: [{ ...entry, email: "a@b.co" }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts only known boards, classes, and dungeons in a request", () => {
    const ask = (q: object) =>
      parseClientMessage(JSON.stringify({ type: "getLeaderboard", ...q })).ok;
    expect(ask(query)).toBe(true);
    expect(
      ask({ ...query, board: "exp", classId: "bard", dungeon: null }),
    ).toBe(true);
    expect(ask({ type: "getLeaderboard" })).toBe(false);
    expect(ask({ ...query, board: "gold" })).toBe(false);
    expect(ask({ ...query, classId: "king" })).toBe(false);
    expect(ask({ ...query, dungeon: "moon" })).toBe(false);
    expect(ask({ ...query, soloOnly: "yes" })).toBe(false);
    expect(ask({ ...query, top: 9999 })).toBe(false);
  });
});

describe("stash messages (v15, D-085–D-088)", () => {
  const owned = { ...RING, id: 4, equipped: null };
  const stash = {
    type: "stash",
    capacity: 20,
    gold: 42,
    items: [owned],
    pending: [{ item: { ...owned, id: 5 }, serfId: 2 }],
    rackCapacity: 20,
    rack: [{ id: 3, stat: "wisdom" }],
    pendingPotions: [{ potion: { id: 6, stat: "mp" }, serfId: 2 }],
  };
  it("round-trips a stash and refuses bad ones", () => {
    expect(parseServerMessage(JSON.stringify(stash))).toEqual({
      ok: true,
      message: stash,
    });
    // An Artifact and a Shiny item travel as they are (v50, D-152).
    const axe = {
      ...rollArtifact("doomrend", () => 0.5),
      shiny: true,
      id: 9,
      equipped: null,
    };
    expect(
      parseServerMessage(JSON.stringify({ ...stash, items: [axe] })),
    ).toEqual({ ok: true, message: { ...stash, items: [axe] } });
    // A tampered one is refused: Artifact power on a tiered item, a wrong type.
    expect(
      parseServerMessage(
        JSON.stringify({ ...stash, items: [{ ...owned, tier: 12 }] }),
      ).ok,
    ).toBe(false);
    expect(
      parseServerMessage(
        JSON.stringify({ ...stash, items: [{ ...axe, type: "sword" }] }),
      ).ok,
    ).toBe(false);
    expect(
      parseServerMessage(
        JSON.stringify({ ...stash, items: [{ ...owned, shiny: "yes" }] }),
      ).ok,
    ).toBe(false);
    const bad = (m: object) =>
      parseServerMessage(JSON.stringify({ ...stash, ...m })).ok;
    expect(bad({ gold: -1 })).toBe(false);
    expect(bad({ gold: 1.5 })).toBe(false);
    expect(bad({ capacity: 0 })).toBe(false);
    expect(bad({ items: [{ ...owned, equipped: "ring1" }] })).toBe(false);
    expect(bad({ items: [{ ...owned, luck: 2 }] })).toBe(false);
    expect(bad({ pending: [{ item: owned }] })).toBe(false);
    expect(bad({ potions: [] })).toBe(false);
    expect(bad({ rackCapacity: 0 })).toBe(false);
    expect(bad({ rack: [{ id: 3, stat: "luck" }] })).toBe(false);
    expect(bad({ rack: [{ id: 3 }] })).toBe(false);
    expect(bad({ pendingPotions: [{ potion: { id: 6, stat: "mp" } }] })).toBe(
      false,
    );
  });

  it("accepts drinkPotion and pourPotion only in their exact shapes (v27)", () => {
    const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
    expect(client({ type: "drinkPotion", potionId: 3, serfId: 2 })).toEqual({
      ok: true,
      message: { type: "drinkPotion", potionId: 3, serfId: 2 },
    });
    expect(client({ type: "drinkPotion", potionId: 3 }).ok).toBe(false);
    expect(client({ type: "drinkPotion", potionId: -1, serfId: 2 }).ok).toBe(
      false,
    );
    expect(
      client({ type: "drinkPotion", potionId: 3, serfId: 2, amount: 99 }).ok,
    ).toBe(false);
    expect(client({ type: "pourPotion", potionId: 3 })).toEqual({
      ok: true,
      message: { type: "pourPotion", potionId: 3 },
    });
    expect(client({ type: "pourPotion", potionId: "3" }).ok).toBe(false);
  });

  it("accepts getStash and sellItem only in their exact shapes", () => {
    const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
    expect(client({ type: "getStash" }).ok).toBe(true);
    expect(client({ type: "getStash", all: true }).ok).toBe(false);
    expect(client({ type: "sellItem", itemId: 9 })).toEqual({
      ok: true,
      message: { type: "sellItem", itemId: 9 },
    });
    expect(client({ type: "sellItem", itemId: 0 }).ok).toBe(false);
    expect(client({ type: "sellItem", itemId: 9, price: 9999 }).ok).toBe(false);
  });
});

describe("equipping messages (v16, 9b)", () => {
  const client = (m: unknown) => parseClientMessage(JSON.stringify(m));
  it("accepts equipItem and unequipItem only with real slots and ids", () => {
    expect(
      client({ type: "equipItem", itemId: 4, serfId: 2, slot: "ring2" }),
    ).toEqual({
      ok: true,
      message: { type: "equipItem", itemId: 4, serfId: 2, slot: "ring2" },
    });
    expect(
      client({ type: "equipItem", itemId: 4, serfId: 2, slot: "ring" }).ok,
    ).toBe(false);
    expect(
      client({ type: "equipItem", itemId: 0, serfId: 2, slot: "cape" }).ok,
    ).toBe(false);
    expect(
      client({
        type: "equipItem",
        itemId: 4,
        serfId: 2,
        slot: "cape",
        force: true,
      }).ok,
    ).toBe(false);
    expect(client({ type: "unequipItem", serfId: 2, slot: "weapon" }).ok).toBe(
      true,
    );
    expect(client({ type: "unequipItem", serfId: 2, slot: "belt" }).ok).toBe(
      false,
    );
  });
});

describe("ability drawing in snapshots (v18, D-097)", () => {
  const base = {
    type: "snapshot",
    tick: 1,
    players: [],
    enemies: [],
    projectiles: [],
    closedDoors: [],
    hazards: [],
    fires: [],
    beams: [],
    waves: [],
    plates: [],
    clock: 0,
    whirlpools: [],
    surges: [],
    frost: [],
    cones: [],
    blades: [],
    swings: [],
    traps: [],
    runes: [],
    portalOpen: false,
    blasts: [],
    chains: [],
    zones: [],
  };
  const ok = (extra: object) =>
    parseServerMessage(JSON.stringify({ ...base, ...extra })).ok;
  it("accepts chain paths of 2–7 points and zones; refuses bad ones", () => {
    const p = { x: 1, y: 2 };
    expect(ok({ chains: [{ by: 1, points: [p, p] }] })).toBe(true);
    expect(ok({ chains: [{ by: 1, points: [p] }] })).toBe(false);
    expect(ok({ chains: [{ by: 1, points: Array(8).fill(p) }] })).toBe(false);
    expect(ok({ chains: [{ by: 0, points: [p, p] }] })).toBe(false);
    expect(ok({ zones: [{ x: 1, y: 2, radius: 60, remaining: 3 }] })).toBe(
      true,
    );
    expect(ok({ zones: [{ x: 1, y: 2, radius: -1, remaining: 3 }] })).toBe(
      false,
    );
    expect(ok({ zones: undefined })).toBe(false);
  });
});
