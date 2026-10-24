import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { rockfallDrops, type RunProgress } from "./dungeon-run.ts";
import { dungeonInfo, entryProblem } from "./dungeons.ts";
import {
  enemyAct,
  isTelegraphing,
  pylonSpots,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BOSS_KINDS, HAWK, STORMCALLER } from "./enemy-config.ts";
import { isFaded, isHittable, newEnemy, type EnemyState } from "./enemy.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
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
import { LIGHTNING, WIND, gustAt, windDrift } from "./storm.ts";
import {
  buildSpire,
  SPIRE_PIECES,
  SPIRE_RECIPE,
  SPIRE_TOP,
} from "./stormspire.ts";
import { seededRandom } from "./seeded-random.ts";

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

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  context: Partial<AiContext> = {},
) {
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

describe("Stormspire (D-139)", () => {
  it("is an endgame dungeon: level 20, T7–T9", () => {
    expect(dungeonInfo("stormspire")).toMatchObject({
      name: "Stormspire",
      minLevel: 20,
      listed: true,
    });
    expect(entryProblem("stormspire", 1, 19)).toBe("Reach level 20 first.");
    expect(LOOT_POOLS.stormspire.tiers).toEqual([
      [7, 30],
      [8, 45],
      [9, 25],
    ]);
  });

  it("light 4,660, medium 7,140, heavy 9,920; every main path 73,840 with the Storm Caller", () => {
    const hp = (band: string) => [
      ...new Set(
        SPIRE_PIECES.filter((p) => p.band === band).map((p) =>
          pieceHp(p.piece),
        ),
      ),
    ];
    expect([hp("light"), hp("medium"), hp("heavy")]).toEqual([
      [4660],
      [7140],
      [9920],
    ]);
    expect(pieceHp(SPIRE_TOP)).toBe(18_000);
    expect(4660 + 3 * 7140 + 3 * 9920 + 18_000).toBe(73_840);
  });

  it("500 seeds follow the rules; no gaps; it climbs: the top is above the gate", () => {
    let up = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const l = buildSpire(seed);
      expect(recipeProblems(SPIRE_RECIPE, l), `seed ${seed}`).toEqual([]);
      const path = mainPath(l);
      if (path.at(-1)!.bounds.y < path[0]!.bounds.y) up++;
    }
    expect(up).toBeGreaterThan(450);
    for (let seed = 1; seed <= 20; seed++)
      expect(findLeak(buildSpire(seed))).toBeNull();
  });
});

describe("wind and lightning (D-139)", () => {
  it("gusts on a 5 s cycle: calm, rising 0.8 s, gusting 2 s", () => {
    expect([0, 2.1, 2.3, 3, 4.9, 5].map(gustAt)).toEqual([
      "calm",
      "calm",
      "rising",
      "gust",
      "gust",
      "calm",
    ]);
  });

  it("a gust pushes a player standing in its channel along it", () => {
    const winds = [
      { rect: { x: 0, y: 0, width: 400, height: 400 }, dir: { x: 0, y: 1 } },
    ];
    expect(windDrift({ x: 100, y: 100 }, 3.5, winds)).toEqual({
      x: 0,
      y: WIND.speed,
    });
    expect(windDrift({ x: 100, y: 100 }, 1, winds)).toEqual({ x: 0, y: 0 });
    let sim: SimState = {
      ...addPlayer(createSimState([]), 1, { x: 100, y: 100 }),
      winds,
      clock: 3.5,
    };
    sim = applyPlayerInput(sim, 1, idle, [], TICK_SECONDS).state;
    expect(sim.players[0]!.position.y).toBeCloseTo(
      100 + WIND.speed * TICK_SECONDS,
      9,
    );
  });

  it("lightning comes down where a player stands, warns 1 s, and hits as the room's", () => {
    const layout = buildSpire(3);
    const i = layout.rooms.findIndex((r) => r.rockfall?.lightning);
    expect(i).toBeGreaterThanOrEqual(0);
    const room = layout.rooms[i]!;
    const at = {
      x: room.bounds.x + room.bounds.width / 2,
      y: room.bounds.y + room.bounds.height / 2,
    };
    const progress = layout.rooms.map((_, k) => ({
      status: k === i ? "active" : "dormant",
      wave: 0,
      clock: 0,
      released: 0,
      waveStart: 0,
      dropped: 0,
      volleys: 0,
      gap: -1,
      runeSteps: 0,
    })) as RunProgress;
    const sim = addPlayer(createSimState([]), 1, at);
    const { drops } = rockfallDrops(
      progress,
      layout,
      sim.players,
      seededRandom(4),
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]!.lightning).toBe(true);
    expect(
      Math.hypot(drops[0]!.at.x - at.x, drops[0]!.at.y - at.y),
    ).toBeLessThanOrEqual(LIGHTNING.spread + 1e-9);
  });
});

