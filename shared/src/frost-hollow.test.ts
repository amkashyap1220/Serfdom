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
import { BOSS_KINDS, WRAITH, WYRM } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import {
  buildHollow,
  HOLLOW_LAIR,
  HOLLOW_PIECES,
  HOLLOW_RECIPE,
} from "./frost-hollow.ts";
import { FROST, ICICLES, coneHits, onFrost } from "./frost.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { POTION_CHANCE } from "./potions.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  dropBoulders,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});
const east: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  context: Partial<AiContext> = {},
): { enemy: EnemyState; actions: EnemyAction[] } {
  const ctx: AiContext = { aliveSummons: () => 0, ...context };
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
    const r = stepWorld(sim, [], TICK_SECONDS);
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

describe("Frost Hollow (D-136)", () => {
  it("is an endgame dungeon: listed, open only to level-20 serfs who have completed the Warrens", () => {
    expect(dungeonInfo("frost-hollow")).toMatchObject({
      name: "Frost Hollow",
      blurb: "Level 20 · 8 min · endgame",
      listed: true,
      minLevel: 20,
    });
    expect(entryProblem("frost-hollow", 0, 20)).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(entryProblem("frost-hollow", 5, 19)).toBe("Reach level 20 first.");
    expect(entryProblem("frost-hollow", 5, 20)).toBeNull();
    // The ladder's dungeons keep their old rule, at any level.
    expect(entryProblem("sunken-temple", 1, 1)).toBeNull();
  });

  it("drops T6–T8 and potions at 60%", () => {
    expect(LOOT_POOLS["frost-hollow"].tiers).toEqual([
      [6, 30],
      [7, 45],
      [8, 25],
    ]);
    expect(POTION_CHANCE["frost-hollow"]).toBe(0.6);
  });

  it("light 4,700, medium 7,260, heavy 9,860; every main path 76,060 with the Frost Wyrm", () => {
    const hp = (band: string) => [
      ...new Set(
        HOLLOW_PIECES.filter((p) => p.band === band).map((p) =>
          pieceHp(p.piece),
        ),
      ),
    ];
    expect([hp("light"), hp("medium"), hp("heavy")]).toEqual([
      [4700],
      [7260],
      [9860],
    ]);
    expect(pieceHp(HOLLOW_LAIR)).toBe(20_000);
    const total = 4700 + 3 * 7260 + 3 * 9860 + 20_000;
    expect(total).toBe(76_060);
    expect(total).toBeGreaterThanOrEqual(HOLLOW_RECIPE.requiredHp.min);
    expect(total).toBeLessThanOrEqual(HOLLOW_RECIPE.requiredHp.max);
  });

  it("500 seeds follow the rules; no wall gaps; seeds rebuild; icicle rooms carry their icicles", () => {
    for (let seed = 1; seed <= 500; seed++) {
      expect(
        recipeProblems(HOLLOW_RECIPE, buildHollow(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    for (let seed = 1; seed <= 20; seed++)
      expect(findLeak(buildHollow(seed))).toBeNull();
    expect(mainPath(buildHollow(1)).at(-1)?.name).toBe("Wyrm's lair");
    expect(layoutFor("frost-hollow", 0)).toEqual(buildHollow(1));
    const icy = buildHollow(4).rooms.filter((r) => r.rockfall);
    expect(icy.length).toBeGreaterThan(0);
    expect(icy.every((r) => r.rockfall?.icicle === true)).toBe(true);
  });
});

describe("frost (D-136)", () => {
  it("slows a player standing on it to 60%, only while it lasts", () => {
    const patch = { at: { x: 100, y: 0 }, radius: 48, from: 1, until: 4 };
    const moved = (clock: number) => {
      const sim = {
        ...addPlayer(createSimState([]), 1, { x: 100, y: 0 }),
        frost: [patch],
        clock,
      };
      return (
        applyPlayerInput(sim, 1, east, [], TICK_SECONDS).state.players[0]!
          .position.x - 100
      );
    };
    expect(moved(2)).toBeCloseTo(moved(0.5) * FROST.speedFactor, 9);
    expect(moved(5)).toBeCloseTo(moved(0.5), 9);
    expect(onFrost({ x: 160, y: 0 }, 2, [patch])).toBe(false);
  });

  it("an icicle lands like a boulder and leaves frost for 3 s", () => {
    let sim = addPlayer(createSimState([]), 1, { x: 500, y: 500 });
    sim = dropBoulders(sim, [
      { at: { x: 200, y: 200 }, damage: 12, icicle: true },
    ]);
    expect(sim.hazards[0]).toMatchObject({ hazard: "icicles" });
    const landed = step(sim, 1.3).sim;
    expect(landed.frost).toHaveLength(1);
    expect(landed.frost![0]!.radius).toBe(ICICLES.frostRadius);
    expect(step(landed, ICICLES.frostSeconds).sim.frost).toEqual([]);
  });

  it("an ice wraith leaves a patch of frost every 3 s", () => {
    const { actions } = run(
      newEnemy(1, "wraith", { x: 0, y: 0 }, null, null),
      7.6,
      [still(500, 0)],
    );
    const trails = actions.flatMap((a) => a.frost ?? []);
    expect(trails).toHaveLength(3);
    expect(trails[0]!.radius).toBe(WRAITH.trail.radius);
  });
});

describe("the Frost Wyrm (D-136)", () => {
  const wyrm = (share = 1) => {
    const e = newEnemy(1, "wyrm", { x: 400, y: 360 }, "lair", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 20,000 HP, 96 px, is never healed; breathes a 70° cone, 280 px, after a 1 s warning, for 16", () => {
    expect([WYRM.maxHp, WYRM.size]).toEqual([20000, 96]);
    expect(BOSS_KINDS).toContain("wyrm");
    const { actions } = run(wyrm(), 2.2, [still(650, 360)]);
    const breath = actions.find((a) => a.cone)!;
    expect(breath.cone).toMatchObject({ range: 280, startsIn: 1, damage: 16 });
    expect(breath.cone!.halfAngle).toBeCloseTo((35 * Math.PI) / 180, 9);
    expect(isTelegraphing(breath.enemy)).toBe(true);
    const c = { ...breath.cone!, at: breath.cone!.at };
    expect(coneHits(c, { x: 650, y: 360 })).toBe(true);
    expect(coneHits(c, { x: 400, y: 600 })).toBe(false);
  });

  it("a player close to it gets the tail: a 0.6 s windup, 14 in 120 px, and frost", () => {
    const { actions } = run(wyrm(), 1, [still(470, 360)]);
    const hit = actions.find((a) => a.slam && !a.slam.warning)!;
    expect(hit.contacts).toEqual([{ playerId: 1, damage: 14 }]);
    expect(hit.frost?.[0]?.radius).toBe(WYRM.tail.radius);
  });

  it("below half HP calls 2 ice wraiths every 12 s, at most 3 alive; enraged, breathes every 2.5 s", () => {
    const calls = (alive: number) =>
      run(wyrm(0.49), 12.5, [still(800, 360)], {
        aliveSummons: () => alive,
      }).actions.flatMap((a) => a.summons);
    expect(calls(0)).toHaveLength(4);
    expect(calls(2)).toHaveLength(2);
    expect(calls(0).every((s) => s.kind === "wraith")).toBe(true);
    const breaths = run(wyrm(0.24), 8.2, [still(650, 360)]).actions.filter(
      (a) => a.cone,
    );
    expect(breaths).toHaveLength(3);
  });

  it("its breath lands: hits the player in the cone once, and frosts the floor", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 650,
      y: 360,
    });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    sim = {
      ...sim,
      cones: [
        {
          at: { x: 400, y: 360 },
          angle: 0,
          range: 280,
          halfAngle: 0.6,
          startsIn: 0.5,
          shownLeft: 0.25,
          damage: 16,
          ownerId: 7,
          frost: { radius: 90, seconds: 4 },
        },
      ],
    };
    const { sim: after, events } = step(sim, 1);
    const hits = events.filter((e) => e.type === "playerHit") as {
      damage: number;
    }[];
    expect(hits.map((h) => h.damage)).toEqual([16]);
    expect(after.frost).toHaveLength(1);
    expect(after.cones).toEqual([]);
  });
});

describe("the Frost Wyrm's breath keeps to its lair (D-136)", () => {
  it("misses a player outside its arena, even inside the cone", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 650,
      y: 360,
    });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    sim = {
      ...sim,
      cones: [
        {
          at: { x: 400, y: 360 },
          angle: 0,
          range: 280,
          halfAngle: 0.6,
          startsIn: 0.1,
          shownLeft: 0.25,
          damage: 16,
          ownerId: 7,
          area: { x: 0, y: 0, width: 600, height: 720 },
        },
      ],
    };
    const { events } = step(sim, 0.5);
    expect(events.some((e) => e.type === "playerHit")).toBe(false);
  });
});
