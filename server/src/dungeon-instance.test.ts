import {
  buildCrypt,
  buildStronghold,
  buildWarrens,
  damageEnemy,
  spawnEnemies,
  GOBLIN_WARRENS,
  SERF_BASE,
  GRUNT,
  WARLORD,
  PLAYER_BODY,
  PLAYER_HEALTH,
  WARCHIEF,
  encodeMessage,
  parseServerMessage,
  type ServerMessage,
} from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { DungeonInstance, type RunEnd } from "./dungeon-instance.ts";

const GW = GOBLIN_WARRENS;
const run = (players: number[]) =>
  new DungeonInstance(1, "goblin-warrens", players, {
    maxQueuedInputs: 30,
    joinWindowTicks: 900,
  });
const east = { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } };

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

describe("rockfall in a run (D-110)", () => {
  // A generated Warrens with a Tunnel; stand in it so it fights.
  const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((s) =>
    buildWarrens(s).rooms.some((r) => r.id === "tunnel"),
  )!;
  const tunnel = buildWarrens(seed).rooms.find((r) => r.id === "tunnel")!;
  const centre = {
    x: tunnel.bounds.x + tunnel.bounds.width / 2,
    y: tunnel.bounds.y + tunnel.bounds.height / 2,
  };
  const inTunnel = (hp?: number) => {
    const r = new DungeonInstance(1, "goblin-warrens", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed,
    });
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        position: { ...centre },
        hp: hp ?? p.hp,
      })),
    });
    return r;
  };
  // Goblins hold their fire, so only boulders can hurt.
  const calm = (r: DungeonInstance) =>
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) => ({ ...e, attackCooldown: 99 })),
      projectiles: [],
    });

  it("boulders start falling once the room fights, one every 1.05 s, sent in snapshots", () => {
    const r = inTunnel();
    r.tick();
    calm(r);
    const first = r.snapshot(1) as Snapshot;
    expect(first.hazards).toHaveLength(1);
    for (let t = 0; t < 70; t++) {
      r.tick();
      calm(r);
    }
    // 1.17 s later: boulders at 0 and 1.05 s, none landed yet (1.2 s to fall).
    expect((r.snapshot(2) as Snapshot).hazards).toHaveLength(2);
  });

  it("the same seed drops the same boulders", () => {
    const spots = () => {
      const r = inTunnel();
      for (let t = 0; t < 100; t++) {
        r.tick();
        calm(r);
      }
      return r.state.hazards.map((h) => h.position);
    };
    expect(spots()).toEqual(spots());
  });

  it("a boulder can kill, and the death names the rockfall", () => {
    let killedBy: string | null | undefined;
    // Stand still on a spot a boulder will hit: follow the first one.
    const r = inTunnel(1);
    r.tick();
    calm(r);
    const target = r.state.hazards[0]!.position;
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({ ...p, position: { ...target } })),
    });
    for (let t = 0; t < 120 && killedBy === undefined; t++) {
      const { ended } = r.tick();
      if (ended[0]) killedBy = ended[0].killedBy;
      calm(r);
    }
    expect(killedBy).toBe("rockfall");
  });
});

describe("arrow traps in a run (D-113)", () => {
  it("a Gatehouse glows, then fires trap arrows, sent in snapshots", () => {
    const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((s) =>
      buildStronghold(s).rooms.some((r) => r.id === "gatehouse"),
    )!;
    const gate = buildStronghold(seed).rooms.find((r) => r.id === "gatehouse")!;
    const r = new DungeonInstance(1, "goblin-stronghold", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed,
    });
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        hp: 5000,
        maxHp: 5000,
        position: { x: gate.bounds.x + 80, y: gate.bounds.y + 80 },
      })),
    });
    r.tick();
    const glowing = r.snapshot(1) as Snapshot;
    expect(glowing.traps).toEqual([
      { room: "gatehouse", gap: expect.any(Number), warn: expect.any(Number) },
    ]);
    let arrows = 0;
    for (let t = 0; t < 60 && arrows === 0; t++) {
      r.tick();
      arrows = (r.snapshot(2) as Snapshot).projectiles.filter(
        (p) => p.trap,
      ).length;
    }
    expect(arrows).toBe(gate.arrows!.slits.length - 3);
  });
});

