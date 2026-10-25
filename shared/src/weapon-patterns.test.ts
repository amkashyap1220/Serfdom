import { describe, expect, it } from "vitest";
import { WEAPON_TYPES, type WeaponType } from "./items.ts";
import { TICK_SECONDS } from "./movement-config.ts";
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
import { WEAPON_PATTERNS, patternOf } from "./weapon-patterns.ts";

const east: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};

/** One trigger pull with this weapon: the projectiles it fires. */
function fire(weapon: WeaponType) {
  let sim = addPlayer(
    createSimState([]),
    1,
    { x: 0, y: 0 },
    SERF_BASE,
    3,
    null,
    weapon,
  );
  sim = applyPlayerInput(sim, 1, east, [], TICK_SECONDS).state;
  return sim.projectiles;
}

const angle = (d: { x: number; y: number }) =>
  Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI);

describe("every base weapon has its own attack pattern (D-141)", () => {
  it("the wand is the only long-range single shot", () => {
    for (const w of WEAPON_TYPES) {
      const p = WEAPON_PATTERNS[w];
      const longSingle = p.shots.length === 1 && !p.pierce && p.range >= 200;
      expect(longSingle, w).toBe(w === "wand");
    }
  });

  it("no two weapons share a pattern", () => {
    const keys = WEAPON_TYPES.map((w) => JSON.stringify(WEAPON_PATTERNS[w]));
    expect(new Set(keys).size).toBe(WEAPON_TYPES.length);
  });

  it("with everything on one target, each stays close to the wand's damage per second", () => {
    const dps = (w: WeaponType) => {
      const p = WEAPON_PATTERNS[w];
      return p.rate * p.damage * p.shots.length;
    };
    for (const w of WEAPON_TYPES) {
      // The mace's ring can only put one or two shockwaves on one target.
      const onOne =
        w === "mace"
          ? WEAPON_PATTERNS.mace.rate * WEAPON_PATTERNS.mace.damage
          : dps(w);
      expect(onOne / dps("wand"), w).toBeGreaterThanOrEqual(0.95);
      expect(onOne / dps("wand"), w).toBeLessThanOrEqual(1.45);
    }
  });

  it("fires the approved shapes", () => {
    expect(fire("wand").map((p) => angle(p.direction))).toEqual([0]);
    expect(fire("bow").map((p) => angle(p.direction))).toEqual([-12, 0, 12]);
    expect(fire("sword").map((p) => angle(p.direction))).toEqual([-20, 0, 20]);
    expect(fire("axe").map((p) => angle(p.direction))).toEqual([
      -40, -20, 0, 20, 40,
    ]);
    expect(fire("mace").map((p) => angle(p.direction))).toEqual([
      0, 60, 120, 180, -120, -60,
    ]);
    // Two daggers side by side, both straight ahead.
    const daggers = fire("dagger");
    expect(daggers.map((p) => angle(p.direction))).toEqual([0, 0]);
    expect(daggers.map((p) => p.position.y)).toEqual([-6, 6]);
    // The staff's one big orb pierces.
    const [orb] = fire("staff");
    expect(orb).toMatchObject({ size: 12, pierce: true, remaining: 260 });
    // Each projectile carries its share of the weapon's damage.
    const t3 = combatFor(SERF_BASE, 27 + 4 * 3, "bow").shotDamage;
    expect(fire("bow")[0]!.damage).toBeCloseTo(t3 * 0.5, 9);
  });

  it("each weapon fires at its own pace; bare hands are the original single shot", () => {
    const base = combatFor(SERF_BASE).shotsPerSecond;
    expect(combatFor(SERF_BASE, 30, "dagger").shotsPerSecond).toBeCloseTo(
      base * 1.5,
      9,
    );
    expect(combatFor(SERF_BASE, 30, "staff").shotsPerSecond).toBeCloseTo(
      base * 0.5,
      9,
    );
    expect(patternOf(null)).toMatchObject({
      range: 300,
      shots: [{ angleDegrees: 0, offset: 0 }],
    });
  });

  it("the staff's orb flies through every enemy in its path, hitting each once", () => {
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 0 },
      SERF_BASE,
      3,
      null,
      "staff",
    );
    sim = spawnEnemies(sim, [
      { kind: "dummy", at: { x: 80, y: 0 }, roomId: null },
      { kind: "dummy", at: { x: 160, y: 0 }, roomId: null },
    ]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({ ...e, hp: 1e6, maxHp: 1e6 })),
    };
    sim = applyPlayerInput(sim, 1, east, [], TICK_SECONDS).state;
    const events: SimEvent[] = [];
    for (let t = 0; t < 90; t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = {
        ...r.state,
        players: r.state.players.map((p) => ({ ...p, fireCooldown: 99 })),
      };
      events.push(...r.events);
    }
    const hits = events.filter((e) => e.type === "hit") as {
      enemyId: number;
    }[];
    expect(hits.map((h) => h.enemyId).sort()).toEqual(
      sim.enemies.map((e) => e.id).sort(),
    );
  });
});
