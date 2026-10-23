import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { dungeonInfo, entryProblem, layoutFor } from "./dungeons.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import {
  buildStronghold,
  STRONGHOLD_PIECES,
  STRONGHOLD_RECIPE,
} from "./goblin-stronghold.ts";
import { WARRENS_PIECES, WARRENS_THRONE } from "./goblin-warrens.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
import { clearExp } from "./progression.ts";

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);
const hpOf = (key: string) =>
  pieceHp(STRONGHOLD_PIECES.find((p) => p.piece.key === key)!.piece);

describe("Goblin Stronghold (D-108)", () => {
  it("is listed after the Warrens and opens once the Warrens is completed", () => {
    const info = dungeonInfo("goblin-stronghold");
    expect(info).toMatchObject({ name: "Goblin Stronghold", listed: true });
    expect(entryProblem("goblin-stronghold", 0)).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(entryProblem("goblin-stronghold", 1)).toBeNull();
  });

  it("gives 160 EXP up to level 12, then 10% less per level above", () => {
    expect(clearExp("goblin-stronghold", 9)).toBe(160);
    expect(clearExp("goblin-stronghold", 12)).toBe(160);
    expect(clearExp("goblin-stronghold", 13)).toBe(144);
  });

  it("drops T2 30%, T3 45%, T4 25%", () => {
    expect(LOOT_POOLS["goblin-stronghold"].tiers).toEqual([
      [2, 30],
      [3, 45],
      [4, 25],
    ]);
  });

  it("every Warrens room returns with both its setups at once; three new rooms", () => {
    for (const w of WARRENS_PIECES) {
      const both = w.setups.reduce((sum, waves) => sum + pieceHp({ waves }), 0);
      expect(hpOf(w.piece.key), w.piece.key).toBe(both);
    }
    expect(hpOf("gatehouse")).toBe(1860);
    expect(hpOf("barracks")).toBe(3780);
    expect(hpOf("armory")).toBe(3910);
  });

  it("no two goblins start on top of each other, and all start inside", () => {
    for (const { piece } of STRONGHOLD_PIECES) {
      // A hole wave starts at its holes and comes out a few at a time.
      for (const wave of piece.waves.filter((_, w) => w !== piece.holeWave)) {
        wave.forEach((a, i) => {
          const half = ENEMY_STATS[a.kind].size / 2;
          expect(a.at.x - half, piece.key).toBeGreaterThanOrEqual(0);
          expect(a.at.y - half, piece.key).toBeGreaterThanOrEqual(0);
          expect(a.at.x + half, piece.key).toBeLessThanOrEqual(piece.width);
          expect(a.at.y + half, piece.key).toBeLessThanOrEqual(piece.height);
          for (const other of wave.slice(i + 1)) {
            const gap = (ENEMY_STATS[other.kind].size + 2 * half) / 2;
            const apart =
              Math.abs(a.at.x - other.at.x) >= gap ||
              Math.abs(a.at.y - other.at.y) >= gap;
            expect(apart, `${piece.key} ${a.at.x},${a.at.y}`).toBe(true);
          }
        });
      }
    }
  });

  it("every possible main path lands inside 30,000–36,000 solo HP", () => {
    const band = (b: string) =>
      STRONGHOLD_PIECES.filter((p) => p.band === b).map((p) =>
        pieceHp(p.piece),
      );
    const pairs = (xs: number[], k: number): number[][] =>
      k === 0
        ? [[]]
        : xs.flatMap((x, i) =>
            pairs(xs.slice(i + 1), k - 1).map((rest) => [x, ...rest]),
          );
    const boss = pieceHp(WARRENS_THRONE);
    let paths = 0;
    for (const light of band("light"))
      for (const mediums of pairs(band("medium"), 3))
        for (const heavies of pairs(band("heavy"), 2)) {
          const total =
            light +
            mediums.reduce((a, b) => a + b, 0) +
            heavies.reduce((a, b) => a + b, 0) +
            boss;
          expect(total).toBeGreaterThanOrEqual(30_000);
          expect(total).toBeLessThanOrEqual(36_000);
          paths++;
        }
    expect(paths).toBe(5 * 20 * 3);
  });

  it("1,000 seeds follow the rules: gate, light, 3 medium, 2 heavy, war hall", () => {
    for (const seed of SEEDS) {
      expect(
        recipeProblems(STRONGHOLD_RECIPE, buildStronghold(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    const first = mainPath(buildStronghold(1));
    expect(first[0]?.name).toBe("Stronghold gate");
    expect(first.at(-1)?.name).toBe("War hall");
  });

  it("a seed always rebuilds the same map; seed 0 is seed 1's", () => {
    expect(buildStronghold(77)).toEqual(buildStronghold(77));
    expect(buildStronghold(1)).not.toEqual(buildStronghold(2));
    expect(layoutFor("goblin-stronghold", 0)).toEqual(buildStronghold(1));
  });

  it("has no gaps in its walls", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      expect(findLeak(buildStronghold(seed)), `seed ${seed}`).toBeNull();
    }
  });
});
