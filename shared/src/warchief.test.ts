import { describe, expect, it } from "vitest";
import {
  enemyAct,
  isDazed,
  isTelegraphing,
  warchiefPhase,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { WARCHIEF } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (position: Vec2, id = 1): AiTarget => ({
  id,
  position,
  velocity: { x: 0, y: 0 },
});

/** A Warchief at (0, 0) at `share` of its HP, with its AI timers overridden. */
function warchief(
  share = 1,
  timers: Partial<
    Record<"sweep" | "axes" | "charge" | "warCry" | "slam", number>
  > = {},
): EnemyState {
  const e = newEnemy(1, "warchief", { x: 0, y: 0 }, null, null);
  if (e.ai.kind !== "warchief") throw new Error("not a warchief");
  return {
    ...e,
    hp: Math.round(WARCHIEF.maxHp * share),
    ai: { ...e.ai, ...timers },
  };
}

/** Runs the Warchief's AI for `seconds` against fixed targets; every action. */
function run(
  enemy: EnemyState,
  seconds: number,
  targets: (t: number) => AiTarget[],
  walls: readonly Rect[] = [],
): { enemy: EnemyState; actions: EnemyAction[] } {
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets(t), walls, TICK_SECONDS);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

describe("Goblin Warchief (D-117)", () => {
  it("has three phases: below 66% and below 33% HP", () => {
    expect(warchiefPhase(warchief(1))).toBe(1);
    expect(warchiefPhase(warchief(0.67))).toBe(1);
    expect(warchiefPhase(warchief(0.65))).toBe(2);
    expect(warchiefPhase(warchief(0.34))).toBe(2);
    expect(warchiefPhase(warchief(0.32))).toBe(3);
  });

  it("phase 1 walks after you and throws 3 axes every 3 s, but never charges, cries, or slams", () => {
    const { enemy, actions } = run(warchief(1, { sweep: 99 }), 10, () => [
      still({ x: 300, y: 0 }),
    ]);
    const throws = actions.filter((a) => a.bullets.length > 0);
    // First throw at 1.5 s, then 4.5, 7.5: three fans in 10 s.
    expect(throws.length).toBe(3);
    for (const a of throws) {
      expect(a.bullets.length).toBe(WARCHIEF.axes.count);
      for (const b of a.bullets) expect(b.spec.damage).toBe(6);
    }
    expect(actions.some((a) => a.summons.length > 0)).toBe(false);
    expect(
      actions.some(
        (a) =>
          a.enemy.ai.kind === "warchief" &&
          a.enemy.ai.mode.startsWith("charge"),
      ),
    ).toBe(false);
    // It closed in at walking speed (40 px/s), it did not stand still.
    expect(enemy.position.x).toBeGreaterThan(150);
  });

  it("sweeps after a 0.8 s warning, hitting for 8 exactly the circle the warning showed", () => {
    const facing = { x: 1, y: 0 };
    const { actions } = run(warchief(1, { axes: 99 }), 1, () => [
      still({ x: 60, y: 0 }),
    ]);
    const warning = actions[0]!;
    expect(isTelegraphing(warning.enemy)).toBe(true);
    expect(warning.sweep!.at.x).toBeCloseTo(facing.x * 50);
    expect(warning.sweep!.at.y).toBeCloseTo(0);
    expect(warning.sweep!.radius).toBe(60);
    expect(warning.sweep!.warning).toBe(true);
    // The warning starts on the tick it decides to swing; the hit is 0.8 s on.
    const hitAt = actions.findIndex((a) => a.sweep && !a.sweep.warning);
    expect(hitAt).toBe(ticks(WARCHIEF.sweep.windupSeconds));
    const hit = actions[hitAt]!;
    expect(hit.sweep).toEqual({ ...warning.sweep, warning: false });
    expect(hit.contacts).toEqual([{ playerId: 1, damage: 8 }]);
  });

  it("does not turn during the warning: step out of the circle and the sweep misses", () => {
    // The player stands in front, then steps behind-and-up out of the circle.
    const { actions } = run(warchief(1, { axes: 99 }), 1, (t) => [
      still(t === 0 ? { x: 60, y: 0 } : { x: -20, y: -80 }),
    ]);
    const hit = actions.find((a) => a.sweep && !a.sweep.warning)!;
    expect(hit.sweep!.at.x).toBeCloseTo(50);
    expect(hit.sweep!.at.y).toBeCloseTo(0);
    expect(hit.contacts).toEqual([]);
  });

  it("phase 2 charges after a 1 s warning at 300 px/s, hitting for 10 once", () => {
    const { actions } = run(
      warchief(0.5, { sweep: 99, axes: 99, warCry: 99, charge: 0 }),
      2.5,
      () => [still({ x: 250, y: 0 })],
    );
    expect(isTelegraphing(actions[0]!.enemy)).toBe(true);
    const charging = actions.findIndex(
      (a) => a.enemy.ai.kind === "warchief" && a.enemy.ai.mode === "charge",
    );
    expect(charging).toBe(ticks(WARCHIEF.charge.windupSeconds));
    const hits = actions.flatMap((a) => a.contacts);
    expect(hits).toEqual([{ playerId: 1, damage: 10 }]);
    // One tick of charging covers 300 px/s.
    const a = actions[charging + 1]!.enemy.position.x;
    const b = actions[charging + 2]!.enemy.position.x;
    expect(b - a).toBeCloseTo(300 * TICK_SECONDS, 3);
  });

  it("slamming into a pillar dazes it for 2.5 s, and a dazed Warchief throws nothing", () => {
    const pillar = { x: 100, y: -24, width: 48, height: 48 };
    const { actions } = run(
      warchief(0.5, { sweep: 99, axes: 99, warCry: 99, charge: 0 }),
      1.5,
      () => [still({ x: 300, y: 0 })],
      [pillar],
    );
    const first = actions.findIndex((a) => isDazed(a.enemy));
    expect(first).toBeGreaterThan(0);
    // It stopped against the pillar, short of the player.
    const stunned = actions[first]!.enemy;
    expect(stunned.position.x).toBeLessThan(pillar.x);
    // Its axes come off cooldown while it is dazed: still no throw.
    const dazed = { ...stunned, ai: { ...stunned.ai, axes: 0 } } as EnemyState;
    const later = run(dazed, 2.4, () => [still({ x: 300, y: 0 })], [pillar]);
    expect(later.actions.every((x) => x.bullets.length === 0)).toBe(true);
    expect(isDazed(later.enemy)).toBe(true);
    const after = run(later.enemy, 0.2, () => [still({ x: 300, y: 0 })], [
      pillar,
    ]);
    expect(isDazed(after.enemy)).toBe(false);
  });

  it("phase 2's war cry calls 2 skulkers out of the hall's holes, never more than 4 alive", () => {
    const holes: Vec2[] = [
      { x: -200, y: -280 },
      { x: 200, y: -280 },
      { x: -200, y: 280 },
      { x: 200, y: 280 },
    ];
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 200 },
    );
    sim = spawnEnemies(sim, [
      { kind: "warchief", at: { x: 0, y: 0 }, roomId: "hall" },
    ]);
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
    };
    const cry = (s: SimState): SimState => ({
      ...s,
      enemies: s.enemies.map((e) =>
        e.ai.kind === "warchief"
          ? {
              ...e,
              hp: WARCHIEF.maxHp / 2,
              ai: { ...e.ai, warCry: 0, sweep: 99, axes: 99, charge: 99 },
            }
          : e,
      ),
    });
    const skulkers = (s: SimState) =>
      s.enemies.filter((e) => e.kind === "skulker");
    const holesOf = (id: string) => (id === "hall" ? holes : []);

    sim = stepWorld(cry(sim), [], TICK_SECONDS, undefined, holesOf).state;
    expect(skulkers(sim).map((e) => e.position)).toEqual([holes[0], holes[1]]);
    sim = stepWorld(cry(sim), [], TICK_SECONDS, undefined, holesOf).state;
    expect(skulkers(sim).length).toBe(4);
    sim = stepWorld(cry(sim), [], TICK_SECONDS, undefined, holesOf).state;
    expect(skulkers(sim).length).toBe(4);
    expect(skulkers(sim).every((e) => e.roomId === "hall")).toBe(true);
  });

  it("phase 1 has no war cry, even when the timer says so", () => {
    const { actions } = run(warchief(1, { warCry: 0, sweep: 99 }), 1, () => [
      still({ x: 300, y: 0 }),
    ]);
    expect(actions.every((a) => a.summons.length === 0)).toBe(true);
  });

  it("phase 3 slams a ring of 20 shockwaves (5 each) and attacks 25% more often", () => {
    const { actions } = run(
      warchief(0.2, { slam: 0, sweep: 99, warCry: 99, charge: 99, axes: 99 }),
      TICK_SECONDS,
      () => [still({ x: 300, y: 0 })],
    );
    const slam = actions[0]!;
    expect(slam.bullets.length).toBe(20);
    for (const b of slam.bullets) expect(b.spec.damage).toBe(5);
    const ai = slam.enemy.ai;
    if (ai.kind !== "warchief") throw new Error("not a warchief");
    expect(ai.slam).toBeCloseTo(6 * 0.75);

    const throws = run(
      warchief(0.2, { axes: 0, sweep: 99, slam: 99, warCry: 99, charge: 99 }),
      TICK_SECONDS,
      () => [still({ x: 300, y: 0 })],
    ).enemy.ai;
    if (throws.kind !== "warchief") throw new Error("not a warchief");
    expect(throws.axes).toBeCloseTo(3 * 0.75);
  });

  it("the world step draws its sweep: a warning, then the hit", () => {
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 60, y: 0 },
    );
    sim = spawnEnemies(sim, [
      { kind: "warchief", at: { x: 0, y: 0 }, roomId: null },
    ]);
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1000, maxHp: 1000 })),
    };
    const kinds: string[] = [];
    const hits: number[] = [];
    for (let t = 0; t < ticks(1); t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      for (const e of r.events) {
        if (e.type === "blast") kinds.push(e.kind);
        if (e.type === "playerHit") hits.push(e.damage);
      }
    }
    expect(kinds).toEqual(["sweepWarning", "sweep"]);
    expect(hits).toEqual([8]);
  });
});
