import type { PlayerInput } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import {
  clampToUnit,
  MAX_INPUT_BACKLOG,
  MAX_MOVE_CREDIT,
  newInputQueue,
  queueInput,
  takeInputsForTick,
} from "./input-queue.ts";
import { MessageRateLimiter } from "./rate-limit.ts";

const RIGHT: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};

describe("input queue", () => {
  it("takes one input per tick at a steady pace and acks it", () => {
    const q = newInputQueue();
    for (let seq = 0; seq < 10; seq++) {
      queueInput(q, seq, RIGHT, 30);
      expect(takeInputsForTick(q).apply).toHaveLength(1);
      expect(q.ack).toBe(seq);
    }
  });

  it("takes nothing when nothing is queued (no extrapolation)", () => {
    const q = newInputQueue();
    expect(takeInputsForTick(q)).toEqual({ apply: [], dropped: 0 });
    expect(q.ack).toBe(-1);
  });

  it("catches up after a hiccup: a missed tick then two inputs are both taken", () => {
    const q = newInputQueue();
    takeInputsForTick(q); // nothing arrived: credit saved
    queueInput(q, 0, RIGHT, 30);
    queueInput(q, 1, RIGHT, 30);
    expect(takeInputsForTick(q).apply).toHaveLength(2);
    expect(q.ack).toBe(1);
  });

  it("drops a backlog beyond the limit so inputs never wait long", () => {
    const q = newInputQueue();
    for (let seq = 0; seq < 10; seq++) queueInput(q, seq, RIGHT, 30);
    const r = takeInputsForTick(q);
    expect(r.apply).toHaveLength(1);
    expect(r.dropped).toBe(10 - 1 - MAX_INPUT_BACKLOG);
    // Dropped inputs count as processed, so the client stops replaying them.
    expect(q.ack).toBe(9 - MAX_INPUT_BACKLOG);
  });

  it("never takes more than (ticks + MAX_MOVE_CREDIT) inputs, even with 5 sent every tick", () => {
    const q = newInputQueue();
    let seq = 0;
    let taken = 0;
    const ticks = 600;
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < 5; i++) queueInput(q, seq++, RIGHT, 30);
      taken += takeInputsForTick(q).apply.length;
    }
    expect(taken).toBeLessThanOrEqual(ticks + MAX_MOVE_CREDIT);
  });

  it("saves at most MAX_MOVE_CREDIT ticks of credit while idle", () => {
    const q = newInputQueue();
    for (let t = 0; t < 100; t++) takeInputsForTick(q);
    for (let seq = 0; seq < 10; seq++) queueInput(q, seq, RIGHT, 30);
    expect(takeInputsForTick(q).apply).toHaveLength(MAX_MOVE_CREDIT);
  });

  it("rejects repeated or decreasing seq numbers", () => {
    const q = newInputQueue();
    queueInput(q, 5, RIGHT, 30);
    expect(queueInput(q, 5, RIGHT, 30)).toEqual({
      kind: "rejected",
      reason: "input seq must increase",
    });
    expect(queueInput(q, 3, RIGHT, 30).kind).toBe("rejected");
  });

  it("drops inputs beyond the hard queue cap but still records the seq", () => {
    const q = newInputQueue();
    for (let seq = 0; seq < 30; seq++) queueInput(q, seq, RIGHT, 30);
    expect(queueInput(q, 30, RIGHT, 30).kind).toBe("dropped");
    expect(q.lastReceivedSeq).toBe(30);
  });

  it("normalizes move and aim so the shared sim never sees a bad vector", () => {
    const q = newInputQueue();
    queueInput(
      q,
      0,
      {
        move: { x: 1 + 5e-7, y: 0 },
        fire: { trigger: true, aim: { x: 0, y: 1 + 5e-7 } },
      },
      30,
    );
    const [input] = takeInputsForTick(q).apply;
    expect(Math.hypot(input!.move.x, input!.move.y)).toBeLessThanOrEqual(1);
    expect(Math.hypot(input!.fire.aim!.x, input!.fire.aim!.y)).toBeCloseTo(
      1,
      15,
    );
  });
});

describe("clampToUnit", () => {
  it("leaves unit and shorter vectors alone", () => {
    expect(clampToUnit({ x: 0.6, y: 0.8 })).toEqual({ x: 0.6, y: 0.8 });
    expect(clampToUnit({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
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

describe("ability targets survive the queue (10a)", () => {
  it("keeps the cast target with the input", () => {
    const q = newInputQueue();
    queueInput(
      q,
      0,
      {
        move: { x: 0, y: 0 },
        fire: { trigger: false, aim: null },
        ability: { x: 100, y: -20 },
      },
      30,
    );
    expect(takeInputsForTick(q).apply[0]?.ability).toEqual({ x: 100, y: -20 });
  });
});
