import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import {
  enemyAct,
  hammerSpot,
  isTelegraphing,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BOSS_KINDS, FORGEMASTER } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import { FORGE_HEART, FORGE_PIECES, FORGE_RECIPE } from "./ember-forge.ts";
import {
  burningStrips,
  inGap,
  laneAt,
  safeLane,
  slamGap,
  waveHits,
} from "./forge-boss.ts";
import type { Rect } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});
const ARENA: Rect = { x: 0, y: 0, width: 720, height: 640 };
const DOORS = [
  { x: 360, y: 20 },
  { x: 360, y: 620 },
];

function boss(hpShare = 1, roomId: string | null = "heart"): EnemyState {
  const e = newEnemy(1, "forgemaster", { x: 360, y: 320 }, roomId, null);
  return { ...e, hp: e.maxHp * hpShare };
}

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  context: Partial<AiContext> = {},
): { enemy: EnemyState; actions: EnemyAction[] } {
  const ctx: AiContext = {
    aliveSummons: () => 0,
    holesOf: () => DOORS,
    boundsOf: () => ARENA,
    ...context,
  };
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, [], TICK_SECONDS, ctx);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

/** A world with tough players at `at` and the Forgemaster in its arena. */
function world(at: { x: number; y: number }[], hpShare = 1): SimState {
  let sim = createSimState([], { respawnSeconds: null });
  at.forEach((p, i) => (sim = addPlayer(sim, i + 1, p)));
  sim = spawnEnemies(sim, [
    { kind: "forgemaster", at: { x: 360, y: 320 }, roomId: "heart" },
  ]);
  return {
    ...sim,
    players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    enemies: sim.enemies.map((e) => ({ ...e, hp: e.maxHp * hpShare })),
  };
}

function step(sim: SimState, seconds: number) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(
      sim,
      [],
      TICK_SECONDS,
      undefined,
      () => DOORS,
      () => ARENA,
    );
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

const hitsOn = (events: SimEvent[], playerId: number) =>
  events.filter((e) => e.type === "playerHit" && e.playerId === playerId) as {
    damage: number;
  }[];

describe("the Forgemaster (D-134)", () => {
  it("has 14,000 HP and 88 px, waits in the 720×640 Forge heart with two forge doors, and is never healed", () => {
    expect(FORGEMASTER.maxHp).toBe(14000);
    expect(FORGEMASTER.size).toBe(88);
    expect(FORGE_HEART).toMatchObject({ width: 720, height: 640 });
    expect(FORGE_HEART.waves).toEqual([
      [{ kind: "forgemaster", at: { x: 360, y: 320 } }],
    ]);
    expect(FORGE_HEART.holes).toHaveLength(2);
    expect(FORGE_RECIPE.boss).toBe(FORGE_HEART);
    expect(BOSS_KINDS).toContain("forgemaster");
  });

  it("raises the hammer for 0.8 s (the warning), then hits 14 in a 70 px circle in front, every 5 s", () => {
    // Player 1 under the hammer, player 2 behind it, far away.
    const { actions } = run(boss(), 7.6, [still(500, 320), still(60, 320, 2)]);
    const warnings = actions.filter((a) => a.slam?.warning);
    const slams = actions.filter((a) => a.slam && !a.slam.warning);
    // First at 2.5 s, then 5 s later.
    expect(warnings).toHaveLength(2);
    const firstUp = actions.findIndex((a) => a.slam?.warning);
    const firstDown = actions.findIndex((a) => a.slam && !a.slam.warning);
    expect(firstUp * TICK_SECONDS).toBeCloseTo(2.5, 1);
    expect((firstDown - firstUp) * TICK_SECONDS).toBeCloseTo(0.8, 1);
    expect(isTelegraphing(actions[firstUp]!.enemy)).toBe(true);
    const landed = slams[0]!.slam!;
    const spot = hammerSpot(actions[firstDown]!.enemy.position, { x: 1, y: 0 });
    expect(landed.warning).toBe(false);
    expect(landed.radius).toBe(FORGEMASTER.slam.radius);
    expect(landed.at.x).toBeCloseTo(spot.x, 6);
    expect(landed.at.y).toBeCloseTo(spot.y, 6);
    expect(slams[0]!.contacts).toEqual([{ playerId: 1, damage: 14 }]);
  });

  it("each slam's shockwave is sent with the windup, its gap new every time", () => {
    const { actions } = run(boss(), 7.6, [still(500, 320)]);
    const waves = actions.filter((a) => a.wave).map((a) => a.wave!);
    expect(waves).toHaveLength(2);
    expect(waves[0]!.startsIn).toBe(FORGEMASTER.slam.windupSeconds);
    expect(waves[0]!.area).toEqual(ARENA);
    expect(waves[0]!.gap).toBeCloseTo(slamGap(1, 0), 9);
    expect(waves[1]!.gap).toBeCloseTo(slamGap(1, 1), 9);
    expect(Math.abs(waves[1]!.gap - waves[0]!.gap)).toBeGreaterThan(0.5);
  });

  it("fires aimed spreads of 5 molten bullets, 15° apart, for 9, every 2.5 s", () => {
    const { actions } = run(boss(), 4.1, [still(700, 320)]);
    const volleys = actions.filter((a) => a.bullets.length > 0);
    expect(volleys).toHaveLength(2);
    const v = volleys[0]!.bullets;
    expect(v).toHaveLength(5);
    expect(v.every((b) => b.spec.damage === 9)).toBe(true);
    const angles = v.map(
      (b) => (Math.atan2(b.direction.y, b.direction.x) * 180) / Math.PI,
    );
    expect(angles[2]).toBeCloseTo(0, 6);
    expect(angles[3]! - angles[2]!).toBeCloseTo(15, 6);
  });

  it("walks after the nearest player at 30 px/s", () => {
    const { enemy } = run(boss(), 1, [still(700, 320)]);
    expect(enemy.position.x - 360).toBeCloseTo(FORGEMASTER.speed, 0);
  });
});

