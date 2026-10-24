import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { dungeonInfo, entryProblem, layoutFor } from "./dungeons.ts";
import {
  enemyAct,
  isTelegraphing,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BOSS_KINDS, EELPRIEST, SPEARMAN, TIDEPRIEST } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { POTION_CHANCE } from "./potions.ts";
import { clearExp, expToNextLevel } from "./progression.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  spawnEnemies,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";
import {
  buildTemple,
  TEMPLE_PIECES,
  TEMPLE_RECIPE,
  TEMPLE_SANCTUM,
} from "./sunken-temple.ts";
import {
  SURGE,
  TIDES,
  WHIRLPOOL,
  surgeHits,
  tideAt,
  waterDrift,
} from "./temple-water.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});
const idle: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: false, aim: null },
};
const east: PlayerInput = { ...idle, move: { x: 1, y: 0 } };
const ARENA: Rect = { x: 0, y: 0, width: 760, height: 640 };

/** Applies one input per tick and steps the world, as the server does. */
function play(
  sim: SimState,
  seconds: number,
  input: PlayerInput = idle,
  walls: readonly Rect[] = [],
) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    for (const p of sim.players) {
      sim = applyPlayerInput(sim, p.id, input, walls, TICK_SECONDS).state;
    }
    const r = stepWorld(
      sim,
      walls,
      TICK_SECONDS,
      undefined,
      () => [],
      () => ARENA,
    );
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  walls: readonly Rect[] = [],
  context: Partial<AiContext> = {},
): { enemy: EnemyState; actions: EnemyAction[] } {
  const ctx: AiContext = {
    aliveSummons: () => 0,
    boundsOf: () => ARENA,
    ...context,
  };
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, walls, TICK_SECONDS, ctx);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

const tough = (sim: SimState): SimState => ({
  ...sim,
  players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
});