describe("the Goblin Warchief in a run (D-117)", () => {
  const seed = 2;
  const hall = buildStronghold(seed).rooms.find((r) => r.id === "throne")!;
  const inHall = () => {
    const r = new DungeonInstance(1, "goblin-stronghold", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed,
    });
    const centre = {
      x: hall.bounds.x + hall.bounds.width / 2,
      y: hall.bounds.y + hall.bounds.height / 2,
    };
    // Step into the hall so it wakes, then stand just east of the Warchief.
    const place = (at: { x: number; y: number }) =>
      r.setStateForTest({
        ...r.state,
        players: r.state.players.map((p) => ({
          ...p,
          hp: 5000,
          maxHp: 5000,
          position: at,
        })),
      });
    place({ x: centre.x + 100, y: centre.y });
    r.tick();
    return { r, place, centre };
  };

  it("its sweep warning and hit reach the client: snapshots with goblin blasts still parse", () => {
    const { r, place } = inHall();
    const boss = r.state.enemies.find((e) => e.kind === "warchief")!;
    place({ x: boss.position.x + 60, y: boss.position.y });
    const kinds: string[] = [];
    for (let t = 0; t < 60; t++) {
      r.tick();
      const parsed = parseServerMessage(encodeMessage(r.snapshot(t)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.message.type === "snapshot") {
        kinds.push(...parsed.message.blasts.map((b) => b.kind));
      }
    }
    expect(kinds).toEqual(["sweepWarning", "sweep"]);
  });

  it("its war cry calls skulkers out of the War hall's holes", () => {
    const { r } = inHall();
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) =>
        e.ai.kind === "warchief"
          ? {
              ...e,
              hp: WARCHIEF.maxHp / 2,
              ai: { ...e.ai, warCry: 0, sweep: 99, axes: 99, charge: 99 },
            }
          : e,
      ),
    });
    r.tick();
    const skulkers = r.state.enemies.filter((e) => e.kind === "skulker");
    expect(skulkers).toHaveLength(2);
    for (const k of skulkers) {
      // Out of a hole (they may already have taken one step).
      const near = hall.holes!.some(
        (h) => Math.hypot(h.x - k.position.x, h.y - k.position.y) < 4,
      );
      expect(near).toBe(true);
      expect(k.roomId).toBe("throne");
    }
  });
});

describe("the Forgotten Crypt in a run (D-120)", () => {
  it("a killed skeleton is sent as a bone pile, and the snapshot parses", () => {
    const seed = 3;
    const first = buildCrypt(seed).rooms.find(
      (r) => r.required && r.id !== "entrance",
    )!;
    const r = new DungeonInstance(1, "forgotten-crypt", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed,
    });
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        hp: 5000,
        maxHp: 5000,
        position: { x: first.bounds.x + 40, y: first.bounds.y + 40 },
      })),
    });
    r.tick();
    const skeleton = r.state.enemies.find((e) => e.kind === "skeleton")!;
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) =>
        e.id === skeleton.id ? damageEnemy(e, 9999).enemy : e,
      ),
    });
    r.tick();
    const parsed = parseServerMessage(encodeMessage(r.snapshot(1)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "snapshot") return;
    const sent = parsed.message.enemies.find((e) => e.id === skeleton.id);
    expect(sent).toMatchObject({ kind: "skeleton", pile: true, hp: 1 });
    expect(
      parsed.message.enemies.filter((e) => e.id !== skeleton.id && e.pile),
    ).toEqual([]);
  });
});

