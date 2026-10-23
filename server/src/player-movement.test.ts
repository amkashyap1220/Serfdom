import { PLAYER_SPEED, TICK_SECONDS } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import {
  applyNextInput,
  clampToUnit,
  newPlayerMovement,
  queueInput,
} from "./player-movement.ts";
import { MessageRateLimiter } from "./rate-limit.ts";

const RIGHT = { x: 1, y: 0 };

describe("server player movement", () => {
  it("applies one queued input per tick and acks its seq", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    queueInput(pm, 0, RIGHT, 30);
    queueInput(pm, 1, RIGHT, 30);
    applyNextInput(pm, [], TICK_SECONDS);
    expect(pm.position.x).toBeCloseTo(100 + PLAYER_SPEED * TICK_SECONDS, 9);
    expect(pm.ack).toBe(0);
    applyNextInput(pm, [], TICK_SECONDS);
    expect(pm.ack).toBe(1);
  });

  it("stands still when no input is queued (no extrapolation)", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    applyNextInput(pm, [], TICK_SECONDS);
    expect(pm.position).toEqual({ x: 100, y: 100 });
    expect(pm.ack).toBe(-1);
  });

  it("cannot be sped up by flooding inputs: at most PLAYER_SPEED per second", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    for (let seq = 0; seq < 1000; seq++) queueInput(pm, seq, RIGHT, 30);
    for (let tick = 0; tick < 60; tick++) applyNextInput(pm, [], TICK_SECONDS);
    expect(pm.position.x).toBeLessThanOrEqual(PLAYER_SPEED * (30 / 60) + 1e-9);
  });

  it("drops inputs beyond the queue limit but still records the seq", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    for (let seq = 0; seq < 30; seq++) {
      expect(queueInput(pm, seq, RIGHT, 30).kind).toBe("queued");
    }
    expect(queueInput(pm, 30, RIGHT, 30).kind).toBe("dropped");
    expect(pm.lastReceivedSeq).toBe(30);
  });

  it("rejects repeated or decreasing seq numbers", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    queueInput(pm, 5, RIGHT, 30);
    expect(queueInput(pm, 5, RIGHT, 30)).toEqual({
      kind: "rejected",
      reason: "input seq must increase",
    });
    expect(queueInput(pm, 3, RIGHT, 30).kind).toBe("rejected");
  });

  it("collides with walls exactly like the client", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    const wall = { x: 120, y: 0, width: 10, height: 400 };
    for (let seq = 0; seq < 30; seq++) queueInput(pm, seq, RIGHT, 30);
    for (let t = 0; t < 30; t++) applyNextInput(pm, [wall], TICK_SECONDS);
    expect(pm.position.x).toBe(112);
  });
});

describe("clampToUnit", () => {
  it("leaves unit and shorter vectors alone", () => {
    expect(clampToUnit({ x: 0.6, y: 0.8 })).toEqual({ x: 0.6, y: 0.8 });
    expect(clampToUnit({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("normalizes a vector a hair over length 1 so stepMovement never throws", () => {
    const v = clampToUnit({ x: 1 + 5e-7, y: 0 });
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1);
    const pm = newPlayerMovement({ x: 0, y: 0 });
    queueInput(pm, 0, { x: 1 + 5e-7, y: 0 }, 30);
    expect(() => applyNextInput(pm, [], TICK_SECONDS)).not.toThrow();
  });
});

describe("MessageRateLimiter", () => {
  it("allows up to the limit per window, then refuses until the next window", () => {
    const rl = new MessageRateLimiter(3, 1000);
    expect([rl.hit(0), rl.hit(10), rl.hit(20), rl.hit(30)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(rl.hit(1000)).toBe(true);
  });
});
