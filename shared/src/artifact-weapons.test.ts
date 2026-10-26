import { describe, expect, it } from "vitest";
import { WEAPON_ARTIFACT } from "./artifact-effects.ts";
import type { ArtifactId } from "./artifacts.ts";
import type { WeaponType } from "./items.ts";
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
import { SERF_BASE } from "./stats.ts";

const east: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};

/** A player at (0, 0) with `weapon` and these Artifacts, tough dummies at these spots. */
function world(
  weapon: WeaponType,
  artifacts: ArtifactId[],
  at: [number, number][],
  hp = 1e6,
): SimState {
  let sim = addPlayer(
    createSimState([], { respawnSeconds: null }),
    1,
    { x: 0, y: 0 },
    SERF_BASE,
    12,
    null,
    weapon,
    artifacts,
  );
  sim = spawnEnemies(
    sim,
    at.map(([x, y]) => ({ kind: "dummy", at: { x, y }, roomId: null })),
  );
  return {
    ...sim,
    enemies: sim.enemies.map((e) => ({ ...e, hp, maxHp: hp })),
  };
}

/** One attack now (its cooldown cleared first), then the world runs `seconds`. */
function attack(sim: SimState, seconds = 0) {
  sim = {
    ...sim,
    players: sim.players.map((p) => ({ ...p, fireCooldown: 0 })),
  };
  const first = applyPlayerInput(sim, 1, east, [], TICK_SECONDS);
  const events: SimEvent[] = [...first.events];
  sim = first.state;
  for (let t = 0; t < Math.round(seconds / TICK_SECONDS); t++) {
    const r = stepWorld(sim, [], TICK_SECONDS);
    sim = {
      ...r.state,
      players: r.state.players.map((p) => ({ ...p, fireCooldown: 99 })),
    };
    events.push(...r.events);
  }
  return { sim, events };
}

type Hit = Extract<SimEvent, { type: "hit" }>;
const hits = (events: SimEvent[]) =>
  events.filter((e): e is Hit => e.type === "hit");
const hitOn = (sim: SimState, events: SimEvent[], n: number) =>
  hits(events).filter((h) => h.enemyId === sim.enemies[n]?.id);

describe("weapon Artifacts (16b, D-153)", () => {
  it("Doomrend: a cleave cutting two throws an axe from each to one more within 120 px, for 40%", () => {
    // Two in the cleave; a third behind the first, out of the arc.
    const base = [
      [50, -20],
      [50, 20],
      [-60, -20],
    ] as [number, number][];
    const { sim, events } = attack(world("axe", ["doomrend"], base));
    const main = hitOn(sim, events, 0)[0]!.damage;
    expect(hitOn(sim, events, 2).map((h) => h.damage)).toEqual([
      expect.closeTo(main * WEAPON_ARTIFACT.doomrend.damage, 6),
    ]);
    expect(events.some((e) => e.type === "chain")).toBe(true);
    // A cleave that cuts only one throws nothing.
    const lone = attack(
      world(
        "axe",
        ["doomrend"],
        [
          [50, 0],
          [-60, 0],
        ],
      ),
    );
    expect(hitOn(lone.sim, lone.events, 1)).toEqual([]);
    // The same axe without the Artifact: no axes either.
    const plain = attack(world("axe", [], base));
    expect(hitOn(plain.sim, plain.events, 2)).toEqual([]);
  });

  it("Excalibur: every 5th slash also fires a piercing beam of light", () => {
    let sim = world("sword", ["excalibur"], [[300, 0]]);
    const beams: number[] = [];
    for (let n = 1; n <= 10; n++) {
      const r = attack(sim);
      sim = r.sim;
      if (sim.projectiles.some((p) => p.fromAbility && p.pierce)) beams.push(n);
      sim = { ...sim, projectiles: [] };
    }
    expect(beams).toEqual([5, 10]);
  });

  it("Whisper: a kill empowers the next stab within 2 s (double damage, half again the reach)", () => {
    // A weak one in reach, and a tough one 130 px out: beyond the stab's 90.
    let sim = world(
      "dagger",
      ["whisper"],
      [
        [50, 0],
        [130, 0],
      ],
    );
    sim = {
      ...sim,
      enemies: sim.enemies.map((e, i) => (i === 0 ? { ...e, hp: 1 } : e)),
    };
    let r = attack(sim);
    expect(r.events.some((e) => e.type === "defeated")).toBe(true);
    expect(hitOn(r.sim, r.events, 1)).toEqual([]);
    r = attack(r.sim);
    const far = r.sim.enemies.find((e) => e.position.x === 130)!;
    expect(hits(r.events).filter((h) => h.enemyId === far.id)).toHaveLength(1);
    // Spent: the next stab is ordinary again.
    r = attack(r.sim);
    expect(hits(r.events).filter((h) => h.enemyId === far.id)).toEqual([]);
  });

  it("Artemis: the arrow gains 25% per enemy pierced", () => {
    const { sim, events } = attack(
      world(
        "bow",
        ["artemis"],
        [
          [60, 0],
          [120, 0],
          [180, 0],
        ],
      ),
      1,
    );
    const d = [0, 1, 2].map((n) => hitOn(sim, events, n)[0]!.damage);
    expect(d[1]! / d[0]!).toBeCloseTo(1.25, 6);
    expect(d[2]! / d[0]!).toBeCloseTo(1.5, 6);
  });

  it("Aetherion: the orb pulls enemies within 120 px in, then bursts 60 px wide", () => {
    // It hits the first; the second is 100 px from there, out of a 60 px burst.
    const { sim, events } = attack(
      world(
        "staff",
        ["aetherion"],
        [
          [100, 0],
          [100, 100],
        ],
      ),
      1.5,
    );
    expect(hitOn(sim, events, 1)).toHaveLength(1);
    expect(sim.enemies[1]!.position.y).toBeLessThan(100);
    const plain = attack(
      world(
        "staff",
        [],
        [
          [100, 0],
          [100, 100],
        ],
      ),
      1.5,
    );
    expect(hitOn(plain.sim, plain.events, 1)).toEqual([]);
  });

  it("Eternity: every 4th bolt splits on a hit into 3 seeking bolts at the nearest others", () => {
    let sim = world(
      "wand",
      ["eternity"],
      [
        [100, 0],
        [100, 120],
        [100, -120],
        [250, 0],
      ],
    );
    const split: number[] = [];
    for (let n = 1; n <= 4; n++) {
      const r = attack(sim, 0.5);
      if (hitOn(r.sim, r.events, 1).length > 0) split.push(n);
      sim = { ...r.sim, projectiles: [] };
    }
    expect(split).toEqual([4]);
  });

  it("Golgorr: every 3rd smash sends a shockwave to 200 px, for 60%", () => {
    let sim = world(
      "mace",
      ["golgorr"],
      [
        [50, 0],
        [150, 0],
      ],
    );
    const waves: number[] = [];
    let ratio = 0;
    for (let n = 1; n <= 3; n++) {
      const r = attack(sim);
      const far = hitOn(r.sim, r.events, 1);
      if (far.length > 0) {
        waves.push(n);
        ratio = far[0]!.damage / hitOn(r.sim, r.events, 0)[0]!.damage;
      }
      sim = r.sim;
    }
    expect(waves).toEqual([3]);
    expect(ratio).toBeCloseTo(WEAPON_ARTIFACT.golgorr.damage, 6);
  });

  it("the same Artifact worn twice counts once", () => {
    const sim = world("axe", ["doomrend", "doomrend"], []);
    expect(sim.players[0]!.artifacts).toEqual(["doomrend"]);
  });
});
