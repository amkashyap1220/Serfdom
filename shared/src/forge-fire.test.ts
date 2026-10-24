import { describe, expect, it } from "vitest";
import {
  enemyAct,
  isTelegraphing,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { BELLOWS, ELEMENTAL, GOLEM, type EnemyKind } from "./enemy-config.ts";
import { damageEnemy, isVenting, newEnemy, type EnemyState } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import type { Projectile } from "./projectile.ts";
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

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  walls: readonly Rect[] = [],
): { enemy: EnemyState; actions: EnemyAction[] } {
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, walls, TICK_SECONDS);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

/** Players (tough enough to watch) and enemies; dungeon rules, no respawns. */
function world(
  players: { x: number; y: number }[],
  enemies: { kind: EnemyKind; x: number; y: number }[],
): SimState {
  let sim = createSimState([], { respawnSeconds: null });
  players.forEach((p, i) => (sim = addPlayer(sim, i + 1, p)));
  sim = spawnEnemies(
    sim,
    enemies.map((e) => ({
      kind: e.kind,
      at: { x: e.x, y: e.y },
      roomId: null,
    })),
  );
  return {
    ...sim,
    players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
  };
}

function step(sim: SimState, seconds: number, walls: readonly Rect[] = []) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(sim, walls, TICK_SECONDS);
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

const shot = (from: { x: number; y: number }, damage: number): Projectile => ({
  id: 99,
  owner: "player",
  ownerId: 1,
  position: from,
  direction: { x: 1, y: 0 },
  speed: 600,
  remaining: 600,
  damage,
  size: 6,
});

describe("fire elementals (D-132)", () => {
  it("rush at 120; within 50 px they flare for 0.6 s (the yellow warning), then explode for 14 and are gone", () => {
    const e = newEnemy(1, "elemental", { x: 0, y: 0 }, null, null);
    const { actions } = run(e, 3, [still(200, 0)]);
    const flaring = actions.filter((a) => isTelegraphing(a.enemy));
    // It closes 150 px at 120 px/s (1.25 s), then flares 0.6 s.
    const firstFlare = actions.findIndex((a) => isTelegraphing(a.enemy));
    expect(firstFlare * TICK_SECONDS).toBeCloseTo(150 / ELEMENTAL.speed, 1);
    expect(flaring.length * TICK_SECONDS).toBeCloseTo(ELEMENTAL.fuseSeconds, 1);
    // It stands still while it flares.
    const at = actions[firstFlare]!.enemy.position;
    expect(actions[firstFlare + 10]!.enemy.position).toEqual(at);
    const boom = actions.filter((a) => a.explosion);
    expect(boom).toHaveLength(1);
    expect(boom[0]!.explosion).toEqual({ at, radius: ELEMENTAL.radius });
    expect(boom[0]!.contacts).toEqual([
      { playerId: 1, damage: ELEMENTAL.damage },
    ]);
    expect(boom[0]!.enemy.hp).toBe(0);
  });

  it("the explosion hits every player its circle touches, no one else, and gives no kill", () => {
    // Player 1 sets it off; player 2 is just inside the blast (its hurtbox
    // reaches the circle); player 3 is clear; the bellows-keeper beside it
    // (which never attacks) is unhurt.
    let sim = world(
      [
        { x: 0, y: 0 },
        { x: 40, y: 60 },
        { x: 40, y: 140 },
      ],
      [
        { kind: "elemental", x: 40, y: 0 },
        { kind: "bellows", x: 80, y: 0 },
      ],
    );
    const { sim: after, events } = step(sim, 1.5);
    sim = after;
    const hits = events.filter((e) => e.type === "playerHit");
    expect(
      hits.map((h) => (h as { playerId: number }).playerId).sort(),
    ).toEqual([1, 2]);
    expect(
      events.some((e) => e.type === "blast" && e.kind === "explosion"),
    ).toBe(true);
    expect(events.some((e) => e.type === "defeated")).toBe(false);
    expect(sim.enemies.map((e) => e.kind)).toEqual(["bellows"]);
    expect(sim.enemies[0]!.hp).toBe(sim.enemies[0]!.maxHp);
  });

  it("killed during the flare, it does not explode", () => {
    let sim = world([{ x: 0, y: 0 }], [{ kind: "elemental", x: 40, y: 0 }]);
    sim = step(sim, 0.1).sim;
    expect(isTelegraphing(sim.enemies[0]!)).toBe(true);
    // A shot strong enough to kill it, just in front of it.
    sim = { ...sim, projectiles: [shot({ x: 10, y: 0 }, 500)] };
    const { events } = step(sim, 1.5);
    expect(events.some((e) => e.type === "defeated")).toBe(true);
    expect(events.some((e) => e.type === "playerHit")).toBe(false);
    expect(
      events.some((e) => e.type === "blast" && e.kind === "explosion"),
    ).toBe(false);
  });
});