describe("the crypt's new undead in a run (D-122)", () => {
  it("snapshots say which way a knight faces and whether a ghost is faded, and parse", () => {
    const r = new DungeonInstance(1, "forgotten-crypt", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed: 3,
    });
    const at = r.state.players[0]!.position;
    const added = spawnEnemies(r.state, [
      { kind: "knight", at: { x: at.x + 200, y: at.y }, roomId: null },
      { kind: "ghost", at: { x: at.x + 300, y: at.y }, roomId: null },
    ]);
    r.setStateForTest({
      ...added,
      enemies: added.enemies.map((e) =>
        e.ai.kind === "ghost"
          ? { ...e, ai: { ...e.ai, faded: true, timer: 99 } }
          : e,
      ),
    });
    const parsed = parseServerMessage(encodeMessage(r.snapshot(1)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "snapshot") return;
    const knight = parsed.message.enemies.find((e) => e.kind === "knight");
    const ghost = parsed.message.enemies.find((e) => e.kind === "ghost");
    // A new knight faces west (π radians), towards a room's entrance.
    expect(knight?.facing).toBeCloseTo(Math.PI, 2);
    expect(knight?.faded).toBe(false);
    expect(ghost).toMatchObject({ faded: true, facing: null });
  });
});

describe("the crypt's runes and braziers in a run (D-123)", () => {
  const seed = 2;
  const enter = (roomId: string) => {
    const room = buildCrypt(seed).rooms.find((r) => r.id === roomId)!;
    const r = new DungeonInstance(1, "forgotten-crypt", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed,
    });
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        hp: 1e6,
        maxHp: 1e6,
        position: {
          x: room.bounds.x + 40,
          y: room.bounds.y + room.bounds.height / 2,
        },
      })),
    });
    return r;
  };
  const snap = (r: DungeonInstance, tick: number) => {
    const parsed = parseServerMessage(encodeMessage(r.snapshot(tick)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "snapshot")
      throw new Error("no snapshot");
    return parsed.message;
  };

  it("a rune room sends its glowing column, and its bursts are not drawn as boulders", () => {
    const r = enter("chapel");
    r.tick();
    for (let t = 0; t < 30; t++) r.tick();
    expect(snap(r, 1).runes).toEqual([
      { room: "chapel", column: 0, warn: expect.any(Number) },
    ]);
    for (let t = 0; t < 40; t++) r.tick();
    expect(snap(r, 2).hazards).toEqual([]);
  });

  it("a brazier room's volleys are sent as fireballs", () => {
    const r = enter("catacomb");
    let fireballs = 0;
    for (let t = 0; t < 90 && fireballs === 0; t++) {
      r.tick();
      fireballs = snap(r, t).projectiles.filter(
        (p) => p.fireball && p.trap === false,
      ).length;
    }
    expect(fireballs).toBeGreaterThan(0);
  });
});

describe("the Lich in a run (D-125)", () => {
  it("a warded Lich is sent as not hittable, and its runes as rune hazards", () => {
    const r = new DungeonInstance(1, "forgotten-crypt", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed: 4,
    });
    const at = r.state.players[0]!.position;
    const added = spawnEnemies(r.state, [
      { kind: "lich", at: { x: at.x + 250, y: at.y }, roomId: null },
    ]);
    r.setStateForTest({
      ...added,
      players: added.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
      enemies: added.enemies.map((e) =>
        e.ai.kind === "lich"
          ? { ...e, hp: e.maxHp * 0.5, ai: { ...e.ai, wards: 2, runes: 0 } }
          : e,
      ),
    });
    r.tick();
    let parsed = parseServerMessage(encodeMessage(r.snapshot(1)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "snapshot") return;
    expect(parsed.message.hazards.filter((h) => h.kind === "rune").length).toBe(
      5,
    );
    // Ward it: crossing the first line with no ward used yet.
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) =>
        e.ai.kind === "lich" ? { ...e, ai: { ...e.ai, wards: 0 } } : e,
      ),
    });
    r.tick();
    r.tick();
    parsed = parseServerMessage(encodeMessage(r.snapshot(2)));
    if (!parsed.ok || parsed.message.type !== "snapshot")
      throw new Error("no snapshot");
    const lich = parsed.message.enemies.find((e) => e.kind === "lich");
    expect(lich?.faded).toBe(true);
    expect(
      parsed.message.enemies.filter((e) => e.kind === "crystal"),
    ).toHaveLength(3);
  });
});

