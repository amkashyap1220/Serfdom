import { PLAYER_SPEED, TICK_SECONDS } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { INTERPOLATION_DELAY_MS, RemoteInterpolator } from "./interpolation";
import { MovementPredictor } from "./prediction";

const RIGHT = { x: 1, y: 0 };
const STEP = PLAYER_SPEED * TICK_SECONDS; // 2.5 px per tick

describe("MovementPredictor", () => {
  it("moves immediately and numbers inputs from 0", () => {
    const p = new MovementPredictor({ x: 0, y: 0 }, []);
    expect(p.predict(RIGHT).seq).toBe(0);
    expect(p.predict(RIGHT).seq).toBe(1);
    expect(p.position.x).toBeCloseTo(2 * STEP, 9);
    expect(p.pendingCount).toBe(2);
  });

  it("does not visibly move when the server agrees (zero correction)", () => {
    const p = new MovementPredictor({ x: 0, y: 0 }, []);
    for (let i = 0; i < 10; i++) p.predict(RIGHT);
    // Server has applied inputs 0..5; it reports where that left us.
    p.reconcile({ x: 6 * STEP, y: 0 }, 5);
    expect(p.position.x).toBeCloseTo(10 * STEP, 9);
    expect(p.lastCorrection).toBeCloseTo(0, 9);
    expect(p.pendingCount).toBe(4);
  });

  it("snaps to the server and replays pending inputs when they disagree", () => {
    const p = new MovementPredictor({ x: 0, y: 0 }, []);
    for (let i = 0; i < 10; i++) p.predict(RIGHT);
    // Server dropped some inputs: after #5 it has us at only 2 steps.
    p.reconcile({ x: 2 * STEP, y: 0 }, 5);
    expect(p.position.x).toBeCloseTo(6 * STEP, 9); // 2 + 4 replayed
    expect(p.lastCorrection).toBeCloseTo(4 * STEP, 9);
  });

  it("replays through the same walls as the server", () => {
    const wall = { x: 20, y: -50, width: 10, height: 100 };
    const p = new MovementPredictor({ x: 0, y: 0 }, [wall]);
    for (let i = 0; i < 20; i++) p.predict(RIGHT);
    expect(p.position.x).toBe(12); // stopped flush by the wall
    p.reconcile({ x: 0, y: 0 }, -1); // server applied nothing yet
    expect(p.position.x).toBe(12);
  });

  it("caps unacknowledged inputs if the server stops answering", () => {
    const p = new MovementPredictor({ x: 0, y: 0 }, []);
    for (let i = 0; i < 500; i++) p.predict({ x: 0, y: 0 });
    expect(p.pendingCount).toBe(120);
  });

  it("reset clears pending inputs but keeps seq numbers increasing", () => {
    const p = new MovementPredictor({ x: 0, y: 0 }, []);
    p.predict(RIGHT);
    p.reset({ x: 500, y: 500 });
    expect(p.position).toEqual({ x: 500, y: 500 });
    expect(p.pendingCount).toBe(0);
    expect(p.predict(RIGHT).seq).toBe(1);
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
