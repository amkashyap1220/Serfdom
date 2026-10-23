import { describe, expect, it } from "vitest";
import {
  CLASS_CHOICE_LEVEL,
  clearExp,
  expToNextLevel,
  levelForExp,
  levelProgress,
  MAX_LEVEL,
  totalExpForLevel,
} from "./progression.ts";

/** Clears of one dungeon, starting at level 1, until `level` is reached. */
function clearsToReach(level: number): number {
  let exp = 0;
  let clears = 0;
  while (levelForExp(exp) < level) {
    exp += clearExp("goblin-warrens", levelForExp(exp));
    clears++;
  }
  return clears;
}

describe("EXP curve (T-045)", () => {
  it("costs 100 for the first level, then 15 more per level", () => {
    expect([1, 2, 3, 19].map(expToNextLevel)).toEqual([100, 115, 130, 370]);
    expect(expToNextLevel(MAX_LEVEL)).toBe(0);
    expect(totalExpForLevel(20)).toBe(4465);
  });

  it("level is 1 at zero EXP and never passes 20, while EXP keeps counting", () => {
    expect(levelForExp(0)).toBe(1);
    expect(levelForExp(99)).toBe(1);
    expect(levelForExp(100)).toBe(2);
    expect(levelForExp(4464)).toBe(19);
    expect(levelForExp(4465)).toBe(20);
    expect(levelForExp(1_000_000)).toBe(20);
  });

  it("reports progress within the level", () => {
    expect(levelProgress(130)).toEqual({ level: 2, into: 30, needed: 115 });
    expect(levelProgress(9000)).toEqual({
      level: 20,
      into: 9000 - 4465,
      needed: 0,
    });
  });

  it("every level boundary is exact", () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const at = totalExpForLevel(level);
      expect(levelForExp(at)).toBe(level);
      expect(levelForExp(at - 1)).toBe(level - 1);
    }
  });
});

describe("EXP falloff above a dungeon's level range (D-071)", () => {
  it("gives the Goblin Warrens' full 100 EXP through level 9", () => {
    for (let level = 1; level <= 9; level++) {
      expect(clearExp("goblin-warrens", level)).toBe(100);
    }
  });

  it("gives 10% less per level above 9, never less than 1", () => {
    expect(clearExp("goblin-warrens", 10)).toBe(90);
    expect(clearExp("goblin-warrens", 12)).toBe(73);
    expect(clearExp("goblin-warrens", 20)).toBe(31);
    expect(clearExp("goblin-warrens", 500)).toBe(1);
  });

  it("matches the pace: one level per clear at most, the Warrens alone take ~75 clears to 20", () => {
    expect(clearsToReach(2)).toBe(1); // a level-up on the very first clear
    expect(clearsToReach(3)).toBe(3); // the second clear does not level
    expect(clearsToReach(CLASS_CHOICE_LEVEL)).toBe(5); // class choice (D-073)
    expect(clearsToReach(9)).toBe(13);
    expect(clearsToReach(20)).toBe(73);
  });

  it("no Goblin Warrens clear ever gives more than one level", () => {
    let exp = 0;
    while (levelForExp(exp) < MAX_LEVEL) {
      const before = levelForExp(exp);
      exp += clearExp("goblin-warrens", before);
      expect(levelForExp(exp) - before).toBeLessThanOrEqual(1);
    }
  });
});
