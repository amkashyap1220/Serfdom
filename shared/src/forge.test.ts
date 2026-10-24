import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { LAVA } from "./dungeon-layout.ts";
import { dungeonInfo, entryProblem, layoutFor } from "./dungeons.ts";
import { enemyAct, type AiTarget } from "./enemy-ai.ts";
import { CASTER, IMP, SKULKER } from "./enemy-config.ts";
import { newEnemy } from "./enemy.ts";
import { buildForge, FORGE_PIECES, FORGE_RECIPE } from "./ember-forge.ts";
import { LOOT_POOLS, rollItem } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { POTION_CHANCE } from "./potions.ts";
import { clearExp } from "./progression.ts";
import { seededRandom } from "./seeded-random.ts";
import {
  addPlayer,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);
const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number): AiTarget => ({
  id: 1,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});

describe("the Ember Forge (D-130)", () => {
  it("is listed for levels 15–18 and opens once the Warrens is completed (D-107)", () => {
    expect(dungeonInfo("ember-forge")).toMatchObject({
      name: "Ember Forge",
      blurb: "Levels 15–18 · 7–8 min · opens after the Warrens",
      listed: true,
    });
    expect(entryProblem("ember-forge", 0)).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(entryProblem("ember-forge", 1)).toBeNull();
  });

  it("gives 240 EXP up to level 18, drops T4–T6, and potions at 40%", () => {
    expect(clearExp("ember-forge", 15)).toBe(240);
    expect(clearExp("ember-forge", 18)).toBe(240);
    expect(clearExp("ember-forge", 19)).toBe(216);
    expect(LOOT_POOLS["ember-forge"].tiers).toEqual([
      [4, 30],
      [5, 45],
      [6, 25],
    ]);
    const random = seededRandom(3);
    const tiers = new Set(
      Array.from({ length: 300 }, () => rollItem("ember-forge", random).tier),
    );
    expect([...tiers].sort()).toEqual([4, 5, 6]);
    expect(POTION_CHANCE["ember-forge"]).toBe(0.4);
  });

  it("11 rooms: 13b's newcomers (D-132), and 20% fewer imps and casters in 13c's trap rooms (D-133)", () => {
    const count = (key: string) => {
      const n: Record<string, number> = {};
      const piece = FORGE_PIECES.find((p) => p.piece.key === key)!.piece;
      for (const s of piece.waves.flat()) n[s.kind] = (n[s.kind] ?? 0) + 1;
      return { hp: pieceHp(piece), ...n };
    };
    // A fire elemental takes an imp, a magma golem four, a bellows-keeper a caster.
    expect(count("ashroom")).toEqual({
      hp: 3320,
      elemental: 2,
      imp: 6,
      caster: 4,
    });
    expect(count("bellows")).toEqual({
      hp: 3090,
      imp: 6,
      bellows: 1,
      caster: 3,
    });
    expect(count("orestore")).toEqual({ hp: 2920, imp: 6, caster: 4 });
    expect(count("smelter")).toEqual({
      hp: 5360,
      elemental: 2,
      imp: 10,
      caster: 7,
    });
    expect(count("anvils")).toEqual({ hp: 5060, golem: 1, imp: 5, caster: 7 });
    expect(count("quench")).toEqual({
      hp: 5730,
      imp: 12,
      bellows: 1,
      caster: 6,
    });
    expect(count("chains")).toEqual({
      hp: 4360,
      elemental: 3,
      imp: 6,
      caster: 7,
    });
    expect(count("slagpit")).toEqual({ hp: 6820, golem: 1, imp: 9, caster: 9 });
    expect(count("crucible")).toEqual({
      hp: 7820,
      golem: 1,
      elemental: 2,
      imp: 11,
      caster: 9,
    });
    expect(count("furnace")).toEqual({
      hp: 7690,
      golem: 2,
      imp: 6,
      bellows: 1,
      caster: 8,
    });
    expect(count("foundry")).toEqual({
      hp: 8190,
      golem: 1,
      imp: 13,
      bellows: 1,
      caster: 8,
    });
  });

  it("main paths come to 51,030–54,170 with the stand-in Lich, inside the band (D-133)", () => {
    const hp = (band: string) =>
      FORGE_PIECES.filter((p) => p.band === band)
        .map((p) => pieceHp(p.piece))
        .sort((a, b) => a - b);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const [light, medium, heavy] = [hp("light"), hp("medium"), hp("heavy")];
    const boss = pieceHp(FORGE_RECIPE.boss);
    // One light room, three different medium, three different heavy.
    const least =
      light[0]! + sum(medium.slice(0, 3)) + sum(heavy.slice(0, 3)) + boss;
    const most =
      light.at(-1)! + sum(medium.slice(-3)) + sum(heavy.slice(-3)) + boss;
    expect([least, most]).toEqual([51_030, 54_170]);
    expect(least).toBeGreaterThanOrEqual(FORGE_RECIPE.requiredHp.min);
    expect(most).toBeLessThanOrEqual(FORGE_RECIPE.requiredHp.max);
    // With the Forgemaster (14,000) instead, inside D-130's 52,000–62,000.
    expect(least + 3_000).toBeGreaterThanOrEqual(52_000);
    expect(most + 3_000).toBeLessThanOrEqual(62_000);
  });

  it("1,000 seeds follow the rules (no spawn in lava or obstacles); no wall gaps; seeds rebuild", () => {
    for (const seed of SEEDS) {
      expect(
        recipeProblems(FORGE_RECIPE, buildForge(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    for (const seed of SEEDS.slice(0, 40)) {
      expect(findLeak(buildForge(seed)), `seed ${seed}`).toBeNull();
    }
    const first = mainPath(buildForge(1));
    expect(first[0]?.name).toBe("Forge gate");
    expect(first.at(-1)?.name).toBe("Forge heart");
    expect(layoutFor("ember-forge", 0)).toEqual(buildForge(1));
  });
});

describe("forge imps and ember casters (D-130)", () => {
  it("an imp flanks like a skulker, faster and harder: touch 10 per 1.2 s", () => {
    let e = {
      ...newEnemy(1, "imp", { x: 30, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const hits: number[] = [];
    for (let t = 0; t < ticks(2); t++) {
      const a = enemyAct(e, [still(0, 0)], [], TICK_SECONDS);
      e = a.enemy;
      hits.push(...a.contacts.map((c) => c.damage));
    }
    expect(hits).toEqual([IMP.contactDamage, IMP.contactDamage]);
    expect(IMP.speed).toBeGreaterThan(SKULKER.speed);
    // Running ahead of a moving player, like a skulker.
    const run = (kind: "imp" | "grunt") => {
      let x = newEnemy(1, kind, { x: 0, y: -200 }, null, null);
      for (let t = 0; t < ticks(1); t++) {
        x = enemyAct(
          x,
          [
            {
              id: 1,
              position: { x: 150 * t * TICK_SECONDS, y: 0 },
              velocity: { x: 150, y: 0 },
            },
          ],
          [],
          TICK_SECONDS,
        ).enemy;
      }
      return x.position.x;
    };
    // It gets well ahead of where a grunt trails the runner.
    expect(run("imp")).toBeGreaterThan(run("grunt") + 20);
  });

  it("an ember caster lobs a fireball (10) that leaves burning floor (3 every 0.5 s)", () => {
    const e = {
      ...newEnemy(1, "caster", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const a = enemyAct(e, [still(240, 0)], [], TICK_SECONDS);
    expect(a.hazards).toEqual([
      {
        at: { x: 240, y: 0 },
        radius: CASTER.radius,
        damage: 10,
        delaySeconds: CASTER.flightSeconds,
        fire: { seconds: 3, tickSeconds: 0.5, damage: 3 },
      },
    ]);
  });
});

describe("lava channels (D-130)", () => {
  const lava = [{ x: 100, y: -50, width: 100, height: 100 }];
  const world = (at: { x: number; y: number }): SimState => ({
    ...addPlayer(createSimState([], { respawnSeconds: null }), 1, at),
    lava,
  });

  it("burn a player touching them for 4 every 0.5 s, as the room's hit", () => {
    let sim = world({ x: 90, y: 0 }); // the hurtbox reaches the lava's edge
    const events: SimEvent[] = [];
    for (let t = 0; t < ticks(1.01); t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      events.push(...r.events);
    }
    const hits = events.filter((e) => e.type === "hazardHit");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ hazard: "lava", damage: LAVA.damage });
    // Clear of it: nothing.
    let away = world({ x: 0, y: 0 });
    const none: SimEvent[] = [];
    for (let t = 0; t < ticks(1.01); t++) {
      const r = stepWorld(away, [], TICK_SECONDS);
      away = r.state;
      none.push(...r.events);
    }
    expect(none.some((e) => e.type === "hazardHit")).toBe(false);
  });

  it("stop enemies like walls: an imp chasing across one never enters it", () => {
    let sim = world({ x: 300, y: 0 });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    sim = spawnEnemies(sim, [
      { kind: "imp", at: { x: 0, y: 0 }, roomId: null },
    ]);
    for (let t = 0; t < ticks(4); t++) {
      sim = stepWorld(sim, [], TICK_SECONDS).state;
      const e = sim.enemies[0]!;
      const half = e.size / 2;
      const inside =
        e.position.x + half > 100 &&
        e.position.x - half < 200 &&
        e.position.y + half > -50 &&
        e.position.y - half < 50;
      expect(inside).toBe(false);
    }
  });
});
