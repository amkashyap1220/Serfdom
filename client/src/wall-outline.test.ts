import { describe, expect, it } from "vitest";
import { buildWarrens, type Rect } from "@serfdom/shared";
import { wallOutline, type Segment } from "./wall-outline";

const length = (segments: Segment[]) =>
  segments.reduce(
    (n, s) => n + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1),
    0,
  );

describe("wallOutline", () => {
  it("outlines a lone wall on all four sides", () => {
    const wall: Rect = { x: 0, y: 0, width: 100, height: 32 };
    expect(length(wallOutline([wall]))).toBe(2 * 100 + 2 * 32);
  });

  it("draws no seam where two wall pieces overlap at a corner", () => {
    // An L-shaped corner, as the generator makes at every room corner: a
    // horizontal piece and a vertical piece overlapping its end.
    const top: Rect = { x: 0, y: 0, width: 100, height: 32 };
    const side: Rect = { x: 68, y: 0, width: 32, height: 132 };
    const segments = wallOutline([top, side]);
    // The vertical piece's left edge only shows below the horizontal one…
    const left = segments.filter((s) => s.x1 === 68.5 && s.x2 === 68.5);
    expect(left).toEqual([{ x1: 68.5, y1: 32, x2: 68.5, y2: 132 }]);
    // …and the horizontal piece's bottom edge stops where the other begins.
    const bottom = segments.filter((s) => s.y1 === 31.5 && s.y2 === 31.5);
    expect(bottom).toEqual([{ x1: 0, y1: 31.5, x2: 68, y2: 31.5 }]);
  });

  it("two pieces end to end outline like one wall", () => {
    const a: Rect = { x: 0, y: 0, width: 50, height: 32 };
    const b: Rect = { x: 50, y: 0, width: 50, height: 32 };
    expect(length(wallOutline([a, b]))).toBe(2 * 100 + 2 * 32);
  });

  it("generated maps never draw a line through solid wall", () => {
    for (const seed of [1, 2, 3, 11, 12, 13]) {
      const { walls } = buildWarrens(seed);
      const deepInWall = (x: number, y: number) =>
        walls.some(
          (w) =>
            x > w.x + 1 &&
            x < w.x + w.width - 1 &&
            y > w.y + 1 &&
            y < w.y + w.height - 1,
        );
      for (const s of wallOutline(walls)) {
        for (let t = 0.05; t < 1; t += 0.1) {
          const x = s.x1 + (s.x2 - s.x1) * t;
          const y = s.y1 + (s.y2 - s.y1) * t;
          expect(deepInWall(x, y), `seed ${seed}: ${x},${y}`).toBe(false);
        }
      }
    }
  });
});
