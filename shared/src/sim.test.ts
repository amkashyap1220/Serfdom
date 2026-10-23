import { describe, expect, it } from "vitest";
import { DUMMY_ENEMY, PLAYER_WEAPON } from "./combat-config.ts";
import { damageEnemy, stepRespawn, type EnemyState } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  removePlayer,
  stepSim,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const STILL = { x: 0, y: 0 };
const FIRE_RIGHT: PlayerInput = {
  move: STILL,
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};
const IDLE: PlayerInput = { move: STILL, fire: { trigger: false, aim: null } };

/** A sim with one player (id 1) at the origin and enemies at the given spots. */
function solo(enemies: { x: number; y: number }[] = []): SimState {
  return addPlayer(createSimState(enemies), 1, { x: 0, y: 0 });
}

function run(
  state: SimState,
  inputs: ReadonlyMap<number, PlayerInput>,
  ticks: number,
  walls: readonly Rect[] = [],
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepSim(state, inputs, walls, TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const only = (input: PlayerInput) => new Map([[1, input]]);
const count = (events: SimEvent[], type: SimEvent["type"]) =>
  events.filter((e) => e.type === type).length;

describe("enemy damage and respawn", () => {
  const enemy: EnemyState = {
    id: 1,
    position: { x: 0, y: 0 },
    size: 16,
    hp: 30,
    maxHp: 500,
    baseMaxHp: 500,
    scaledFor: 1,
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

describe("players joining and leaving", () => {
  it("adds, finds, resets, and removes players", () => {
    let s = createSimState([]);
    s = addPlayer(s, 1, { x: 0, y: 0 });
    s = addPlayer(s, 2, { x: 50, y: 0 });
    expect(s.players.map((p) => p.id)).toEqual([1, 2]);
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 0 })) };
    s = addPlayer(s, 1, { x: 9, y: 9 }); // "play again": fresh state
    expect(findPlayer(s, 1)).toMatchObject({
      hp: 200,
      position: { x: 9, y: 9 },
    });
    s = removePlayer(s, 2);
    expect(s.players.map((p) => p.id)).toEqual([1]);
  });
});

describe("shooting", () => {
  it("defeats the 500 HP dummy in exactly 20 hits of 25 (solo)", () => {
    const { events } = run(solo([{ x: 100, y: 0 }]), only(FIRE_RIGHT), 60 * 6);
    const firstDefeat = events.findIndex((e) => e.type === "defeated");
    // The "defeated" event follows the hit that caused it.
    const hitsToDefeat = count(events.slice(0, firstDefeat), "hit");
    expect(firstDefeat).toBeGreaterThan(-1);
    expect(hitsToDefeat).toBe(DUMMY_ENEMY.maxHp / PLAYER_WEAPON.damage);
    expect(events[firstDefeat]).toEqual({
      type: "defeated",
      enemyId: 1,
      playerId: 1,
    });
  });

  it("fires at most 4 shots per second", () => {
    const { events } = run(solo(), only(FIRE_RIGHT), 60);
    expect(count(events, "shot")).toBe(PLAYER_WEAPON.shotsPerSecond);
  });

  it("advances a player's cooldown only when that player sends input", () => {
    // 60 world ticks but only 15 inputs: one shot, not four.
    let s = solo();
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      if (t % 4 === 0) {
        const r = applyPlayerInput(s, 1, FIRE_RIGHT, [], TICK_SECONDS);
        s = r.state;
        events.push(...r.events);
      }
      s = stepWorld(s, [], TICK_SECONDS).state;
    }
    expect(count(events, "shot")).toBe(1);
  });

  it("does not fire without trigger or without aim", () => {
    expect(run(solo(), only(IDLE), 60).events).toHaveLength(0);
    const noAim: PlayerInput = {
      move: STILL,
      fire: { trigger: true, aim: null },
    };
    expect(run(solo(), only(noAim), 60).events).toHaveLength(0);
  });

  it("rejects a non-unit aim vector", () => {
    const bad: PlayerInput = {
      move: STILL,
      fire: { trigger: true, aim: { x: 5, y: 0 } },
    };
    expect(() => stepSim(solo(), only(bad), [], TICK_SECONDS)).toThrow(
      RangeError,
    );
  });

  it("ignores input for unknown players", () => {
    const r = applyPlayerInput(solo(), 99, FIRE_RIGHT, [], TICK_SECONDS);
    expect(r.events).toEqual([]);
  });

  it("stops shots at walls", () => {
    const wall = { x: 50, y: -50, width: 10, height: 100 };
    const { events, state } = run(
      solo([{ x: 100, y: 0 }]),
      only(FIRE_RIGHT),
      60,
      [wall],
    );
    expect(count(events, "hit")).toBe(0);
    expect(count(events, "blocked")).toBeGreaterThan(0);
    expect(state.enemies[0]?.hp).toBe(DUMMY_ENEMY.maxHp);
  });

  it("credits each hit to the player who fired it", () => {
    // y = 5 keeps the 4×4 shot inside the dummy box (y −8..8), not grazing its edge.
    let s = addPlayer(solo([{ x: 100, y: 0 }]), 2, { x: 0, y: 5 });
    s = run(s, new Map([[2, FIRE_RIGHT]]), 30).state;
    const { events } = run(s, new Map([[2, FIRE_RIGHT]]), 30);
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.type === "hit" && e.playerId === 2)).toBe(true);
  });
});

describe("party HP scaling (D-045)", () => {
  it("scales the dummy's max HP with living players, keeping the HP fraction", () => {
    let s = solo([{ x: 1000, y: 1000 }]);
    s = stepWorld(s, [], TICK_SECONDS).state;
    expect(s.enemies[0]).toMatchObject({ maxHp: 500, hp: 500 });
    // Damage to half, then a second player joins.
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 250 })) };
    s = addPlayer(s, 2, { x: 0, y: 0 });
    s = stepWorld(s, [], TICK_SECONDS).state;
    expect(s.enemies[0]).toMatchObject({ maxHp: 875, hp: 438, scaledFor: 2 });
    // The second player dies: back to solo scaling, still ~half.
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 2 ? { ...p, hp: 0 } : p)),
    };
    s = stepWorld(s, [], TICK_SECONDS).state;
    expect(s.enemies[0]).toMatchObject({ maxHp: 500, hp: 250, scaledFor: 1 });
  });

  it("treats an empty server as a party of one", () => {
    const s = stepWorld(
      createSimState([{ x: 0, y: 0 }]),
      [],
      TICK_SECONDS,
    ).state;
    expect(s.enemies[0]?.maxHp).toBe(500);
  });
});
