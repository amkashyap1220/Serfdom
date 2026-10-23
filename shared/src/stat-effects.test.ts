import { describe, expect, it } from "vitest";
import { ENEMY_RING_ATTACK, PLAYER_WEAPON } from "./combat-config.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";
import { SERF_BASE, type Stats } from "./stats.ts";

const RIGHT: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};
const FIRE: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};

function playerWith(
  stats: Partial<Stats>,
  enemies: { x: number; y: number }[] = [],
) {
  return addPlayer(
    createSimState(enemies),
    1,
    { x: 0, y: 0 },
    { ...SERF_BASE, ...stats },
  );
}

function inputs(state: SimState, input: PlayerInput, ticks: number) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = applyPlayerInput(state, 1, input, [], TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

function world(state: SimState, ticks: number) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(state, [], TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe("stats change combat (8c-2, D-077, D-078)", () => {
  it("HP sets max HP and starting HP", () => {
    const p = findPlayer(playerWith({ hp: 38 }), 1)!;
    expect([p.hp, p.maxHp]).toEqual([38, 38]);
  });

  it("Speed 30 moves 225 px/s instead of 150", () => {
    const slow = inputs(playerWith({}), RIGHT, 60).state;
    const fast = inputs(playerWith({ speed: 30 }), RIGHT, 60).state;
    expect(findPlayer(slow, 1)!.position.x).toBeCloseTo(150, 6);
    expect(findPlayer(fast, 1)!.position.x).toBeCloseTo(225, 6);
  });

  it("Dexterity 30 fires 6 shots/s instead of 4", () => {
    const shots = (dexterity: number) =>
      inputs(playerWith({ dexterity }), FIRE, 60).events.filter(
        (e) => e.type === "shot",
      ).length;
    expect(shots(10)).toBe(4);
    expect(shots(30)).toBe(6);
  });

  it("Attack 30 shots carry 50 damage instead of 25", () => {
    const shot = (attack: number) =>
      inputs(playerWith({ attack }), FIRE, 1).state.projectiles[0]!.damage;
    expect(shot(10)).toBe(PLAYER_WEAPON.damage);
    expect(shot(30)).toBe(50);
  });

  it("Defense 30 takes a quarter of each hit, and the event says so", () => {
    const hitOf = (defense: number) => {
      const { events } = world(playerWith({ defense }, [{ x: 100, y: 0 }]), 60);
      return events.find((e) => e.type === "playerHit");
    };
    expect(hitOf(0)).toMatchObject({ damage: ENEMY_RING_ATTACK.damage });
    expect(hitOf(30)).toMatchObject({ damage: ENEMY_RING_ATTACK.damage / 4 });
  });

  it("Vitality 30 regenerates 1.5 HP/s", () => {
    let s = playerWith({ vitality: 30 });
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 5 })) };
    expect(findPlayer(world(s, 60).state, 1)!.hp).toBeCloseTo(6.5, 6);
  });
});
