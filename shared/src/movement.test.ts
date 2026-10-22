import { describe, expect, it } from "vitest";
import type { Rect, Vec2 } from "./geometry.ts";
import {
  directionFromInput,
  worldDirectionFromInput,
  NO_INPUT,
  stepMovement,
  type MoveInput,
} from "./movement.ts";

const BODY = { width: 16, height: 16 };
const SPEED = 150;
const DT = 1 / 60;
const STILL: Vec2 = { x: 0, y: 0 };

function keys(held: Partial<MoveInput>): MoveInput {
  return { ...NO_INPUT, ...held };
}

/** Direction a set of held keys produces (no view rotation). */
function dir(held: Partial<MoveInput>): Vec2 {
  return directionFromInput(keys(held));
}

function length(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y);
}

describe("directionFromInput", () => {
  it("is zero with no keys", () => {
    expect(directionFromInput(NO_INPUT)).toEqual({ x: 0, y: 0 });
  });

  it("maps W/S to negative/positive y (world y grows downward)", () => {
    expect(directionFromInput(keys({ up: true }))).toEqual({ x: 0, y: -1 });
    expect(directionFromInput(keys({ down: true }))).toEqual({ x: 0, y: 1 });
  });

  it("normalizes all four diagonals to length 1", () => {
    for (const d of [
      keys({ up: true, right: true }),
      keys({ up: true, left: true }),
      keys({ down: true, right: true }),
      keys({ down: true, left: true }),
    ]) {
      expect(length(directionFromInput(d))).toBeCloseTo(1, 12);
    }
  });

  it("cancels opposite keys", () => {
    expect(directionFromInput(keys({ left: true, right: true }))).toEqual({
      x: 0,
      y: 0,
    });
    // Up+down cancel, leaving pure right at full (not diagonal) speed.
    expect(
      directionFromInput(keys({ up: true, down: true, right: true })),
    ).toEqual({ x: 1, y: 0 });
  });
});