describe("the Lich's pose in a snapshot (D-129)", () => {
  it("idle, it faces the nearest player; spinning, `facing` is its spiral angle", () => {
    const r = new DungeonInstance(1, "forgotten-crypt", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed: 4,
    });
    const at = r.state.players[0]!.position;
    r.setStateForTest(
      spawnEnemies(r.state, [
        { kind: "lich", at: { x: at.x + 250, y: at.y }, roomId: null },
      ]),
    );
    const lich = () => {
      const parsed = parseServerMessage(encodeMessage(r.snapshot(1)));
      if (!parsed.ok || parsed.message.type !== "snapshot")
        throw new Error("no snapshot");
      return parsed.message.enemies.find((e) => e.kind === "lich")!;
    };
    r.tick();
    // Its first volley is still 1.5 s off: idle, looking west at the player.
    expect(lich().spinning).toBe(false);
    expect(Math.abs(lich().facing!)).toBeCloseTo(Math.PI, 1);
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) =>
        e.ai.kind === "lich" ? { ...e, ai: { ...e.ai, shot: 0, spin: 1 } } : e,
      ),
    });
    r.tick();
    expect(lich().spinning).toBe(true);
    expect(lich().facing).toBeCloseTo(1, 1);
  });
});

describe("DungeonInstance layouts (D-104)", () => {
  it("builds the generated Warrens for its seed; seed 0 is the handcrafted one", () => {
    const seeded = new DungeonInstance(1, "goblin-warrens", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed: 1234,
    });
    const layout = buildWarrens(1234);
    expect(seeded.seed).toBe(1234);
    // Doors start open (D-114): only a gated room, once it fights, shuts them.
    expect(seeded.closedDoors).toEqual([]);
    expect(layout.doors.length).toBeGreaterThan(0);
    expect(seeded.state.players[0]?.position).toEqual(layout.spawn);
    expect(run([1]).seed).toBe(0);
    expect(run([1]).state.players[0]?.position).toEqual(GW.spawn);
  });
});