describe("storm hawks (D-139)", () => {
  it("dive like a brute's charge, quicker: a 0.5 s warning, then 15", () => {
    const { actions } = run(
      newEnemy(1, "hawk", { x: 0, y: 0 }, null, null),
      1.5,
      [still(200, 0)],
    );
    expect(isTelegraphing(actions[0]!.enemy)).toBe(true);
    expect(actions.flatMap((a) => a.contacts.map((c) => c.damage))).toEqual([
      HAWK.chargeDamage,
    ]);
  });
});

describe("the Storm Caller (D-139)", () => {
  const caller = (share = 1) => {
    const e = newEnemy(1, "stormcaller", { x: 380, y: 380 }, "throne", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 18,000 HP and is never healed; calls lightning where every player stands, and fires fans of 5", () => {
    expect(STORMCALLER.maxHp).toBe(18000);
    expect(BOSS_KINDS).toContain("stormcaller");
    const { actions } = run(caller(), 2.6, [
      still(600, 380),
      still(200, 200, 2),
    ]);
    const strikes = actions.flatMap((a) => a.hazards);
    expect(strikes.slice(0, 2).map((h) => h.at)).toEqual([
      { x: 600, y: 380 },
      { x: 200, y: 200 },
    ]);
    expect(strikes[0]).toMatchObject({
      rune: true,
      delaySeconds: 1,
      damage: 14,
    });
    expect(
      actions.some((a) => a.bullets.length === STORMCALLER.bolts.count),
    ).toBe(true);
  });

  it("below 60% raises 3 pylons and is warded while they stand; arcs run between them, each warning 1 s", () => {
    const first = run(caller(0.59), TICK_SECONDS, [still(600, 380)]);
    const pylons = first.actions.flatMap((a) => a.summons);
    expect(pylons.map((p) => p.kind)).toEqual(["pylon", "pylon", "pylon"]);
    expect(pylons.map((p) => p.at)).toEqual(pylonSpots({ x: 380, y: 380 }));
    const warded = first.enemy;
    expect(isFaded(warded)).toBe(true);
    expect(isHittable(warded)).toBe(false);
    // With its pylons standing (as allies), arcs come between them.
    const standing = pylons.map((p, i) => ({
      ...newEnemy(10 + i, "pylon", p.at, "throne", null),
      summonerId: 1,
    }));
    const { actions } = run(warded, 3.1, [still(600, 380)], {
      aliveSummons: () => 3,
      allies: () => standing,
    });
    const arcs = actions.filter((a) => a.arc);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    expect(arcs[0]!.arc!.from).toEqual(pylons[0]!.at);
  });

  it("an arc warns, then burns players across it once, as the Storm Caller's hit", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 300,
      y: 300,
    });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    sim = {
      ...sim,
      beams: [
        {
          from: { x: 100, y: 300 },
          to: { x: 500, y: 300 },
          width: 20,
          damage: 14,
          remaining: 0.4,
          hit: [],
          startsIn: 1,
          ownerId: 9,
        },
      ],
    };
    const early = step(sim, 0.9);
    expect(early.events.some((e) => e.type === "playerHit")).toBe(false);
    const late = step(early.sim, 0.6);
    const hits = late.events.filter((e) => e.type === "playerHit") as {
      damage: number;
      enemyId: number;
    }[];
    expect(hits.map((h) => [h.damage, h.enemyId])).toEqual([[14, 9]]);
  });

  it("its pylons all broken, it is stunned for 4 s, then open again", () => {
    const warded = run(caller(0.59), TICK_SECONDS, [still(600, 380)]).enemy;
    const { actions } = run(warded, 4.5, [still(600, 380)], {
      aliveSummons: () => 0,
    });
    expect(actions[0]!.enemy.ai).toMatchObject({ mode: "stunned" });
    expect(actions.at(-1)!.enemy.ai).toMatchObject({ mode: "open" });
  });
});
