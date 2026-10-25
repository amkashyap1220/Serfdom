import { describe, expect, it } from "vitest";
import type { EnemyState } from "./enemy.ts";
import { WEAPON_TYPES, type WeaponType } from "./items.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { recordRunEvents, newRunStats } from "./run-stats.ts";
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
import { combatFor, SERF_BASE } from "./stats.ts";
import {
  WEAPON_ATTACKS,
  attackOf,
  attackRange,
  swingCatches,
  type SwingAttack,
} from "./weapon-patterns.ts";

const east: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};

/** A player at (0, 0) wielding `weapon`, with tough dummies at these spots. */
function world(weapon: WeaponType, at: [number, number][]): SimState {
  let sim = addPlayer(
    createSimState([], { respawnSeconds: null }),
    1,
    { x: 0, y: 0 },
    SERF_BASE,
    3,
    null,
    weapon,
  );
  sim = spawnEnemies(
    sim,
    at.map(([x, y]) => ({ kind: "dummy", at: { x, y }, roomId: null })),
  );
  return {
    ...sim,
    enemies: sim.enemies.map((e) => ({ ...e, hp: 1e6, maxHp: 1e6 })),
  };
}

/** Pulls the trigger once, then lets the world run without firing again. */
function pull(
  sim: SimState,
  walls: { x: number; y: number; width: number; height: number }[] = [],
  seconds = 1.5,
) {
  const first = applyPlayerInput(sim, 1, east, walls, TICK_SECONDS);
  const events: SimEvent[] = [...first.events];
  sim = first.state;
  for (let t = 0; t < Math.round(seconds / TICK_SECONDS); t++) {
    const r = stepWorld(sim, walls, TICK_SECONDS);
    sim = {
      ...r.state,
      players: r.state.players.map((p) => ({ ...p, fireCooldown: 99 })),
    };
    events.push(...r.events);
  }
  return { sim, events };
}

const hitIds = (events: SimEvent[]) =>
  (events.filter((e) => e.type === "hit") as { enemyId: number }[])
    .map((h) => h.enemyId)
    .sort();
const enemyIds = (sim: SimState, n = sim.enemies.length) =>
  sim.enemies
    .slice(0, n)
    .map((e) => e.id)
    .sort();

describe("every base weapon has its own kind of attack (D-141)", () => {
  it("the wand is the only long-range single shot; the bow pierces, the staff bursts, the rest swing", () => {
    const kind = (w: WeaponType) => {
      const a = WEAPON_ATTACKS[w];
      if (a.kind === "swing") return "swing";
      return a.pierce ? "pierce" : a.burst ? "burst" : "bolt";
    };
    expect(Object.fromEntries(WEAPON_TYPES.map((w) => [w, kind(w)]))).toEqual({
      sword: "swing",
      dagger: "swing",
      axe: "swing",
      bow: "pierce",
      staff: "burst",
      wand: "bolt",
      mace: "swing",
    });
    // The swings differ in shape: no two share an arc and reach.
    const swings = WEAPON_TYPES.map((w) => WEAPON_ATTACKS[w]).filter(
      (a) => a.kind === "swing",
    );
    expect(new Set(swings.map((a) => JSON.stringify(a))).size).toBe(
      swings.length,
    );
  });

  it("on one target each comes close to the wand's damage per second", () => {
    const one = (w: WeaponType) =>
      WEAPON_ATTACKS[w].rate * WEAPON_ATTACKS[w].damage;
    for (const w of WEAPON_TYPES) {
      expect(one(w) / one("wand"), w).toBeGreaterThanOrEqual(0.95);
      expect(one(w) / one("wand"), w).toBeLessThanOrEqual(1.45);
    }
  });

  it("each weapon swings or fires at its own pace; bare hands keep the old shot", () => {
    const base = combatFor(SERF_BASE).shotsPerSecond;
    expect(combatFor(SERF_BASE, 30, "dagger").shotsPerSecond).toBeCloseTo(
      base * 1.6,
      9,
    );
    expect(combatFor(SERF_BASE, 30, "mace").shotsPerSecond).toBeCloseTo(
      base * 0.45,
      9,
    );
    expect(attackOf(null)).toMatchObject({ kind: "shot", range: 300 });
  });
});