describe("worldDirectionFromInput (screen-relative movement, D-040)", () => {
  it("equals the screen direction with no rotation", () => {
    expect(worldDirectionFromInput(keys({ up: true }), 0)).toEqual({
      x: 0,
      y: -1,
    });
  });

  it("maps W to the world direction that appears as up on a rotated screen", () => {
    // The camera shows world vector v as rotateVec(v, r). For W to look like
    // "up" on screen, rotating the result by r must give (0, -1).
    for (const r of [Math.PI / 2, Math.PI / 4, 1.234, -2]) {
      const w = worldDirectionFromInput(keys({ up: true }), r);
      const onScreen = {
        x: w.x * Math.cos(r) - w.y * Math.sin(r),
        y: w.x * Math.sin(r) + w.y * Math.cos(r),
      };
      expect(onScreen.x).toBeCloseTo(0, 12);
      expect(onScreen.y).toBeCloseTo(-1, 12);
    }
  });

  it("keeps diagonals unit length at any rotation", () => {
    const w = worldDirectionFromInput(keys({ up: true, left: true }), 0.7);
    expect(length(w)).toBeCloseTo(1, 12);
  });

  it("is zero with no keys at any rotation", () => {
    expect(worldDirectionFromInput(NO_INPUT, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("stepMovement in open space", () => {
  const start = { x: 100, y: 100 };

  it("moves speed × dt in a straight line", () => {
    const p = stepMovement(start, dir({ right: true }), BODY, [], DT, SPEED);
    expect(p.x).toBeCloseTo(100 + SPEED * DT, 10);
    expect(p.y).toBe(100);
  });

  it("moves the same distance diagonally as straight", () => {
    const p = stepMovement(
      start,
      dir({ down: true, left: true }),
      BODY,
      [],
      DT,
      SPEED,
    );
    expect(length({ x: p.x - start.x, y: p.y - start.y })).toBeCloseTo(
      SPEED * DT,
      10,
    );
  });

  it("does not move with no input (instant stop)", () => {
    expect(stepMovement(start, STILL, BODY, [], DT, SPEED)).toEqual(start);
  });

  it("covers exactly the speed in one second of 60 steps", () => {
    let p = start;
    for (let i = 0; i < 60; i++) {
      p = stepMovement(p, dir({ up: true }), BODY, [], DT, SPEED);
    }
    expect(p.y).toBeCloseTo(100 - SPEED, 9);
  });
});

describe("stepMovement against walls", () => {
  // Wall whose left face is at x = 200, spanning y 0..400.
  const wall: Rect = { x: 200, y: 0, width: 32, height: 400 };

  it("stops flush against a wall instead of entering it", () => {
    // Body right edge at 199; one step would reach 201.5.
    const p = stepMovement(
      { x: 191, y: 100 },
      dir({ right: true }),
      BODY,
      [wall],
      DT,
      SPEED,
    );
    expect(p.x).toBe(200 - BODY.width / 2);
  });

  it("stays flush while still pushing into the wall (no jitter)", () => {
    const flush = { x: 192, y: 100 };
    const p = stepMovement(
      flush,
      dir({ right: true }),
      BODY,
      [wall],
      DT,
      SPEED,
    );
    expect(p).toEqual(flush);
  });

  it("can move away from a wall it is touching", () => {
    const p = stepMovement(
      { x: 192, y: 100 },
      dir({ left: true }),
      BODY,
      [wall],
      DT,
      SPEED,
    );
    expect(p.x).toBeLessThan(192);
  });

  it("slides along the wall when pushing diagonally into it", () => {
    const p = stepMovement(
      { x: 192, y: 100 },
      dir({ right: true, down: true }),
      BODY,
      [wall],
      DT,
      SPEED,
    );
    expect(p.x).toBe(192);
    expect(p.y).toBeGreaterThan(100);
  });

  it("moves freely along the outside of a wall it only touches edge-to-edge", () => {
    // Body bottom edge exactly on the top face of a floor-like wall.
    const floor: Rect = { x: 0, y: 300, width: 1000, height: 32 };
    const p = stepMovement(
      { x: 100, y: 292 },
      dir({ right: true }),
      BODY,
      [floor],
      DT,
      SPEED,
    );
    expect(p).toEqual({ x: 100 + SPEED * DT, y: 292 });
  });

  it("cannot tunnel through a thin wall with a huge step", () => {
    const thin: Rect = { x: 200, y: 0, width: 1, height: 400 };
    const p = stepMovement(
      { x: 100, y: 100 },
      dir({ right: true }),
      BODY,
      [thin],
      10, // 1500 px in one step
      SPEED,
    );
    expect(p.x).toBe(192);
  });

  it("stops at the nearest of several walls", () => {
    const near: Rect = { x: 150, y: 0, width: 10, height: 400 };
    const p = stepMovement(
      { x: 100, y: 100 },
      dir({ right: true }),
      BODY,
      [wall, near],
      10,
      SPEED,
    );
    expect(p.x).toBe(142);
  });

  it("stops in an inside corner on both axes", () => {
    const corner: Rect[] = [
      { x: 200, y: 0, width: 32, height: 400 }, // right wall
      { x: 0, y: 200, width: 400, height: 32 }, // floor
    ];
    let p = { x: 180, y: 180 };
    for (let i = 0; i < 60; i++) {
      p = stepMovement(
        p,
        dir({ right: true, down: true }),
        BODY,
        corner,
        DT,
        SPEED,
      );
    }
    expect(p).toEqual({ x: 192, y: 192 });
  });
});

describe("stepMovement through gaps", () => {
  // Two blocks with a vertical gap between x = 200 and x = 200 + gap.
  function gapWalls(gap: number): Rect[] {
    return [
      { x: 0, y: 200, width: 200, height: 32 },
      { x: 200 + gap, y: 200, width: 200, height: 32 },
    ];
  }

  function walkDown(x: number, walls: Rect[]): number {
    let p = { x, y: 150 };
    for (let i = 0; i < 120; i++) {
      p = stepMovement(p, dir({ down: true }), BODY, walls, DT, SPEED);
    }
    return p.y;
  }

  it("passes through a gap wider than the body", () => {
    expect(walkDown(212, gapWalls(24))).toBeGreaterThan(232);
  });

  it("passes through a gap exactly as wide as the body when aligned", () => {
    expect(walkDown(208, gapWalls(16))).toBeGreaterThan(232);
  });

  it("is blocked by a gap narrower than the body", () => {
    expect(walkDown(206, gapWalls(12))).toBe(192);
  });
});

describe("stepMovement input validation", () => {
  const p = { x: 0, y: 0 };
  const right = dir({ right: true });

  it("rejects non-finite positions", () => {
    expect(() =>
      stepMovement({ x: Number.NaN, y: 0 }, right, BODY, [], DT, SPEED),
    ).toThrow(RangeError);
    expect(() =>
      stepMovement({ x: 0, y: Infinity }, right, BODY, [], DT, SPEED),
    ).toThrow(RangeError);
  });

  it("rejects negative or non-finite dt", () => {
    expect(() => stepMovement(p, right, BODY, [], -DT, SPEED)).toThrow(
      RangeError,
    );
    expect(() => stepMovement(p, right, BODY, [], Number.NaN, SPEED)).toThrow(
      RangeError,
    );
  });

  it("rejects a direction longer than 1 (would exceed speed)", () => {
    expect(() => stepMovement(p, { x: 1, y: 1 }, BODY, [], DT, SPEED)).toThrow(
      RangeError,
    );
    expect(() => stepMovement(p, { x: 2, y: 0 }, BODY, [], DT, SPEED)).toThrow(
      RangeError,
    );
  });

  it("rejects a non-finite direction", () => {
    expect(() =>
      stepMovement(p, { x: Number.NaN, y: 0 }, BODY, [], DT, SPEED),
    ).toThrow(RangeError);
  });

  it("accepts a rotated unit direction despite float rounding", () => {
    const d = worldDirectionFromInput(keys({ up: true, right: true }), 0.3);
    expect(() => stepMovement(p, d, BODY, [], DT, SPEED)).not.toThrow();
  });

  it("rejects negative or non-finite speed", () => {
    expect(() => stepMovement(p, right, BODY, [], DT, -1)).toThrow(RangeError);
    expect(() => stepMovement(p, right, BODY, [], DT, Infinity)).toThrow(
      RangeError,
    );
  });
});