describe("DungeonInstance in the Goblin Warrens", () => {
  it("starts in the entrance with every door open (D-114)", () => {
    const r = run([1]);
    r.tick();
    expect(r.state.enemies).toEqual([]);
    expect((r.snapshot(1) as Snapshot).closedDoors).toEqual([]);
  });

  it("the ambush hall locks you in: back through its door, the server stops you", () => {
    const r = run([1]);
    r.tick();
    // Step into the ambush hall: it wakes and, once you are clear of the
    // doorway, shuts both its doors.
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        position: { x: 2080, y: 1000 },
      })),
    });
    r.tick();
    expect([...r.closedDoors].sort()).toEqual(["ambush-guard", "camp-ambush"]);
    const west = { move: { x: -1, y: 0 }, fire: { trigger: false, aim: null } };
    for (let seq = 0; seq < 60; seq++) {
      r.queueInput(1, seq, west);
      r.tick();
      // Its goblins live (so the hall keeps fighting) but hold their fire.
      r.setStateForTest({
        ...r.state,
        enemies: r.state.enemies.map((e) => ({ ...e, attackCooldown: 99 })),
        projectiles: [],
      });
    }
    // Body flush against the shut door at x = 2036 (the hall's west edge).
    expect(r.state.players[0]?.position.x).toBeCloseTo(
      2036 + PLAYER_BODY.width / 2,
      6,
    );
  });

  it("entering the tunnel spawns grunts, which come and hit the player", () => {
    const r = run([1]);
    r.tick();
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        position: { x: 600, y: 1000 },
      })),
    });
    r.tick();
    expect(r.state.enemies.map((e) => e.kind)).toEqual(Array(5).fill("grunt"));
    const snap = r.snapshot(2) as Snapshot;
    expect(snap.enemies[0]).toMatchObject({ kind: "grunt", hp: GRUNT.maxHp });
    const full: number = PLAYER_HEALTH.maxHp;
    let hp = full;
    for (let t = 0; t < 60 * 6; t++) {
      r.tick();
      hp = r.state.players[0]?.hp ?? 0;
      if (hp < full) break;
    }
    expect(hp).toBeLessThan(full);
  });

  it("a party that kills everything walks through every door and completes", () => {
    const r = run([1, 2]);
    const ended: RunEnd[] = [];
    let seq = 0;
    for (let t = 0; t < 60 * 40 && ended.length === 0; t++) {
      for (const id of [1, 2]) r.queueInput(id, seq, east);
      seq++;
      // Stand-in for fighting: enemies die as soon as they appear.
      r.setStateForTest({ ...r.state, enemies: [] });
      ended.push(...r.tick().ended);
    }
    expect(ended.map((e) => [e.playerId, e.result])).toEqual([
      [1, "completed"],
      [2, "completed"],
    ]);
    expect(r.isEmpty).toBe(true);
    // The optional den was never entered.
    const den = GW.rooms.findIndex((room) => room.id === "den");
    expect(r.roomProgress[den]?.status).toBe("dormant");
  });

  /** A run whose every room up to the throne is cleared and the Warlord is in place. */
  function atTheWarlord(players: number[]) {
    const r = run(players);
    let seq = 0;
    // Walk everyone east, killing everything except the Warlord, until it appears.
    for (let t = 0; t < 60 * 40; t++) {
      if (r.state.enemies.some((e) => e.kind === "warlord")) break;
      for (const id of players) r.queueInput(id, seq, east);
      seq++;
      r.setStateForTest({ ...r.state, enemies: [] });
      r.tick();
    }
    return { r, seq };
  }
  const place = (r: DungeonInstance, id: number, x: number, y: number) =>
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) =>
        p.id === id ? { ...p, position: { x, y } } : p,
      ),
    });
  const killWarlord = (r: DungeonInstance) =>
    r.setStateForTest({
      ...r.state,
      enemies: r.state.enemies.map((e) =>
        e.kind === "warlord" ? { ...e, hp: 0 } : e,
      ),
    });

  it("the Warlord waits in the throne room; the portal opens only when it dies", () => {
    const { r } = atTheWarlord([1]);
    const boss = r.state.enemies.find((e) => e.kind === "warlord");
    expect(boss).toMatchObject({
      position: { x: 3780, y: 1000 },
      hp: WARLORD.maxHp,
    });
    expect(r.portalOpen).toBe(false);
    killWarlord(r);
    r.tick(); // the Warlord is removed
    r.tick(); // the throne room clears
    expect(r.portalOpen).toBe(true);
    expect((r.snapshot(1) as Snapshot).portalOpen).toBe(true);
  });

  it("each player completes by stepping into the portal; the others play on (D-057)", () => {
    const { r } = atTheWarlord([1, 2]);
    killWarlord(r);
    place(r, 1, 3600, 1000);
    place(r, 2, 3600, 1100);
    r.tick();
    r.tick();
    expect(r.portalOpen).toBe(true);
    expect(r.playerIds).toEqual([1, 2]); // nobody completes just by the kill
    place(r, 1, 3780, 1010);
    const { ended } = r.tick();
    expect(ended).toEqual([
      expect.objectContaining({ playerId: 1, result: "completed" }),
    ]);
    expect(r.playerIds).toEqual([2]);
  });

  it("reports each player's own outcome: completed through the portal, or left (D-010)", () => {
    const { r } = atTheWarlord([1, 2, 3]);
    killWarlord(r);
    r.tick();
    r.tick();
    expect(r.leave(3)).toMatchObject({ result: "left" });
    place(r, 1, 3780, 1000);
    place(r, 2, 3780, 1000);
    const { ended } = r.tick();
    expect(ended.map((e) => [e.playerId, e.result])).toEqual([
      [1, "completed"],
      [2, "completed"],
    ]);
  });

  it("dying after the Warlord but before the portal still earns no completion", () => {
    const { r } = atTheWarlord([1]);
    killWarlord(r);
    r.tick();
    r.tick();
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        position: { x: 3600, y: 1000 },
        hp: 0.1,
      })),
      hazards: [
        {
          position: { x: 3600, y: 1000 },
          radius: 32,
          damage: 3,
          landsIn: 0,
          ownerId: 1,
        },
      ],
    });
    const { ended } = r.tick();
    expect(ended).toEqual([
      expect.objectContaining({ playerId: 1, result: "died" }),
    ]);
  });

  it("snapshots carry brute telegraphs and hazards", () => {
    const { r } = atTheWarlord([1]);
    r.setStateForTest({
      ...r.state,
      hazards: [
        {
          position: { x: 3600, y: 1000 },
          radius: 32,
          damage: 3,
          landsIn: 1,
          ownerId: 1,
        },
      ],
    });
    const snap = r.snapshot(1) as Snapshot;
    expect(snap.hazards).toEqual([
      { x: 3600, y: 1000, radius: 32, landsIn: 1, kind: "boulder" },
    ]);
    expect(snap.enemies.find((e) => e.kind === "warlord")?.alert).toBe(false);
  });
});