describe("its shockwave (D-134)", () => {
  it("waits out the windup, grows at 180 px/s, and hits each player once for 12", () => {
    let sim = world([{ x: 360 + 60 + 200, y: 320 }]);
    // The hammer comes down at once; the player stands 200 px from it.
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) =>
        e.ai.kind === "forgemaster" ? { ...e, ai: { ...e.ai, slam: 0 } } : e,
      ),
    };
    const { events } = step(sim, 3);
    const wave = hitsOn(events, 1).filter((h) => h.damage === 12);
    expect(wave).toHaveLength(1);
  });

  it("misses a player in its gap, and anyone outside the arena", () => {
    const at = { x: 0, y: 0 };
    expect(waveHits({ at, radius: 100, gap: 0 }, { x: 100, y: 0 })).toBe(false);
    expect(waveHits({ at, radius: 100, gap: Math.PI }, { x: 100, y: 0 })).toBe(
      true,
    );
    // The gap is 60° wide: 29° off its centre is inside, 31° is not.
    const rad = (d: number) => (d * Math.PI) / 180;
    expect(inGap(0, rad(29))).toBe(true);
    expect(inGap(0, rad(31))).toBe(false);
    expect(inGap(rad(350), rad(10))).toBe(true);
    // Its band is 16 px thick; any overlap with the 31 px hurtbox counts.
    expect(waveHits({ at, radius: 100, gap: Math.PI }, { x: 123, y: 0 })).toBe(
      true,
    );
    expect(waveHits({ at, radius: 100, gap: Math.PI }, { x: 125, y: 0 })).toBe(
      false,
    );
  });
});

describe("its golems (D-134)", () => {
  it("below 60%, two golems step out of the forge doors every 10 s, at most 2 alive", () => {
    const summons = (alive: number) =>
      run(boss(0.59), 10.5, [still(700, 320)], {
        aliveSummons: () => alive,
      }).actions.flatMap((a) => a.summons);
    const none = summons(0);
    // At once as the phase starts, and again 10 s later.
    expect(none).toHaveLength(4);
    expect(none.every((s) => s.kind === "golem")).toBe(true);
    expect(none.slice(0, 2).map((s) => s.at)).toEqual(DOORS);
    expect(summons(1).length).toBe(2);
    expect(summons(2)).toEqual([]);
    // Above 60%: none.
    expect(
      run(boss(0.61), 10.5, [still(700, 320)]).actions.flatMap(
        (a) => a.summons,
      ),
    ).toEqual([]);
  });
});

describe("enraged: floor plates (D-134)", () => {
  it("below 30%, every 2.5 s, all but a 160 px lane glows 1.5 s then bursts for 14; the lane sweeps a plate at a time", () => {
    const { actions } = run(boss(0.29), 7.6, [still(700, 320)]);
    const plates = actions.filter((a) => a.plates).map((a) => a.plates!);
    expect(plates).toHaveLength(4);
    expect(plates.map((p) => p.lane)).toEqual([0, 1, 2, 3]);
    expect(safeLane(ARENA, 0)).toEqual({ x: 0, y: 0, width: 160, height: 640 });
    expect(burningStrips(ARENA, 3)).toEqual([
      { x: 0, y: 0, width: 240, height: 640 },
      { x: 400, y: 0, width: 320, height: 640 },
    ]);
    // 9 plates across: the lane has 8 places, so it turns back after 7.
    expect([7, 8, 9].map((k) => laneAt(ARENA, k))).toEqual([7, 6, 5]);
  });

  it("the burst hurts players on the burning floor, not in the lane", () => {
    // Player 1 in the first lane (x 0–160), player 2 out on the floor.
    const sim = world(
      [
        { x: 80, y: 600 },
        { x: 500, y: 600 },
      ],
      0.29,
    );
    const { events } = step(sim, FORGEMASTER.plates.warnSeconds + 0.1);
    expect(hitsOn(events, 2).filter((h) => h.damage === 14).length).toBe(1);
    expect(hitsOn(events, 1).filter((h) => h.damage === 14)).toEqual([]);
  });

  it("enraged, it slams every 3.5 s", () => {
    const { actions } = run(boss(0.29), 9.6, [still(700, 320)]);
    const ups = actions
      .map((a, i) => (a.slam?.warning ? i * TICK_SECONDS : -1))
      .filter((t) => t >= 0);
    expect(ups).toHaveLength(3);
    expect(ups[1]! - ups[0]!).toBeCloseTo(3.5, 1);
  });
});

describe("the forge's HP band with the Forgemaster (D-134)", () => {
  it("main paths come to 54,030–57,170, inside D-130's 52,000–62,000", () => {
    const hp = (band: string) =>
      FORGE_PIECES.filter((p) => p.band === band)
        .map((p) => pieceHp(p.piece))
        .sort((a, b) => a - b);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const [light, medium, heavy] = [hp("light"), hp("medium"), hp("heavy")];
    const bossHp = pieceHp(FORGE_RECIPE.boss);
    expect(bossHp).toBe(14_000);
    const least =
      light[0]! + sum(medium.slice(0, 3)) + sum(heavy.slice(0, 3)) + bossHp;
    const most =
      light.at(-1)! + sum(medium.slice(-3)) + sum(heavy.slice(-3)) + bossHp;
    expect([least, most]).toEqual([54_030, 57_170]);
    expect(FORGE_RECIPE.requiredHp).toEqual({ min: 52_000, max: 62_000 });
  });
});
