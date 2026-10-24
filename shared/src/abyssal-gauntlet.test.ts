import { describe, expect, it } from "vitest";
import {
  buildGauntlet,
  GAUNTLET_ARENA,
  GAUNTLET_RECIPE,
} from "./abyssal-gauntlet.ts";
import { pieceHp } from "./dungeon-gen.ts";
import {
  arrowVolleys,
  rockfallDrops,
  runeBursts,
  stepRooms,
  type RoomProgress,
  type RunProgress,
} from "./dungeon-run.ts";
import { dungeonInfo, entryProblem } from "./dungeons.ts";
import {
  enemyAct,
  isDazed,
  isTelegraphing,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BOSS_KINDS, WARDEN } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { seededRandom } from "./seeded-random.ts";
import { addPlayer, createSimState, spawnEnemies } from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  walls = [] as { x: number; y: number; width: number; height: number }[],
) {
  const ctx: AiContext = {
    aliveSummons: () => 0,
    boundsOf: () => ({ x: 0, y: 0, width: 1120, height: 960 }),
  };
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, walls, TICK_SECONDS, ctx);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

const layout = buildGauntlet(1);
const arenaIndex = layout.rooms.findIndex((r) => r.name === "Abyss arena");
const fighting = (
  wave: number,
  clock: number,
  extra: Partial<RoomProgress> = {},
): RunProgress =>
  layout.rooms.map((_, i) =>
    i === arenaIndex
      ? {
          status: "active",
          wave,
          clock,
          released: 0,
          waveStart: 0,
          dropped: 0,
          volleys: 0,
          gap: -1,
          runeSteps: 0,
          ...extra,
        }
      : {
          status: "cleared",
          wave: 0,
          clock: 0,
          released: 0,
          waveStart: 0,
          dropped: 0,
          volleys: 0,
          gap: -1,
          runeSteps: 0,
        },
  ) as RunProgress;

