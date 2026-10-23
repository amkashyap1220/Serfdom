import {
  buildWarrens,
  GOBLIN_WARRENS,
  SERF_BASE,
  GRUNT,
  WARLORD,
  PLAYER_HEALTH,
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

describe("DungeonInstance layouts (D-104)", () => {
  it("builds the generated Warrens for its seed; seed 0 is the handcrafted one", () => {
    const seeded = new DungeonInstance(1, "goblin-warrens", [1], {
      maxQueuedInputs: 30,
      joinWindowTicks: 900,
      seed: 1234,
    });
    const layout = buildWarrens(1234);
    expect(seeded.seed).toBe(1234);
    expect([...seeded.closedDoors].sort()).toEqual(
      layout.doors.map((d) => d.id).sort(),
    );
    expect(seeded.state.players[0]?.position).toEqual(layout.spawn);
    expect(run([1]).seed).toBe(0);
    expect(run([1]).state.players[0]?.position).toEqual(GW.spawn);
  });
});

describe("DungeonInstance in the Goblin Warrens", () => {
  it("starts in the entrance; the first door opens on the first tick", () => {
    const r = run([1]);
    expect(r.closedDoors).toContain("entrance-tunnel");
    r.tick();
    expect(r.closedDoors).not.toContain("entrance-tunnel");
    expect(r.state.enemies).toEqual([]);
    const snap = r.snapshot(1) as Snapshot;
    expect(snap.closedDoors).toEqual([
      "tunnel-camp",
      "camp-den",
      "camp-ambush",
      "ambush-guard",
      "guard-throne",
    ]);
  });

  it("a closed door stops a player the server moves", () => {
    const r = run([1]);
    r.tick();
    // Put the player at the tunnel's east end, facing the closed camp door.
    r.setStateForTest({
      ...r.state,
      players: r.state.players.map((p) => ({
        ...p,
        position: { x: 1300, y: 1000 },
      })),
    });
    for (let seq = 0; seq < 60; seq++) {
      r.queueInput(1, seq, east);
      r.tick();
    }
    // Body (16 px) flush against the door at x = 1332.
    expect(r.state.players[0]?.position.x).toBeCloseTo(1332 - 8, 9);
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
      { x: 3600, y: 1000, radius: 32, landsIn: 1 },
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