describe("abilities reach the snapshot (10b)", () => {
  it("a Chain Lightning cast on the player timeline is sent once, with its path", () => {
    const r = new DungeonInstance(1, "training", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      loadoutFor: () => ({
        stats: { ...SERF_BASE, mp: 40 },
        weaponTier: null,
        ability: { kind: "chainLightning", tier: 0 },
      }),
    });
    r.tick(); // the dummy spawns on the first tick
    r.snapshot(0);
    const s = r.state;
    r.setStateForTest({
      ...s,
      players: s.players.map((p) => ({ ...p, position: { x: 1200, y: 1100 } })),
    });
    r.queueInput(1, 0, {
      move: { x: 0, y: 0 },
      fire: { trigger: false, aim: null },
      ability: { x: 100, y: 0 }, // the training dummy at (1300, 1100)
    });
    r.tick();
    const snap = r.snapshot(1) as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snap.chains).toEqual([
      {
        by: 1,
        points: [
          { x: 1200, y: 1100 },
          { x: 1300, y: 1100 },
        ],
      },
    ]);
    expect((r.snapshot(2) as typeof snap).chains).toEqual([]); // sent once
  });

  it("a Nature's Reach patch shows in snapshots while it lasts", () => {
    const r = new DungeonInstance(1, "training", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      loadoutFor: () => ({
        stats: { ...SERF_BASE, mp: 40 },
        weaponTier: null,
        ability: { kind: "naturesReach", tier: 0 },
      }),
    });
    r.queueInput(1, 0, {
      move: { x: 0, y: 0 },
      fire: { trigger: false, aim: null },
      ability: { x: 100, y: 0 },
    });
    r.tick();
    const snap = r.snapshot(1) as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snap.zones).toHaveLength(1);
    expect(snap.zones[0]).toMatchObject({ radius: 60 });
  });
});

describe("cast-time flashes reach the snapshot (10c)", () => {
  it("a Curse cast on the player timeline sends its flash with its kind", () => {
    const r = new DungeonInstance(1, "training", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      loadoutFor: () => ({
        stats: { ...SERF_BASE, mp: 40 },
        weaponTier: null,
        ability: { kind: "curse", tier: 0 },
      }),
    });
    r.tick();
    r.snapshot(0);
    r.queueInput(1, 0, {
      move: { x: 0, y: 0 },
      fire: { trigger: false, aim: null },
      ability: { x: 100, y: 0 },
    });
    r.tick();
    const snap = r.snapshot(1) as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snap.blasts).toEqual([
      expect.objectContaining({ kind: "curse", by: 1, radius: 50 }),
    ]);
  });
});