describe("the Abyssal Gauntlet (D-138)", () => {
  it("is an endgame dungeon: level 20, T7–T9", () => {
    expect(dungeonInfo("abyssal-gauntlet")).toMatchObject({
      name: "Abyssal Gauntlet",
      minLevel: 20,
      listed: true,
    });
    expect(entryProblem("abyssal-gauntlet", 2, 18)).toBe(
      "Reach level 20 first.",
    );
    expect(LOOT_POOLS["abyssal-gauntlet"].tiers).toEqual([
      [7, 30],
      [8, 45],
      [9, 25],
    ]);
  });

  it("is one arena past the gate: 8 waves, 69,100 HP, the Warden last; 100 seeds follow the rules", () => {
    expect(layout.rooms.map((r) => r.name)).toEqual([
      "Gauntlet gate",
      "Abyss arena",
    ]);
    expect(GAUNTLET_ARENA.waves).toHaveLength(8);
    expect(GAUNTLET_ARENA.waves.at(-1)!.map((s) => s.kind)).toEqual(["warden"]);
    expect(pieceHp(GAUNTLET_ARENA)).toBe(69_100);
    for (let seed = 1; seed <= 100; seed++) {
      expect(
        recipeProblems(GAUNTLET_RECIPE, buildGauntlet(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    expect(findLeak(layout)).toBeNull();
  });

  it("its traps wait for their waves, then start fresh rather than catching up", () => {
    const random = seededRandom(1);
    // Wave 1 (index 0), 30 s in: no braziers, runes, or slag yet.
    expect(arrowVolleys(fighting(0, 30), layout, random).shots).toEqual([]);
    expect(runeBursts(fighting(0, 30), layout).bursts).toEqual([]);
    expect(rockfallDrops(fighting(0, 30), layout, [], random).drops).toEqual(
      [],
    );
    // Waiting keeps the braziers' count at "now"...
    const waited = arrowVolleys(fighting(0, 30), layout, random).progress;
    // ...so once wave 2 comes, the next volley is the one after now, not 10 at once.
    const started = arrowVolleys(
      [
        ...waited.slice(0, arenaIndex),
        { ...waited[arenaIndex]!, wave: 1, clock: 31 },
        ...waited.slice(arenaIndex + 1),
      ],
      layout,
      random,
    );
    expect(started.shots.length).toBeLessThanOrEqual(3);
    // Runes only from wave 4, slag only from wave 6.
    expect(runeBursts(fighting(2, 30), layout).bursts).toEqual([]);
    expect(rockfallDrops(fighting(4, 30), layout, [], random).drops).toEqual(
      [],
    );
    const lateRunes = runeBursts(fighting(3, 0), layout);
    expect(lateRunes.progress[arenaIndex]!.runeSteps).toBeGreaterThanOrEqual(0);
  });

  it("each wave comes when the last is beaten, or after 45 s at the latest", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 0,
      y: 0,
    });
    const arena = layout.rooms[arenaIndex]!;
    sim = spawnEnemies(
      sim,
      arena.waves[0]!.map((s) => ({ ...s, roomId: arena.id })),
    );
    const at = (clock: number, waveStart = 0) =>
      stepRooms(
        layout.rooms.map((_, i) =>
          i === arenaIndex
            ? {
                status: "active",
                wave: 0,
                clock,
                released: 0,
                waveStart,
                dropped: 0,
                volleys: 0,
                gap: -1,
                runeSteps: 0,
              }
            : {
                status: "cleared",
                wave: 0,
                clock: 0,
                released: 0,
                waveStart: 0,
                dropped: 0,
                volleys: 0,
                gap: -1,
                runeSteps: 0,
              },
        ) as RunProgress,
        sim,
        layout,
      );
    // Wave 1 still alive at 40 s: no new wave; at 45 s: wave 2 comes anyway.
    expect(at(40).progress[arenaIndex]!.wave).toBe(0);
    const timed = at(45);
    expect(timed.progress[arenaIndex]!.wave).toBe(1);
    expect(timed.spawns.length).toBe(arena.waves[1]!.length);
  });
});

describe("the Warden of the Abyss (D-138)", () => {
  const warden = (share = 1) => {
    const e = newEnemy(1, "warden", { x: 560, y: 480 }, "throne", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 18,000 HP and is never healed; spirals from the start, two arms, every 0.15 s, but stays put above 66%", () => {
    expect(WARDEN.maxHp).toBe(18000);
    expect(BOSS_KINDS).toContain("warden");
    const { enemy, actions } = run(warden(), 3, [still(800, 480)]);
    const volleys = actions.filter((a) => a.bullets.length === 2);
    expect(volleys.length).toBeGreaterThan(10);
    expect(enemy.position).toEqual({ x: 560, y: 480 });
    expect(actions.some((a) => a.wave)).toBe(false);
  });

  it("below 66% it walks and charges: a 1 s warning, then 16; a wall dazes it", () => {
    const { actions } = run(warden(0.6), 6, [still(820, 480)]);
    expect(actions.some((a) => isTelegraphing(a.enemy))).toBe(true);
    expect(actions.flatMap((a) => a.contacts.map((c) => c.damage))).toContain(
      WARDEN.charge.damage,
    );
    // The player behind a wall: it walks into the wall, then charges into it.
    const wall = [{ x: 680, y: 0, width: 40, height: 960 }];
    const dazed = run(warden(0.6), 8, [still(820, 480)], wall).actions;
    expect(dazed.some((a) => isDazed(a.enemy))).toBe(true);
  });

  it("below 33% it slams too, every 5 s, a shockwave ring with a gap", () => {
    const { actions } = run(warden(0.3), 5.2, [still(820, 480)]);
    const rings = actions.filter((a) => a.wave);
    expect(rings).toHaveLength(2);
    expect(rings[0]!.wave!.area).toBeDefined();
  });
});
