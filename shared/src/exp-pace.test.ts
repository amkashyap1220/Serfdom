import { describe, expect, it } from "vitest";
import type { DungeonId } from "./dungeons.ts";
import {
  clearExp,
  levelForExp,
  MAX_LEVEL,
  DUNGEON_EXP,
} from "./progression.ts";

/*
 * Phase 13's acceptance (D-071, D-108, D-126): a serf progressing through
 * the five tiers reaches level 20 in about five dungeons' worth of clears,
 * measured here from the real formulas.
 */

/** The first five dungeons, the 1–20 ladder, in order. */
const LADDER: DungeonId[] = [
  "goblin-warrens",
  "goblin-stronghold",
  "forgotten-crypt",
  "ember-forge",
  "sunken-temple",
];

/** The ladder dungeon aimed at `level`: the first whose top level is above it (the last at 20). */
function aimedAt(level: number): DungeonId {
  return LADDER.find((d) => level < DUNGEON_EXP[d].topLevel) ?? LADDER.at(-1)!;
}

/** Clears, per dungeon, for a serf that always runs the dungeon aimed at its level. */
function climb(): { clears: Map<DungeonId, number>; total: number } {
  let exp = 0;
  const clears = new Map<DungeonId, number>();
  let total = 0;
  while (levelForExp(exp) < MAX_LEVEL && total < 1000) {
    const d = aimedAt(levelForExp(exp));
    exp += clearExp(d, levelForExp(exp));
    clears.set(d, (clears.get(d) ?? 0) + 1);
    total++;
  }
  return { clears, total };
}

describe("the EXP pace through the ladder (D-071, D-108)", () => {
  it("a serf climbing the five tiers reaches level 20 in 29 clears, every tier in order", () => {
    const { clears, total } = climb();
    expect([...clears.keys()]).toEqual(LADDER);
    // Measured from the real formulas (Phase 13 acceptance): the Warrens'
    // 13 come from its own approved numbers (100 EXP, levels 1–9); each
    // later tier takes 3–5. About five dungeons' worth, against D-071's 75
    // clears for the Warrens alone.
    expect(LADDER.map((d) => clears.get(d))).toEqual([13, 4, 5, 4, 3]);
    expect(total).toBe(29);
  });

  it("the endgame dungeons are past the cap: level 20 adds only to the lifetime total", () => {
    for (const d of [
      "frost-hollow",
      "clockwork-vault",
      "abyssal-gauntlet",
      "stormspire",
      "dragons-roost",
    ] as DungeonId[]) {
      expect(DUNGEON_EXP[d].topLevel).toBe(MAX_LEVEL);
      expect(clearExp(d, 20)).toBeGreaterThan(0);
    }
  });
});