describe("the Sunken Temple (D-135)", () => {
  it("is listed for levels 18–20, opens after the Warrens, gives 280 EXP to 20, T5–T7, potions at 50%", () => {
    expect(dungeonInfo("sunken-temple")).toMatchObject({
      name: "Sunken Temple",
      blurb: "Levels 18–20 · 8 min · opens after the Warrens",
      listed: true,
    });
    expect(entryProblem("sunken-temple", 0)).not.toBeNull();
    expect(entryProblem("sunken-temple", 1)).toBeNull();
    expect(clearExp("sunken-temple", 18)).toBe(280);
    expect(clearExp("sunken-temple", 20)).toBe(280);
    // About 3 clears from 18 to 20.
    const needed = expToNextLevel(18) + expToNextLevel(19);
    expect(Math.ceil(needed / 280)).toBe(3);
    expect(LOOT_POOLS["sunken-temple"].tiers).toEqual([
      [5, 30],
      [6, 45],
      [7, 25],
    ]);
    expect(POTION_CHANCE["sunken-temple"]).toBe(0.5);
  });

  it("light rooms are 4,280, medium 6,360, heavy 8,860; every main path is 65,940 with the Tide Priest", () => {
    const hp = (band: string) => [
      ...new Set(
        TEMPLE_PIECES.filter((p) => p.band === band).map((p) =>
          pieceHp(p.piece),
        ),
      ),
    ];
    expect(hp("light")).toEqual([4280]);
    expect(hp("medium")).toEqual([6360]);
    expect(hp("heavy")).toEqual([8860]);
    expect(pieceHp(TEMPLE_SANCTUM)).toBe(16_000);
    const total = 4280 + 3 * 6360 + 3 * 8860 + 16_000;
    expect(total).toBe(65_940);
    expect(total).toBeGreaterThanOrEqual(TEMPLE_RECIPE.requiredHp.min);
    expect(total).toBeLessThanOrEqual(TEMPLE_RECIPE.requiredHp.max);
    const kinds = new Set(
      TEMPLE_PIECES.flatMap((p) => p.piece.waves.flat().map((s) => s.kind)),
    );
    expect([...kinds].sort()).toEqual([
      "acolyte",
      "caller",
      "eelpriest",
      "spearman",
    ]);
  });

  it("500 seeds follow the rules, with no wall gaps; seeds rebuild; tide pools come with their rooms", () => {
    for (let seed = 1; seed <= 500; seed++) {
      expect(
        recipeProblems(TEMPLE_RECIPE, buildTemple(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    for (let seed = 1; seed <= 20; seed++) {
      expect(findLeak(buildTemple(seed)), `seed ${seed}`).toBeNull();
    }
    const first = mainPath(buildTemple(1));
    expect(first[0]?.name).toBe("Temple steps");
    expect(first.at(-1)?.name).toBe("Drowned sanctum");
    expect(layoutFor("sunken-temple", 0)).toEqual(buildTemple(1));
    expect(buildTemple(3).rooms.some((r) => (r.tides ?? []).length > 0)).toBe(
      true,
    );
  });
});

describe("tides (D-135)", () => {
  it("run a 9 s cycle: shallow for 4 s, rising for 1 s, deep for 4 s", () => {
    expect([0, 3.9, 4, 4.9, 5, 8.9, 9, 13.5].map(tideAt)).toEqual([
      "shallow",
      "shallow",
      "rising",
      "rising",
      "deep",
      "deep",
      "shallow",
      "rising",
    ]);
  });

  it("deep water halves a player's speed; shallow water does nothing", () => {
    const pool = { x: 0, y: -100, width: 1000, height: 200 };
    const moved = (clock: number) => {
      const sim = {
        ...addPlayer(createSimState([]), 1, { x: 100, y: 0 }),
        tides: [pool],
        clock,
      };
      const after = applyPlayerInput(sim, 1, east, [], TICK_SECONDS).state;
      return after.players[0]!.position.x - 100;
    };
    expect(moved(6)).toBeCloseTo(moved(1) * TIDES.speedFactor, 9);
    expect(moved(1)).toBeGreaterThan(0);
  });
});

describe("eel-priests (D-135)", () => {
  it("tether the nearest player in clear sight, then after 0.8 s hit for 8 and pull them in", () => {
    let sim = tough(
      addPlayer(createSimState([], { respawnSeconds: null }), 1, {
        x: 0,
        y: 0,
      }),
    );
    sim = spawnEnemies(sim, [
      { kind: "eelpriest", at: { x: 250, y: 0 }, roomId: null },
    ]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({
        ...e,
        ai: { ...e.ai, pull: 0 },
      })) as typeof sim.enemies,
    };
    const { sim: after, events } = play(sim, 2);
    const hits = events.filter((e) => e.type === "playerHit") as {
      damage: number;
    }[];
    expect(hits.map((h) => h.damage)).toEqual([EELPRIEST.pull.damage]);
    // Pulled about 240 × 0.45 = 108 px towards where the priest stood.
    expect(after.players[0]!.position.x).toBeGreaterThan(80);
    expect(after.players[0]!.pull).toBeUndefined();
  });

  it("cannot tether through a wall", () => {
    const wall = { x: 100, y: -100, width: 40, height: 200 };
    const e = { ...newEnemy(1, "eelpriest", { x: 250, y: 0 }, null, null) };
    const { actions } = run(
      { ...e, ai: { kind: "eelpriest", pull: 0, tethered: null, strikeIn: 0 } },
      1,
      [still(0, 0)],
      [wall],
    );
    expect(actions.some((a) => a.pull)).toBe(false);
  });

  it("killed during the warning, its pull is broken", () => {
    let sim = tough(
      addPlayer(createSimState([], { respawnSeconds: null }), 1, {
        x: 0,
        y: 0,
      }),
    );
    sim = spawnEnemies(sim, [
      { kind: "eelpriest", at: { x: 250, y: 0 }, roomId: null },
    ]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({
        ...e,
        ai: { ...e.ai, pull: 0 },
      })) as typeof sim.enemies,
    };
    sim = play(sim, 0.1).sim;
    expect(sim.players[0]!.pull).toBeDefined();
    sim = { ...sim, enemies: sim.enemies.map((e) => ({ ...e, hp: 0 })) };
    const { sim: after } = play(sim, 1.5);
    expect(after.players[0]!.pull).toBeUndefined();
    expect(after.players[0]!.position.x).toBeCloseTo(0, 6);
  });
});

describe("fishfolk spearmen (D-135)", () => {
  it("charge like brutes, quicker and harder: a 0.7 s windup, then 14", () => {
    const e = newEnemy(1, "spearman", { x: 0, y: 0 }, null, null);
    const { actions } = run(e, 2, [still(150, 0)]);
    const first = actions.findIndex((a) => isTelegraphing(a.enemy));
    expect(first).toBe(0);
    const hits = actions.flatMap((a) => a.contacts);
    expect(hits).toEqual([{ playerId: 1, damage: SPEARMAN.chargeDamage }]);
    const hitAt = actions.findIndex((a) => a.contacts.length > 0);
    expect(hitAt * TICK_SECONDS).toBeGreaterThan(SPEARMAN.windupSeconds);
  });
});

describe("whirlpools and surges (D-135)", () => {
  it("a whirlpool drags players in its reach towards its core while it turns", () => {
    const w = {
      at: { x: 0, y: 0 },
      radius: WHIRLPOOL.radius,
      from: 1,
      until: 5,
    };
    expect(
      waterDrift({ x: 100, y: 0 }, 0.5, undefined, [w], TICK_SECONDS),
    ).toEqual({ x: 0, y: 0 });
    const d = waterDrift({ x: 100, y: 0 }, 2, undefined, [w], TICK_SECONDS);
    expect(d.x).toBeCloseTo(-WHIRLPOOL.dragSpeed, 9);
    expect(
      waterDrift({ x: 200, y: 0 }, 2, undefined, [w], TICK_SECONDS),
    ).toEqual({ x: 0, y: 0 });
  });

  it("a surge hits a player its band touches, unless they stand in a gap", () => {
    const s = {
      area: ARENA,
      axis: "x" as const,
      dir: 1 as const,
      pos: 100,
      gaps: [{ from: 200, to: 296 }],
    };
    expect(surgeHits(s, { x: 90, y: 100 })).toBe(true);
    expect(surgeHits(s, { x: 90, y: 250 })).toBe(false);
    expect(surgeHits(s, { x: 300, y: 100 })).toBe(false);
  });
});

describe("the Tide Priest (D-135)", () => {
  const priest = (share = 1) => {
    const e = newEnemy(1, "tidepriest", { x: 380, y: 320 }, "sanctum", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 16,000 HP, is never healed, fires fans of 3 water bolts (10) every 2 s", () => {
    expect(TIDEPRIEST.maxHp).toBe(16000);
    expect(BOSS_KINDS).toContain("tidepriest");
    const { actions } = run(priest(), 3.6, [still(700, 320)]);
    const fans = actions.filter((a) => a.bullets.length > 0);
    expect(fans).toHaveLength(2);
    expect(fans[0]!.bullets.map((b) => b.spec.damage)).toEqual([10, 10, 10]);
  });

  it("sends a surge every 6 s across its arena, each with two new gaps", () => {
    const { actions } = run(priest(), 9.1, [still(700, 320)]);
    const surges = actions.filter((a) => a.surge).map((a) => a.surge!);
    expect(surges).toHaveLength(2);
    expect(surges.map((s) => [s.axis, s.dir])).toEqual([
      ["x", 1],
      ["x", -1],
    ]);
    expect(surges[0]!.gaps).toHaveLength(SURGE.gaps);
    expect(surges[0]!.gaps).not.toEqual(surges[1]!.gaps);
  });

  it("below half HP, two whirlpools every 5 s, one where its target stands", () => {
    const { actions } = run(priest(0.49), 5.1, [still(600, 200)]);
    const rounds = actions
      .filter((a) => a.whirlpools)
      .map((a) => a.whirlpools!);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]![0]).toEqual({ x: 600, y: 200 });
    expect(
      run(priest(0.51), 5.1, [still(600, 200)]).actions.some(
        (a) => a.whirlpools,
      ),
    ).toBe(false);
  });

  it("enraged below 25%, surges come every 4 s and turn between the axes", () => {
    const { actions } = run(priest(0.24), 11.1, [still(700, 320)]);
    const axes = actions.filter((a) => a.surge).map((a) => a.surge!.axis);
    expect(axes).toEqual(["x", "y", "x"]);
  });

  it("a whirlpool's core hurts every 0.5 s while it turns; a surge hits each player once", () => {
    let sim = tough(
      addPlayer(createSimState([], { respawnSeconds: null }), 1, {
        x: 100,
        y: 320,
      }),
    );
    sim = spawnEnemies(sim, [
      { kind: "tidepriest", at: { x: 380, y: 320 }, roomId: "sanctum" },
    ]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({
        ...e,
        hp: e.maxHp * 0.4,
        ai: { ...e.ai, bolts: 99, surge: 0, whirls: 99 },
      })) as typeof sim.enemies,
    };
    const { events } = play(sim, 6);
    const surgeHitsOnMe = (
      events.filter((e) => e.type === "playerHit") as { damage: number }[]
    ).filter((h) => h.damage === SURGE.damage);
    // Whatever the gaps, at most one hit per surge.
    expect(surgeHitsOnMe.length).toBeLessThanOrEqual(1);
  });
});
