import { PLAYER_SPEED, TICK_SECONDS } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import {
  applyInputsForTick,
  clampToUnit,
  MAX_INPUT_BACKLOG,
  MAX_MOVE_CREDIT,
  newPlayerMovement,
  queueInput,
} from "./player-movement.ts";
import { MessageRateLimiter } from "./rate-limit.ts";

const RIGHT = { x: 1, y: 0 };
const STEP = PLAYER_SPEED * TICK_SECONDS; // 2.5 px

describe("server player movement", () => {
  it("applies one input per tick at a steady pace and acks it", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    for (let seq = 0; seq < 10; seq++) {
      queueInput(pm, seq, RIGHT, 30);
      applyInputsForTick(pm, [], TICK_SECONDS);
      expect(pm.ack).toBe(seq);
    }
    expect(pm.position.x).toBeCloseTo(100 + 10 * STEP, 9);
  });

  it("stands still when no input is queued (no extrapolation)", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    applyInputsForTick(pm, [], TICK_SECONDS);
    expect(pm.position).toEqual({ x: 100, y: 100 });
    expect(pm.ack).toBe(-1);
  });

  it("catches up after a hiccup: a missed tick then two inputs are both applied", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    applyInputsForTick(pm, [], TICK_SECONDS); // nothing arrived: credit saved
    queueInput(pm, 0, RIGHT, 30);
    queueInput(pm, 1, RIGHT, 30);
    expect(applyInputsForTick(pm, [], TICK_SECONDS).applied).toBe(2);
    expect(pm.ack).toBe(1);
    expect(pm.queue).toHaveLength(0);
  });

  it("drops a backlog beyond the limit so inputs never wait long", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    for (let seq = 0; seq < 10; seq++) queueInput(pm, seq, RIGHT, 30);
    const r = applyInputsForTick(pm, [], TICK_SECONDS);
    expect(r).toEqual({ applied: 1, dropped: 10 - 1 - MAX_INPUT_BACKLOG });
    // Only the newest MAX_INPUT_BACKLOG inputs are kept.
    const kept = Array.from(
      { length: MAX_INPUT_BACKLOG },
      (_, i) => 10 - MAX_INPUT_BACKLOG + i,
    );
    expect(pm.queue.map((q) => q.seq)).toEqual(kept);
    // Dropped inputs count as processed, so the client stops replaying them.
    expect(pm.ack).toBe(9 - MAX_INPUT_BACKLOG);
  });

  it("can never exceed PLAYER_SPEED over time, even sending 5 inputs every tick", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    let seq = 0;
    const ticks = 600; // 10 s
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < 5; i++) queueInput(pm, seq++, RIGHT, 30);
      applyInputsForTick(pm, [], TICK_SECONDS);
    }
    expect(pm.position.x).toBeLessThanOrEqual(
      (ticks + MAX_MOVE_CREDIT) * STEP + 1e-9,
    );
  });

  it("saves at most MAX_MOVE_CREDIT ticks of credit while idle", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    for (let t = 0; t < 100; t++) applyInputsForTick(pm, [], TICK_SECONDS);
    for (let seq = 0; seq < 10; seq++) queueInput(pm, seq, RIGHT, 30);
    expect(applyInputsForTick(pm, [], TICK_SECONDS).applied).toBe(
      MAX_MOVE_CREDIT,
    );
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

  it("drops inputs beyond the hard queue cap but still records the seq", () => {
    const pm = newPlayerMovement({ x: 0, y: 0 });
    for (let seq = 0; seq < 30; seq++) queueInput(pm, seq, RIGHT, 30);
    expect(queueInput(pm, 30, RIGHT, 30).kind).toBe("dropped");
    expect(pm.lastReceivedSeq).toBe(30);
  });

  it("collides with walls exactly like the client", () => {
    const pm = newPlayerMovement({ x: 100, y: 100 });
    const wall = { x: 120, y: 0, width: 10, height: 400 };
    for (let seq = 0; seq < 30; seq++) {
      queueInput(pm, seq, RIGHT, 30);
      applyInputsForTick(pm, [wall], TICK_SECONDS);
    }
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
    expect(() => applyInputsForTick(pm, [], TICK_SECONDS)).not.toThrow();
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
