import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  PLAYER_SPEED,
  TICK_SECONDS,
  type PlayerInput,
  type SimState,
  type SnapshotPlayer,
} from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { INTERPOLATION_DELAY_MS, RemoteInterpolator } from "./interpolation";
import { LocalShots } from "./local-shots";
import { PlayerPredictor } from "./prediction";

const STEP = PLAYER_SPEED * TICK_SECONDS; // 2.5 px per tick
const MOVE_RIGHT: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};
const SHOOT_UP: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 0, y: -1 } },
};

/** A snapshot entry for player 1 as the server would send it. */
function server(
  x: number,
  ack: number,
  extra: Partial<SnapshotPlayer> = {},
): SnapshotPlayer {
  return { id: 1, x, y: 0, ack, hp: 200, maxHp: 200, cooldown: 0, ...extra };
}

function predictor(walls = []) {
  const p = new PlayerPredictor(1, { x: 0, y: 0 }, walls);
  p.reset(server(0, -1));
  return p;
}

describe("PlayerPredictor", () => {
  it("moves immediately and numbers inputs from 0", () => {
    const p = predictor();
    expect(p.predict(MOVE_RIGHT).seq).toBe(0);
    expect(p.predict(MOVE_RIGHT).seq).toBe(1);
    expect(p.position.x).toBeCloseTo(2 * STEP, 9);
    expect(p.pendingCount).toBe(2);
  });

  it("does not visibly move when the server agrees (zero correction)", () => {
    const p = predictor();
    for (let i = 0; i < 10; i++) p.predict(MOVE_RIGHT);
    p.reconcile(server(6 * STEP, 5));
    expect(p.position.x).toBeCloseTo(10 * STEP, 9);
    expect(p.lastCorrection).toBeCloseTo(0, 9);
    expect(p.pendingCount).toBe(4);
  });

  it("snaps to the server and replays pending inputs when they disagree", () => {
    const p = predictor();
    for (let i = 0; i < 10; i++) p.predict(MOVE_RIGHT);
    p.reconcile(server(2 * STEP, 5));
    expect(p.position.x).toBeCloseTo(6 * STEP, 9);
    expect(p.lastCorrection).toBeCloseTo(4 * STEP, 9);
  });

  it("predicts shots with the fire-rate rule: immediately, then every 15 ticks", () => {
    const p = predictor();
    const fired: number[] = [];
    for (let i = 0; i < 31; i++) if (p.predict(SHOOT_UP).shot) fired.push(i);
    expect(fired).toEqual([0, 15, 30]);
  });

  it("predicts exactly the shots and positions the server computes for the same inputs", () => {
    // Same inputs through the predictor and through the server's rule.
    const inputs: PlayerInput[] = Array.from({ length: 40 }, (_, i) => ({
      move: { x: Math.SQRT1_2, y: i % 2 ? Math.SQRT1_2 : -Math.SQRT1_2 },
      fire: { trigger: true, aim: { x: 0.6, y: 0.8 } },
    }));
    const p = predictor();
    let sim: SimState = addPlayer(createSimState([]), 1, { x: 0, y: 0 });
    for (const input of inputs) {
      const local = p.predict(input);
      const before = sim.projectiles.length;
      sim = applyPlayerInput(sim, 1, input, [], TICK_SECONDS).state;
      const serverShot = sim.projectiles[before] ?? null;
      expect(local.shot?.position ?? null).toEqual(
        serverShot?.position ?? null,
      );
      expect(p.position).toEqual(sim.players[0]!.position);
    }
  });

  it("does not re-fire shots while replaying", () => {
    const p = predictor();
    p.predict(SHOOT_UP); // fires (seq 0)
    p.predict(SHOOT_UP);
    // Reconciling replays seq 1; there is no way for it to return a shot.
    p.reconcile(server(0, 0, { cooldown: 0.25 - TICK_SECONDS }));
    expect(p.pendingCount).toBe(1);
  });

  it("uses server HP: a dead player's predicted inputs do nothing", () => {
    const p = predictor();
    p.reconcile(server(0, -1, { hp: 0 }));
    p.predict(MOVE_RIGHT);
    expect(p.position.x).toBe(0);
    expect(p.predict(SHOOT_UP).shot).toBeNull();
  });

  it("caps unacknowledged inputs if the server stops answering", () => {
    const p = predictor();
    for (let i = 0; i < 500; i++) p.predict(MOVE_RIGHT);
    expect(p.pendingCount).toBe(120);
  });
});

describe("LocalShots", () => {
  const shot = {
    id: 1,
    owner: "player" as const,
    ownerId: 1,
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 400,
    remaining: 300,
    damage: 25,
    size: 4,
  };

  it("flies straight and expires at max range", () => {
    const s = new LocalShots();
    s.add(shot);
    s.step(0.25, [], []);
    expect(s.list[0]?.position.x).toBe(100);
    for (let i = 0; i < 10; i++) s.step(0.25, [], []);
    expect(s.list).toHaveLength(0);
  });

  it("vanishes on hitting an enemy box or a wall (visual only)", () => {
    const s = new LocalShots();
    s.add(shot);
    s.step(1, [], [{ id: 1, box: { x: 50, y: -8, width: 16, height: 16 } }]);
    expect(s.list).toHaveLength(0);
    s.add(shot);
    s.step(1, [{ x: 30, y: -50, width: 5, height: 100 }], []);
    expect(s.list).toHaveLength(0);
  });
});

describe("RemoteInterpolator", () => {
  const at = (x: number) => new Map([[7, { x, y: 0 }]]);
  const D = INTERPOLATION_DELAY_MS;

  it("blends between the two snapshots around (now - delay)", () => {
    const r = new RemoteInterpolator();
    r.push(1000, at(0));
    r.push(1050, at(10));
    expect(r.sample(1025 + D).get(7)?.x).toBeCloseTo(5, 9);
  });

  it("holds the newest position instead of extrapolating", () => {
    const r = new RemoteInterpolator();
    r.push(1000, at(0));
    r.push(1050, at(10));
    expect(r.sample(5000).get(7)?.x).toBe(10);
  });

  it("holds the oldest position before the first snapshot's time", () => {
    const r = new RemoteInterpolator();
    r.push(1000, at(3));
    r.push(1050, at(10));
    expect(r.sample(0).get(7)?.x).toBe(3);
  });

  it("drops players missing from the newer snapshot and shows new ones at once", () => {
    const r = new RemoteInterpolator();
    r.push(1000, new Map([[1, { x: 0, y: 0 }]]));
    r.push(1050, new Map([[2, { x: 5, y: 5 }]]));
    const s = r.sample(1025 + D);
    expect(s.has(1)).toBe(false);
    expect(s.get(2)).toEqual({ x: 5, y: 5 });
  });

  it("is empty before any snapshot", () => {
    expect(new RemoteInterpolator().sample(1000).size).toBe(0);
  });
});
