import { describe, expect, it } from "vitest";
import { DUMMY_ENEMY, PLAYER_WEAPON } from "./combat-config.ts";
import { damageEnemy, stepRespawn, type EnemyState } from "./enemy.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  createSimState,
  stepSim,
  type SimEvent,
  type SimState,
  type TickInput,
} from "./sim.ts";

const STILL = { x: 0, y: 0 };
const FIRE_RIGHT: TickInput = {
  move: STILL,
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};
const IDLE: TickInput = { move: STILL, fire: { trigger: false, aim: null } };

function run(
  state: SimState,
  input: TickInput,
  ticks: number,
  walls = [],
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepSim(state, input, walls, TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe("enemy damage and respawn", () => {
  const enemy: EnemyState = {
    id: 1,
    position: { x: 0, y: 0 },
    size: 16,
    hp: 30,
    maxHp: 500,
    respawnIn: 0,
    attackCooldown: 0,
  };

  it("reduces HP and reports defeat at zero, never below", () => {
    const a = damageEnemy(enemy, 25, 3);
    expect(a).toEqual({ enemy: { ...enemy, hp: 5 }, defeated: false });
    const b = damageEnemy(a.enemy, 25, 3);
    expect(b.enemy.hp).toBe(0);
    expect(b.defeated).toBe(true);
    expect(b.enemy.respawnIn).toBe(3);
  });

  it("ignores damage to a defeated enemy", () => {
    const dead = { ...enemy, hp: 0, respawnIn: 2 };
    expect(damageEnemy(dead, 25, 3)).toEqual({ enemy: dead, defeated: false });
  });

  it("rejects negative or non-finite damage", () => {
    expect(() => damageEnemy(enemy, -1, 3)).toThrow(RangeError);
    expect(() => damageEnemy(enemy, Number.NaN, 3)).toThrow(RangeError);
  });

  it("respawns at full HP after the timer", () => {
    let e: EnemyState = { ...enemy, hp: 0, respawnIn: 3 };
    let respawned = false;
    for (let i = 0; i < 180 && !respawned; i++) {
      ({ enemy: e, respawned } = stepRespawn(e, 1 / 60));
    }
    expect(respawned).toBe(true);
    expect(e.hp).toBe(500);
  });
});

describe("stepSim", () => {
  it("defeats the 500 HP dummy in exactly 20 hits of 25", () => {
    const start = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const { events, state } = run(start, FIRE_RIGHT, 60 * 6);
    const firstDefeat = events.findIndex((e) => e.type === "defeated");
    // The "defeated" event follows the hit that caused it, so this counts
    // every hit up to and including the defeating one.
    const hitsToDefeat = events
      .slice(0, firstDefeat)
      .filter((e) => e.type === "hit").length;
    expect(firstDefeat).toBeGreaterThan(-1);
    expect(hitsToDefeat).toBe(DUMMY_ENEMY.maxHp / PLAYER_WEAPON.damage);
    expect(hitsToDefeat).toBe(20);
    // 6 s of firing: defeated once (~5 s), then still waiting to respawn.
    expect(state.enemies[0]?.hp).toBe(0);
  });

  it("shots pass through the spot of a defeated dummy", () => {
    const start = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const dead = {
      ...start,
      enemies: start.enemies.map((e) => ({ ...e, hp: 0, respawnIn: 10 })),
    };
    const { events } = run(dead, FIRE_RIGHT, 60);
    expect(events.some((e) => e.type === "hit")).toBe(false);
  });

  it("respawns the dummy and reports it", () => {
    const start = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const dead = {
      ...start,
      enemies: start.enemies.map((e) => ({ ...e, hp: 0, respawnIn: 0.5 })),
    };
    const { events, state } = run(dead, IDLE, 40);
    expect(events).toContainEqual({ type: "respawned", enemyId: 1 });
    expect(state.enemies[0]?.hp).toBe(DUMMY_ENEMY.maxHp);
  });

  it("fires at most 4 shots per second", () => {
    const start = createSimState({ x: 0, y: 0 }, []);
    const { events } = run(start, FIRE_RIGHT, 60);
    expect(events.filter((e) => e.type === "shot")).toHaveLength(
      PLAYER_WEAPON.shotsPerSecond,
    );
  });

  it("does not fire without trigger or without aim", () => {
    const start = createSimState({ x: 0, y: 0 }, []);
    expect(run(start, IDLE, 60).events).toHaveLength(0);
    const noAim: TickInput = {
      move: STILL,
      fire: { trigger: true, aim: null },
    };
    expect(run(start, noAim, 60).events).toHaveLength(0);
  });

  it("rejects a non-unit aim vector", () => {
    const start = createSimState({ x: 0, y: 0 }, []);
    const bad: TickInput = {
      move: STILL,
      fire: { trigger: true, aim: { x: 5, y: 0 } },
    };
    expect(() => stepSim(start, bad, [], TICK_SECONDS)).toThrow(RangeError);
  });

  it("stops shots at walls and reports them blocked", () => {
    const start = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const wall = { x: 50, y: -50, width: 10, height: 100 };
    const events: SimEvent[] = [];
    let state = start;
    for (let i = 0; i < 60; i++) {
      const r = stepSim(state, FIRE_RIGHT, [wall], TICK_SECONDS);
      state = r.state;
      events.push(...r.events);
    }
    expect(events.some((e) => e.type === "hit")).toBe(false);
    expect(events.some((e) => e.type === "blocked")).toBe(true);
    expect(state.enemies[0]?.hp).toBe(DUMMY_ENEMY.maxHp);
  });
});
