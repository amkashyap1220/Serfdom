import {
  GOBLIN_WARRENS,
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
    rollReward: rolls(),
  });
/** A fixed sequence of rolls: 101, 102, 103, … */
function rolls() {
  let next = 101;
  return () => next++;
}
const east = { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } };

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

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
    expect(snap.enemies[0]).toMatchObject({ kind: "grunt", hp: 150 });
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
    expect(boss).toMatchObject({ position: { x: 3780, y: 1000 }, hp: 4500 });
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

  it("rolls a separate reward for each completing player, and none on death or exit (D-010)", () => {
    const { r } = atTheWarlord([1, 2, 3]);
    killWarlord(r);
    r.tick();
    r.tick();
    expect(r.leave(3)).toMatchObject({ result: "left", reward: null });
    place(r, 1, 3780, 1000);
    place(r, 2, 3780, 1000);
    const { ended } = r.tick();
    expect(ended.map((e) => [e.playerId, e.reward])).toEqual([
      [1, { roll: 101 }],
      [2, { roll: 102 }],
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