describe("melee swings (D-141)", () => {
  it("a sword's slash cuts every enemy in its 100° arc within 70 px, at once, each once", () => {
    // In the arc: ahead, and 40° off; outside: 60° off, behind, too far.
    const sim = world("sword", [
      [50, 0],
      [Math.cos(0.7) * 50, Math.sin(0.7) * 50],
      [Math.cos(1.05) * 50, Math.sin(1.05) * 50],
      [-50, 0],
      [140, 0],
    ]);
    const r = applyPlayerInput(sim, 1, east, [], TICK_SECONDS);
    expect(hitIds(r.events)).toEqual(enemyIds(sim, 2));
    // No projectile: the swing is drawn, and done.
    expect(r.state.projectiles).toEqual([]);
    expect(r.events.find((e) => e.type === "swing")).toMatchObject({
      arcDegrees: 100,
      reach: 70,
    });
  });

  it("the mace smashes all round you; the dagger only straight ahead", () => {
    const ring: [number, number][] = [
      [50, 0],
      [-50, 0],
      [0, 50],
      [0, -50],
    ];
    const smash = applyPlayerInput(
      world("mace", ring),
      1,
      east,
      [],
      TICK_SECONDS,
    );
    expect(hitIds(smash.events)).toHaveLength(4);
    const stab = applyPlayerInput(
      world("dagger", ring),
      1,
      east,
      [],
      TICK_SECONDS,
    );
    expect(hitIds(stab.events)).toHaveLength(1);
    const dagger = WEAPON_ATTACKS.dagger as SwingAttack;
    const o = { x: 0, y: 0 };
    const ahead = { x: 1, y: 0 };
    expect(swingCatches(dagger, o, ahead, { x: 100, y: 0 }, 32)).toBe(true);
    expect(swingCatches(dagger, o, ahead, { x: 100, y: 40 }, 32)).toBe(false);
  });

  it("a swing that cuts three counts as one accurate shot", () => {
    const r = applyPlayerInput(
      world("axe", [
        [50, -30],
        [50, 0],
        [50, 30],
      ]),
      1,
      east,
      [],
      TICK_SECONDS,
    );
    expect(hitIds(r.events)).toHaveLength(3);
    const stats = recordRunEvents(newRunStats(), 1, r.events);
    expect(stats.shotsFired).toBe(1);
    expect(stats.shotsHit).toBe(1);
  });

  it("a grave knight's shield stops a swing from the front", () => {
    let sim = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 0 },
      SERF_BASE,
      3,
      null,
      "sword",
    );
    sim = spawnEnemies(sim, [
      { kind: "knight", at: { x: 50, y: 0 }, roomId: null },
    ]);
    // The knight faces the player (west).
    sim = {
      ...sim,
      enemies: sim.enemies.map(
        (e) =>
          ({
            ...e,
            ai: { ...(e.ai as { kind: "knight" }), facing: { x: -1, y: 0 } },
          }) as EnemyState,
      ),
    };
    const r = applyPlayerInput(sim, 1, east, [], TICK_SECONDS);
    expect(hitIds(r.events)).toEqual([]);
    expect(
      r.events.some((e) => e.type === "blast" && e.kind === "shieldBlock"),
    ).toBe(true);
  });
});

describe("the bow and the staff (D-141)", () => {
  it("an arrow pierces every enemy in its line, each once, one accurate shot", () => {
    const { sim, events } = pull(
      world("bow", [
        [80, 0],
        [160, 0],
        [240, 0],
      ]),
    );
    expect(hitIds(events)).toEqual(enemyIds(sim));
    expect(recordRunEvents(newRunStats(), 1, events).shotsHit).toBe(1);
  });

  it("the staff's orb bursts where it hits, catching everything within 40 px", () => {
    // It hits the first; the second is beside it; the third is far away.
    const { sim, events } = pull(
      world("staff", [
        [100, 0],
        [110, 30],
        [200, 150],
      ]),
    );
    expect(hitIds(events)).toEqual(enemyIds(sim, 2));
    expect(events.some((e) => e.type === "blast" && e.kind === "burst")).toBe(
      true,
    );
  });

  it("it bursts on a wall too", () => {
    const wall = [{ x: 110, y: -100, width: 40, height: 200 }];
    const { sim, events } = pull(world("staff", [[95, 40]]), wall, 1);
    expect(events.some((e) => e.type === "blast" && e.kind === "burst")).toBe(
      true,
    );
    expect(hitIds(events)).toEqual(enemyIds(sim));
  });
});

describe("auto-aim reaches what a swing cuts (D-141)", () => {
  it("a sword swings at a grunt whose body, not centre, is within 70 px", () => {
    const grunt = 32;
    const at = { x: 0, y: 0 };
    const ahead = { x: 1, y: 0 };
    const sword = WEAPON_ATTACKS.sword as SwingAttack;
    // 80 px away centre to centre: its body's edge is at 64, inside the reach.
    expect(swingCatches(sword, at, ahead, { x: 80, y: 0 }, grunt)).toBe(true);
    expect(attackRange(sword)).toBeGreaterThanOrEqual(80);
    // Every swing aims at least as far as it can cut a 48 px enemy.
    for (const w of WEAPON_TYPES) {
      const a = WEAPON_ATTACKS[w];
      if (a.kind === "swing") expect(attackRange(a)).toBe(a.reach + 24);
    }
  });
});
