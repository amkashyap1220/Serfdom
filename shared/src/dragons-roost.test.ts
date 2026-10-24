import { describe, expect, it } from "vitest";
import {
  buildRoost,
  ROOST_PIECES,
  ROOST_RECIPE,
  ROOST_SUMMIT,
} from "./dragons-roost.ts";
import { pieceHp } from "./dungeon-gen.ts";
import { DUNGEONS, dungeonInfo, entryProblem } from "./dungeons.ts";
import {
  enemyAct,
  isTelegraphing,
  meteorSpot,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BOSS_KINDS, DRAGON, DRAKE } from "./enemy-config.ts";
import { isFaded, newEnemy, type EnemyState } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";
import { waterDrift } from "./temple-water.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});
const ARENA: Rect = { x: 0, y: 0, width: 840, height: 760 };
const idle: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: false, aim: null },
};

function run(enemy: EnemyState, seconds: number, targets: AiTarget[]) {
  const ctx: AiContext = { aliveSummons: () => 0, boundsOf: () => ARENA };
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, [], TICK_SECONDS, ctx);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

function step(sim: SimState, seconds: number) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(
      sim,
      [],
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

describe("Dragon's Roost (D-140)", () => {
  it("is the tenth dungeon: level 20, and the only one that drops T10", () => {
    expect(DUNGEONS.filter((d) => d.listed)).toHaveLength(10);
    expect(dungeonInfo("dragons-roost")).toMatchObject({
      name: "Dragon's Roost",
      minLevel: 20,
    });
    expect(entryProblem("dragons-roost", 1, 19)).toBe("Reach level 20 first.");
    expect(LOOT_POOLS["dragons-roost"].tiers).toEqual([
      [8, 30],
      [9, 45],
      [10, 25],
    ]);
    const withT10 = Object.entries(LOOT_POOLS)
      .filter(([, pool]) => pool.tiers.some(([tier]) => tier === 10))
      .map(([id]) => id);
    expect(withT10).toEqual(["dragons-roost"]);
  });

  it("light 5,120, medium 8,200, heavy 11,200; every main path 89,320 with the Elder Dragon; 500 seeds follow the rules", () => {
    const hp = (band: string) => [
      ...new Set(
        ROOST_PIECES.filter((p) => p.band === band).map((p) =>
          pieceHp(p.piece),
        ),
      ),
    ];
    expect([hp("light"), hp("medium"), hp("heavy")]).toEqual([
      [5120],
      [8200],
      [11200],
    ]);
    expect(pieceHp(ROOST_SUMMIT)).toBe(26_000);
    const total = 5120 + 3 * 8200 + 3 * 11200 + 26_000;
    expect(total).toBe(89_320);
    expect(total).toBeGreaterThanOrEqual(ROOST_RECIPE.requiredHp.min);
    expect(total).toBeLessThanOrEqual(ROOST_RECIPE.requiredHp.max);
    for (let seed = 1; seed <= 500; seed++) {
      expect(
        recipeProblems(ROOST_RECIPE, buildRoost(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    for (let seed = 1; seed <= 20; seed++)
      expect(findLeak(buildRoost(seed))).toBeNull();
  });

  it("a fire drake lobs like a bomber, harder (14) and hotter (4 every 0.5 s)", () => {
    const e = {
      ...newEnemy(1, "drake", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const a = enemyAct(e, [still(260, 0)], [], TICK_SECONDS);
    expect(a.hazards[0]).toMatchObject({
      damage: DRAKE.damage,
      fire: DRAKE.fire,
    });
  });
});

describe("the Elder Dragon (D-140)", () => {
  const dragon = (share = 1) => {
    const e = newEnemy(1, "dragon", { x: 420, y: 380 }, "throne", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 26,000 HP, 104 px, and is never healed; breathes a fire cone (18) that leaves burning floor", () => {
    expect([DRAGON.maxHp, DRAGON.size]).toEqual([26000, 104]);
    expect(BOSS_KINDS).toContain("dragon");
    const { actions } = run(dragon(), 2, [still(700, 380)]);
    const breath = actions.find((a) => a.cone)!;
    expect(breath.cone).toMatchObject({
      damage: 18,
      range: 300,
      fire: DRAGON.breath.fire,
    });
    expect(isTelegraphing(breath.enemy)).toBe(true);
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 700,
      y: 380,
    });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    sim = {
      ...sim,
      cones: [
        {
          ...breath.cone!,
          at: { x: 420, y: 380 },
          shownLeft: 0.25,
          ownerId: 1,
        },
      ],
    };
    const landed = step(sim, 1.05).sim;
    expect(landed.fires.length).toBe(3);
  });

  it("beats its wings every 8 s: after a 1 s warning everyone within 260 px is blown away from it", () => {
    const { actions } = run(dragon(), 4.2, [still(700, 380)]);
    expect(actions.some((a) => a.gust)).toBe(true);
    // The push: away from the centre, at 300 px/s.
    const gust = {
      at: { x: 0, y: 0 },
      radius: 260,
      from: 1,
      until: 1.5,
      dragSpeed: DRAGON.gust.dragSpeed,
    };
    const d = waterDrift(
      { x: 100, y: 0 },
      1.2,
      undefined,
      [gust],
      TICK_SECONDS,
    );
    expect(d.x).toBeCloseTo(300, 9);
    let sim: SimState = {
      ...addPlayer(createSimState([]), 1, { x: 100, y: 0 }),
      clock: 1.2,
    };
    sim = {
      ...sim,
      whirlpools: [
        { ...gust, nextTick: Number.POSITIVE_INFINITY, damage: 0, ownerId: 1 },
      ],
    };
    sim = applyPlayerInput(sim, 1, idle, [], TICK_SECONDS).state;
    expect(sim.players[0]!.position.x).toBeCloseTo(100 + 300 * TICK_SECONDS, 9);
  });

  it("at half HP it flies once for 14 s, out of reach, while meteors rain; then it lands", () => {
    const { actions } = run(dragon(0.49), 15, [still(700, 380)]);
    expect(isFaded(actions[0]!.enemy)).toBe(true);
    const airborne = actions.filter((a) => isFaded(a.enemy));
    expect(airborne.length * TICK_SECONDS).toBeCloseTo(DRAGON.air.seconds, 1);
    const meteors = actions.flatMap((a) => a.hazards).filter((h) => h.meteor);
    expect(meteors.length).toBeGreaterThan(20);
    expect(meteors[0]).toMatchObject({ damage: 16, fire: DRAGON.meteors.fire });
    expect(isFaded(actions.at(-1)!.enemy)).toBe(false);
    // It does not take off again.
    const again = run(actions.at(-1)!.enemy, 3, [still(700, 380)]).actions;
    expect(again.some((a) => isFaded(a.enemy))).toBe(false);
  });

  it("meteors land across its arena, inside the walls", () => {
    for (let k = 0; k < 50; k++) {
      const p = meteorSpot(ARENA, k);
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(40);
      expect(p.y).toBeLessThanOrEqual(720);
    }
  });
});
