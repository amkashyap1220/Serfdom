import { describe, expect, it } from "vitest";
import { PLAYER_BODY, PLAYER_WEAPON, type Rect } from "@serfdom/shared";
import {
  DUMMY_POSITIONS,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "./test-world";

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("debug test world", () => {
  it("does not start the player inside a wall", () => {
    const body: Rect = {
      x: PLAYER_START.x - PLAYER_BODY.width / 2,
      y: PLAYER_START.y - PLAYER_BODY.height / 2,
      ...PLAYER_BODY,
    };
    expect(TEST_WALLS.filter((w) => overlaps(w, body))).toEqual([]);
  });

  it("keeps every wall inside the world", () => {
    for (const w of TEST_WALLS) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.width).toBeLessThanOrEqual(TEST_WORLD.width);
      expect(w.y + w.height).toBeLessThanOrEqual(TEST_WORLD.height);
    }
  });

  it("has one gap wider and one narrower than the player body", () => {
    const gapAt = (y: number): number => {
      const [left, right] = TEST_WALLS.filter((w) => w.y === y).sort(
        (a, b) => a.x - b.x,
      );
      if (!left || !right) throw new Error(`No gap walls at y=${y}`);
      return right.x - (left.x + left.width);
    };
    expect(gapAt(1250)).toBeGreaterThan(PLAYER_BODY.width);
    expect(gapAt(1400)).toBeLessThan(PLAYER_BODY.width);
  });
});

describe("target dummies", () => {
  it("are not inside walls", () => {
    for (const p of DUMMY_POSITIONS) {
      const box: Rect = { x: p.x - 8, y: p.y - 8, width: 16, height: 16 };
      expect(TEST_WALLS.filter((w) => overlaps(w, box))).toEqual([]);
    }
  });

  it("start outside auto-aim range so nothing fires on load", () => {
    for (const p of DUMMY_POSITIONS) {
      const d = Math.hypot(p.x - PLAYER_START.x, p.y - PLAYER_START.y);
      expect(d).toBeGreaterThan(PLAYER_WEAPON.range);
    }
  });
});
