import { describe, expect, it } from "vitest";
import { crystalSpots, isDazed } from "./enemy-ai.ts";
import { LICH } from "./enemy-config.ts";
import { isFaded, isHittable, type EnemyState } from "./enemy.ts";
import { CRYPT_SANCTUM, buildCrypt } from "./forgotten-crypt.ts";
import type { Vec2 } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import type { Projectile } from "./projectile.ts";
import {
  addPlayer,
  aimTargets,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const HOLES: Vec2[] = [
  { x: -120, y: -280 },
  { x: 120, y: -280 },
  { x: -120, y: 280 },
  { x: 120, y: 280 },
];
const holesOf = (id: string) => (id === "throne" ? HOLES : []);

/** The Lich at (0, 0) in its room, a tough player 300 px east. */
function sanctum(): SimState {
  let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
    x: 300,
    y: 0,
  });
  sim = spawnEnemies(sim, [
    { kind: "lich", at: { x: 0, y: 0 }, roomId: "throne" },
  ]);
  return {
    ...sim,
    players: sim.players.map((p) => ({ ...p, hp: 1e7, maxHp: 1e7 })),
  };
}
const lichOf = (s: SimState) => s.enemies.find((e) => e.kind === "lich")!;
const setLich = (s: SimState, f: (e: EnemyState) => EnemyState): SimState => ({
  ...s,
  enemies: s.enemies.map((e) => (e.kind === "lich" ? f(e) : e)),
});
const atShare = (share: number) => (e: EnemyState) => ({
  ...e,
  hp: e.maxHp * share,
});
function run(
  sim: SimState,
  seconds: number,
): { sim: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(sim, [], TICK_SECONDS, undefined, holesOf);
    sim = {
      ...r.state,
      // Keep the room readable: drop the bullets once counted.
      projectiles: [],
    };
    events.push(...r.events);
  }
  return { sim, events };
}
const shotsFired = (events: SimEvent[]) =>
  events
    .filter((e) => e.type === "enemyAttack")
    .map((e) => (e.type === "enemyAttack" ? e.bullets : 0));

