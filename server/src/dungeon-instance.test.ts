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
  });
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
});
