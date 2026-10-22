import { describe, expect, it } from "vitest";
import { boxAround, segmentHitTime } from "./collision.ts";

// A 16×16 box spanning x 100..116, y 100..116.
const box = { x: 100, y: 100, width: 16, height: 16 };

describe("segmentHitTime", () => {
  it("finds the entry time of a point moving straight in", () => {
    // From x=80 to x=120 (40 px); the left face at 100 is reached at t = 0.5.
    expect(segmentHitTime({ x: 80, y: 108 }, { x: 120, y: 108 }, 0, box)).toBe(
      0.5,
    );
  });

  it("accounts for the moving box's half-size", () => {
    // A 4×4 box (half 2) touches the face 2 px earlier: x=98 → t = 18/40.
    expect(
      segmentHitTime({ x: 80, y: 108 }, { x: 120, y: 108 }, 2, box),
    ).toBeCloseTo(18 / 40, 12);
  });

  it("returns null when the path misses", () => {
    expect(
      segmentHitTime({ x: 80, y: 50 }, { x: 120, y: 50 }, 2, box),
    ).toBeNull();
  });

  it("returns null when the path stops short", () => {
    expect(
      segmentHitTime({ x: 80, y: 108 }, { x: 95, y: 108 }, 2, box),
    ).toBeNull();
  });

  it("catches a fast path that jumps clean over the box", () => {
    expect(
      segmentHitTime({ x: 0, y: 108 }, { x: 1000, y: 108 }, 0, box),
    ).toBeCloseTo(0.1, 12);
  });

  it("returns 0 when already overlapping at the start", () => {
    expect(segmentHitTime({ x: 108, y: 108 }, { x: 200, y: 108 }, 0, box)).toBe(
      0,
    );
  });

  it("does not count grazing along an edge as a hit", () => {
    // Moving along y = 98 with half-size 2: the box's bottom edge is exactly
    // at the target's top face (100) the whole way.
    expect(
      segmentHitTime({ x: 80, y: 98 }, { x: 140, y: 98 }, 2, box),
    ).toBeNull();
  });

  it("handles diagonal paths", () => {
    const t = segmentHitTime({ x: 90, y: 90 }, { x: 110, y: 110 }, 0, box);
    expect(t).toBeCloseTo(0.5, 12);
  });
});

describe("boxAround", () => {
  it("centers a square box on the point", () => {
    expect(boxAround({ x: 10, y: 20 }, 16)).toEqual({
      x: 2,
      y: 12,
      width: 16,
      height: 16,
    });
  });
});
