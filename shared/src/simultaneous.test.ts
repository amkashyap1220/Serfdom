import { describe, expect, it } from "vitest";
import { PLAYER_WEAPON } from "./combat-config.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { scaledMaxHp } from "./party-scaling.ts";
import {
  addPlayer,
  createSimState,
  stepSim,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";

/**
 * Phase 5 acceptance: simultaneous attacks must resolve deterministically.
 *
 * Rule (documented in ARCHITECTURE.md): within a tick, projectiles resolve
 * in projectile-id order, and ids are handed out in the order inputs are
 * applied (on the server: connection order). So when two shots reach the
 * same enemy on the same tick, the lower id lands first; if it is the
 * killing blow, it alone gets the defeat credit and the other shot finds
 * no target and flies on.
 */

const DUMMY = { x: 100, y: 0 };
const fireAt = (aim: { x: number; y: number }): PlayerInput => ({
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim },
});
const norm = (x: number, y: number) => {
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
};

/**
 * Two players the same distance from the dummy (mirror images across its
 * horizontal axis), firing on the same tick, so both shots arrive together.
 */
function mirrored(dummyHp: number): SimState {
  let s = createSimState([DUMMY]);
  s = addPlayer(s, 1, { x: 0, y: -30 });
  s = addPlayer(s, 2, { x: 0, y: 30 });
  return withDummyHp(s, dummyHp);
}

/**
 * Sets the dummy's HP *already scaled* for the current party (D-045), so
 * the first world tick does not rescale it away from the value under test.
 */
function withDummyHp(s: SimState, hp: number): SimState {
  const n = s.players.length;
  return {
    ...s,
    enemies: s.enemies.map((e) => ({
      ...e,
      hp,
      maxHp: scaledMaxHp(e.baseMaxHp, n),
      scaledFor: n,
    })),
  };
}

const inputs = new Map([
  [1, fireAt(norm(DUMMY.x - 0, DUMMY.y + 30))],
  [2, fireAt(norm(DUMMY.x - 0, DUMMY.y - 30))],
]);

/** One firing tick, then idle ticks until the shots resolve. */
function playOut(start: SimState): { state: SimState; events: SimEvent[] } {
  const idle = new Map(
    [1, 2].map((id) => [
      id,
      { move: { x: 0, y: 0 }, fire: { trigger: false, aim: null } },
    ]),
  );
  const events: SimEvent[] = [];
  let state = start;
  for (let t = 0; t < 60; t++) {
    const r = stepSim(state, t === 0 ? inputs : idle, [], TICK_SECONDS);
    state = r.state;
    events.push(...r.events.filter((e) => e.type !== "enemyAttack"));
  }
  return { state, events };
}

describe("simultaneous attacks", () => {
  it("both shots land on the same tick and both deal damage", () => {
    const { events, state } = playOut(mirrored(500));
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.map((h) => h.type === "hit" && h.playerId)).toEqual([1, 2]);
    expect(state.enemies[0]?.hp).toBe(500 - 2 * PLAYER_WEAPON.damage);
  });

  it("a shared killing blow is credited to exactly one player (lower projectile id)", () => {
    const { events, state } = playOut(mirrored(PLAYER_WEAPON.damage));
    const defeats = events.filter((e) => e.type === "defeated");
    expect(defeats).toEqual([{ type: "defeated", enemyId: 1, playerId: 1 }]);
    // Only one hit counted: the second shot found no living target.
    expect(events.filter((e) => e.type === "hit")).toHaveLength(1);
    expect(state.enemies[0]?.hp).toBe(0);
  });

  it("is fully deterministic: the same inputs always give the same result", () => {
    const a = playOut(mirrored(PLAYER_WEAPON.damage));
    const b = playOut(mirrored(PLAYER_WEAPON.damage));
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });

  it("credits follow input order, not player id: player 2 first wins the tie", () => {
    const reversed = new Map([...inputs].reverse());
    let state = mirrored(PLAYER_WEAPON.damage);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      const r = stepSim(
        state,
        t === 0 ? reversed : new Map(),
        [],
        TICK_SECONDS,
      );
      state = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === "defeated")).toEqual([
      { type: "defeated", enemyId: 1, playerId: 2 },
    ]);
  });

  it("never lets HP go below zero or count a defeat twice under a burst", () => {
    // Four players, all hitting a 30 HP dummy at once.
    let s = createSimState([DUMMY]);
    const many = new Map<number, PlayerInput>();
    for (const [id, y] of [
      [1, -30],
      [2, 30],
      [3, -20],
      [4, 20],
    ] as const) {
      s = addPlayer(s, id, { x: 0, y });
      many.set(id, fireAt(norm(DUMMY.x, -y)));
    }
    s = withDummyHp(s, 30);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      const r = stepSim(s, t === 0 ? many : new Map(), [], TICK_SECONDS);
      s = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === "defeated")).toHaveLength(1);
    expect(s.enemies[0]?.hp).toBe(0);
  });
});