describe("the Lich (D-125)", () => {
  it("phase 1: a two-armed spiral, 8 a bullet, every 0.15 s, turning 90°/s", () => {
    const r = run(sanctum(), 3);
    const volleys = shotsFired(r.events);
    // The first after 1.5 s, then one every 0.15 s.
    expect(volleys.every((n) => n === LICH.spiral.arms)).toBe(true);
    expect(volleys.length).toBeGreaterThanOrEqual(Math.floor(1.5 / 0.15));
    const ai = lichOf(r.sim).ai;
    if (ai.kind !== "lich") throw new Error("not the Lich");
    expect((ai.spin * 180) / Math.PI).toBeCloseTo(90 * 3, 0);
    expect(LICH.spiral.bullet.damage).toBe(8);
    expect(isHittable(lichOf(r.sim))).toBe(true);
  });

  it("stands idle until its spiral starts, then spins while it fires (D-129)", () => {
    const firing = (s: SimState) => {
      const ai = lichOf(s).ai;
      if (ai.kind !== "lich") throw new Error("not the Lich");
      return ai.firing;
    };
    // The first volley waits 1.5 s.
    let r = run(sanctum(), 1.4);
    expect(firing(r.sim)).toBe(false);
    r = run(r.sim, 0.2);
    expect(firing(r.sim)).toBe(true);
    r = run(r.sim, 3);
    expect(firing(r.sim)).toBe(true);
  });

  it("calls 2 skeletons out of the sarcophagi every 12 s, at most 4 alive", () => {
    let sim = setLich(sanctum(), (e) =>
      e.ai.kind === "lich" ? { ...e, ai: { ...e.ai, rise: 0 } } : e,
    );
    sim = run(sim, TICK_SECONDS).sim;
    const skeletons = (s: SimState) =>
      s.enemies.filter((e) => e.kind === "skeleton");
    expect(skeletons(sim).map((e) => e.position)).toEqual([HOLES[0], HOLES[1]]);
    for (let k = 0; k < 2; k++) {
      sim = setLich(sim, (e) =>
        e.ai.kind === "lich" ? { ...e, ai: { ...e.ai, rise: 0 } } : e,
      );
      sim = run(sim, TICK_SECONDS).sim;
    }
    expect(skeletons(sim)).toHaveLength(LICH.rise.maxAlive);
  });

  it("below 60%: warded while 3 crystals stand, firing 16-bullet rings every 2.5 s; shots and auto-aim pass it by", () => {
    let sim = setLich(sanctum(), atShare(0.59));
    sim = run(sim, 0.5).sim;
    const lich = lichOf(sim);
    expect(isFaded(lich)).toBe(true);
    expect(isHittable(lich)).toBe(false);
    const crystals = sim.enemies.filter((e) => e.kind === "crystal");
    expect(crystals.map((c) => c.position)).toEqual(
      crystalSpots({ x: 0, y: 0 }),
    );
    expect(crystals.every((c) => c.summonerId === lich.id)).toBe(true);
    expect(aimTargets(sim).map((t) => t.id)).not.toContain(lich.id);
    const rings = shotsFired(run(sim, 5.1).events);
    expect(rings).toEqual([16, 16]);
    // A shot straight through it does nothing.
    const shot: Projectile = {
      id: 1,
      owner: "player",
      ownerId: 1,
      position: { x: 60, y: 0 },
      direction: { x: -1, y: 0 },
      speed: 600,
      remaining: 200,
      damage: 500,
      size: 6,
    };
    let through: SimState = { ...sim, projectiles: [shot] };
    for (let t = 0; t < ticks(0.2); t++) {
      through = stepWorld(through, [], TICK_SECONDS, undefined, holesOf).state;
    }
    expect(lichOf(through).hp).toBe(lich.hp);
  });

  it("warded, it turns once quickly with each ring, otherwise stands idle (D-129)", () => {
    const state = (s: SimState) => {
      const ai = lichOf(s).ai;
      if (ai.kind !== "lich") throw new Error("not the Lich");
      return ai;
    };
    // Warded on the first step; its first ring goes out on the next.
    let sim = run(setLich(sanctum(), atShare(0.59)), 0.1).sim;
    const start = state(sim).spin;
    expect(state(sim).firing).toBe(true);
    sim = run(sim, 0.6).sim;
    expect(state(sim).firing).toBe(false);
    // One full turn, give or take a step.
    expect(state(sim).spin - start).toBeGreaterThan(1.6 * Math.PI);
    expect(state(sim).spin - start).toBeLessThan(2.1 * Math.PI);
    sim = run(sim, 1.5).sim;
    expect(state(sim).firing).toBe(false);
  });

  it("breaking the crystals stuns it for 4 s (hittable, no attacks), then the spiral returns", () => {
    let sim = run(setLich(sanctum(), atShare(0.59)), 0.5).sim;
    sim = {
      ...sim,
      enemies: sim.enemies.filter((e) => e.kind !== "crystal"),
    };
    sim = run(sim, TICK_SECONDS).sim;
    expect(isDazed(lichOf(sim))).toBe(true);
    expect(isHittable(lichOf(sim))).toBe(true);
    const stunned = run(sim, LICH.stunSeconds - 0.1);
    expect(shotsFired(stunned.events)).toEqual([]);
    const ai = lichOf(stunned.sim).ai;
    expect(ai.kind === "lich" && ai.firing).toBe(false);
    const after = run(stunned.sim, 0.5);
    expect(isDazed(lichOf(after.sim))).toBe(false);
    expect(shotsFired(after.events).length).toBeGreaterThan(0);
    // The first ward is used up: no new crystals while still under 60%.
    expect(after.sim.enemies.some((e) => e.kind === "crystal")).toBe(false);
  });

  it("below 30%: crystals again, then a faster spiral and runes under every player and round it", () => {
    // Past the first ward already.
    let sim = setLich(sanctum(), (e) =>
      e.ai.kind === "lich"
        ? { ...e, hp: e.maxHp * 0.29, ai: { ...e.ai, wards: 1 } }
        : e,
    );
    sim = run(sim, 0.5).sim;
    expect(isFaded(lichOf(sim))).toBe(true);
    expect(sim.enemies.filter((e) => e.kind === "crystal")).toHaveLength(3);
    sim = run(
      { ...sim, enemies: sim.enemies.filter((e) => e.kind !== "crystal") },
      LICH.stunSeconds + 0.2,
    ).sim;
    sim = setLich(sim, (e) =>
      e.ai.kind === "lich" ? { ...e, ai: { ...e.ai, runes: 0 } } : e,
    );
    const r = stepWorld(sim, [], TICK_SECONDS, undefined, holesOf);
    const runes = r.state.hazards.filter((h) => h.rune);
    // One under the player, plus two at 160 px and two at 260 px.
    expect(runes).toHaveLength(1 + 4);
    expect(runes.every((h) => h.damage === 12 && h.radius === 32)).toBe(true);
    expect(
      runes
        .map((h) => Math.round(Math.hypot(h.position.x, h.position.y)))
        .sort((a, b) => a - b),
    ).toEqual([160, 160, 260, 260, 300]);
    expect(runes.some((h) => h.position.x === 300 && h.position.y === 0)).toBe(
      true,
    );
    // The faster spiral: a volley every 0.1 s.
    const volleys = shotsFired(run(r.state, 1).events);
    expect(volleys.length).toBeGreaterThanOrEqual(9);
  });

  it("lives in the Sanctum: centre of the room (where the portal opens), 4 sarcophagi, no pillars", () => {
    expect(CRYPT_SANCTUM.waves).toEqual([
      [{ kind: "lich", at: { x: 320, y: 300 } }],
    ]);
    expect(CRYPT_SANCTUM.holes).toHaveLength(4);
    expect(CRYPT_SANCTUM.obstacles ?? []).toEqual([]);
    const layout = buildCrypt(5);
    const hall = layout.rooms.find((r) => r.id === "throne")!;
    expect(hall.name).toBe("Sanctum");
    const lich = hall.waves[0]![0]!;
    expect(layout.exitPortal).toEqual(lich.at);
  });
});