describe("magma golems (D-132)", () => {
  const golem = () => newEnemy(1, "golem", { x: 0, y: 0 }, null, null);

  it("vent for 1.5 s of every 6 s", () => {
    const { actions } = run(golem(), 13.6, [still(2000, 0)]);
    const venting = actions.map((a) => isVenting(a.enemy));
    expect(venting.filter(Boolean).length * TICK_SECONDS).toBeCloseTo(
      2 * GOLEM.ventSeconds,
      1,
    );
    // Starting at 6 s and at 12 s.
    const starts = venting
      .map((v, i) => (v && !venting[i - 1] ? i * TICK_SECONDS : -1))
      .filter((s) => s >= 0);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeCloseTo(GOLEM.ventEverySeconds, 1);
    expect(starts[1]).toBeCloseTo(2 * GOLEM.ventEverySeconds, 1);
  });

  it("the crust halves every hit; venting, it takes double", () => {
    const crusted = damageEnemy(golem(), 100);
    expect(crusted.damage).toBe(50);
    expect(crusted.enemy.hp).toBe(GOLEM.maxHp - 50);
    const venting = {
      ...golem(),
      ai: { kind: "golem" as const, vent: 6, venting: 1 },
    };
    const hot = damageEnemy(venting, 100);
    expect(hot.damage).toBe(200);
    expect(hot.enemy.hp).toBe(GOLEM.maxHp - 200);
  });

  it("a player's shot in the world respects the crust too", () => {
    let sim = world([{ x: 0, y: 0 }], [{ kind: "golem", x: 80, y: 0 }]);
    sim = { ...sim, projectiles: [shot({ x: 40, y: 0 }, 60)] };
    const { events } = step(sim, 0.2);
    const hit = events.find((e) => e.type === "hit") as { damage: number };
    expect(hit.damage).toBe(30);
  });

  it("touch for 14, slowly (35 px/s), and walk round lava", () => {
    const e = { ...golem(), attackCooldown: 0 };
    const { actions } = run(e, 1.3, [still(30, 0)]);
    expect(actions.flatMap((a) => a.contacts.map((c) => c.damage))).toEqual([
      GOLEM.contactDamage,
      GOLEM.contactDamage,
    ]);
    const walker = run(golem(), 1, [still(500, 0)]).enemy;
    expect(walker.position.x).toBeCloseTo(GOLEM.speed, 0);
    // Chasing across a pool, it never steps in.
    const lava = [{ x: 100, y: -50, width: 100, height: 100 }];
    let sim: SimState = {
      ...world([{ x: 300, y: 0 }], [{ kind: "golem", x: 0, y: 0 }]),
      lava,
    };
    for (let t = 0; t < ticks(4); t++) {
      sim = stepWorld(sim, [], TICK_SECONDS).state;
      const g = sim.enemies[0]!;
      const half = g.size / 2;
      expect(
        g.position.x + half > 100 &&
          g.position.x - half < 200 &&
          g.position.y + half > -50 &&
          g.position.y - half < 50,
      ).toBe(false);
    }
  });
});

describe("bellows-keepers (D-132)", () => {
  it("never attack, and keep away from players like a shaman", () => {
    const e = {
      ...newEnemy(1, "bellows", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const { enemy, actions } = run(e, 3, [still(20, 0)]);
    for (const a of actions) {
      expect(a.contacts).toEqual([]);
      expect(a.bullets).toEqual([]);
      expect(a.hazards).toEqual([]);
    }
    expect(enemy.position.x).toBeLessThan(-100);
  });

  it("every second heal enemies within 120 px by 3% of max HP: not themselves, each other, or bosses", () => {
    let sim = world(
      [{ x: 4000, y: 0 }],
      [
        { kind: "bellows", x: 0, y: 0 },
        { kind: "golem", x: 60, y: 0 },
        { kind: "bellows", x: 0, y: 60 },
        { kind: "warlord", x: -70, y: 0 },
        { kind: "knight", x: 0, y: -300 },
      ],
    );
    // Everyone hurt by 300.
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({ ...e, hp: e.maxHp - 300 })),
    };
    const { sim: after, events } = step(sim, 1.05);
    const pulses = events.filter(
      (e) => e.type === "blast" && e.kind === "stoke",
    );
    // Each bellows-keeper pulses once a second (the golem is in reach of both).
    expect(pulses.length).toBe(2);
    const hp = (kind: EnemyKind) =>
      after.enemies.filter((e) => e.kind === kind).map((e) => e.maxHp - e.hp);
    // The first pulse from each: 2 × 3% of 1,600 = 96 healed. (The golem then
    // walks off after the far player, out of reach.)
    expect(hp("golem")[0]).toBeCloseTo(
      300 - 2 * BELLOWS.healShare * GOLEM.maxHp,
      6,
    );
    expect(hp("bellows")).toEqual([300, 300]);
    expect(hp("warlord")).toEqual([300]);
    // Out of reach: no heal.
    expect(hp("knight")).toEqual([300]);
  });

  it("never heal past max HP", () => {
    let sim = world(
      [{ x: 4000, y: 0 }],
      [
        { kind: "bellows", x: 0, y: 0 },
        { kind: "golem", x: 60, y: 0 },
      ],
    );
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) =>
        e.kind === "golem" ? { ...e, hp: e.maxHp - 10 } : e,
      ),
    };
    const after = step(sim, 1.05).sim;
    const g = after.enemies.find((e) => e.kind === "golem")!;
    expect(g.hp).toBe(g.maxHp);
  });
});
