import { describe, expect, it } from "vitest";
import {
  ENEMY_RING_ATTACK,
  PLAYER_HEALTH,
  PLAYER_REGEN,
} from "./combat-config.ts";
import { ringDirections } from "./enemy.ts";
import { applyDamage } from "./health.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { partyHpMultiplier, rescaleHp, scaledMaxHp } from "./party-scaling.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  stepSim,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const IDLE: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: false, aim: null },
};

function withPlayers(
  enemies: { x: number; y: number }[],
  players: [number, { x: number; y: number }][],
): SimState {
  let s = createSimState(enemies);
  for (const [id, at] of players) s = addPlayer(s, id, at);
  return s;
}

function runWorld(
  state: SimState,
  ticks: number,
  walls: { x: number; y: number; width: number; height: number }[] = [],
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(state, walls, TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const count = (events: SimEvent[], type: SimEvent["type"]) =>
  events.filter((e) => e.type === type).length;

describe("applyDamage", () => {
  it("subtracts, floors at 0, and reports the killing blow once", () => {
    expect(applyDamage(30, 20)).toEqual({ hp: 10, died: false });
    expect(applyDamage(10, 20)).toEqual({ hp: 0, died: true });
    expect(applyDamage(0, 20)).toEqual({ hp: 0, died: false });
  });

  it("rejects negative and non-finite damage", () => {
    expect(() => applyDamage(10, -1)).toThrow(RangeError);
    expect(() => applyDamage(10, Infinity)).toThrow(RangeError);
  });
});

describe("party scaling formula (D-045)", () => {
  it("is 1×, 1.75×, 2.5×, 3.25× for 1–4 players", () => {
    expect([1, 2, 3, 4].map(partyHpMultiplier)).toEqual([1, 1.75, 2.5, 3.25]);
    expect(scaledMaxHp(500, 4)).toBe(1625);
  });

  it("treats 0 or fractional party sizes sensibly", () => {
    expect(partyHpMultiplier(0)).toBe(1);
    expect(partyHpMultiplier(2.9)).toBe(1.75);
  });

  it("keeps the HP fraction, never kills or revives by rescaling", () => {
    expect(rescaleHp(250, 500, 875)).toBe(438);
    expect(rescaleHp(1, 1625, 500)).toBe(1);
    expect(rescaleHp(0, 500, 875)).toBe(0);
    expect(rescaleHp(500, 500, 875)).toBe(875);
  });
});

describe("ringDirections", () => {
  it("gives 8 evenly spaced unit vectors starting east", () => {
    const dirs = ringDirections(8);
    expect(dirs).toHaveLength(8);
    expect(dirs[0]).toEqual({ x: 1, y: 0 });
    for (const d of dirs) expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
  });

  it("rejects a non-positive or fractional count", () => {
    expect(() => ringDirections(0)).toThrow(RangeError);
    expect(() => ringDirections(2.5)).toThrow(RangeError);
  });
});

describe("enemy ring attack", () => {
  it("does not attack while every player is out of aggro range", () => {
    const s = withPlayers([{ x: 301, y: 0 }], [[1, { x: 0, y: 0 }]]);
    expect(count(runWorld(s, 300).events, "enemyAttack")).toBe(0);
  });

  it("attacks when any one player is in range", () => {
    const s = withPlayers(
      [{ x: 300, y: 0 }],
      [
        [1, { x: 0, y: 0 }],
        [2, { x: 1000, y: 1000 }],
      ],
    );
    const first = stepWorld(s, [], TICK_SECONDS);
    expect(count(first.events, "enemyAttack")).toBe(1);
    expect(
      first.state.projectiles.filter((p) => p.owner === "enemy"),
    ).toHaveLength(8);
    // Rings on ticks 0 and 120.
    expect(count(runWorld(s, 120).events, "enemyAttack")).toBe(1);
    expect(count(runWorld(s, 121).events, "enemyAttack")).toBe(2);
  });

  it("hits the player in its path for the ring's damage", () => {
    const s = withPlayers([{ x: 100, y: 0 }], [[1, { x: 0, y: 0 }]]);
    const ticks = 60;
    const { state, events } = runWorld(s, ticks);
    const hitAt = events.findIndex((e) => e.type === "playerHit");
    expect(events[hitAt]).toMatchObject({
      type: "playerHit",
      playerId: 1,
      damage: ENEMY_RING_ATTACK.damage,
    });
    // Down by the hit, then regenerating since (D-056).
    const hp = findPlayer(state, 1)!.hp;
    expect(hp).toBeLessThan(PLAYER_HEALTH.maxHp);
    expect(hp).toBeGreaterThan(PLAYER_HEALTH.maxHp - ENEMY_RING_ATTACK.damage);
  });

  it("hits whichever player stands in a bullet's path", () => {
    // Player 2 sits on the west-pointing bullet's line; player 1 does not.
    const s = withPlayers(
      [{ x: 100, y: 0 }],
      [
        [1, { x: 100, y: -150 }],
        [2, { x: 0, y: 0 }],
      ],
    );
    const { state } = runWorld(s, 60);
    expect(findPlayer(state, 2)!.hp).toBeLessThan(PLAYER_HEALTH.maxHp);
    expect(findPlayer(state, 1)?.hp).toBe(PLAYER_HEALTH.maxHp);
  });

  it("is stopped by walls", () => {
    const s = withPlayers([{ x: 100, y: 0 }], [[1, { x: 0, y: 0 }]]);
    const wall = { x: 40, y: -50, width: 10, height: 100 };
    expect(findPlayer(runWorld(s, 60, [wall]).state, 1)?.hp).toBe(
      PLAYER_HEALTH.maxHp,
    );
  });
});

describe("player hurtbox is 15×15, smaller than the 16×16 sprite (D-038)", () => {
  // An enemy bullet (6×6, half 3) flying west along y = offset toward a
  // player at the origin. It hits if |offset| < 7.5 (hurtbox half) + 3.
  function hitAtOffset(offset: number): boolean {
    const s = withPlayers([], [[1, { x: 0, y: 0 }]]);
    const withBullet: SimState = {
      ...s,
      projectiles: [
        {
          id: 99,
          owner: "enemy",
          ownerId: 1,
          position: { x: 60, y: offset },
          direction: { x: -1, y: 0 },
          speed: ENEMY_RING_ATTACK.speed,
          remaining: 200,
          damage: ENEMY_RING_ATTACK.damage,
          size: ENEMY_RING_ATTACK.size,
        },
      ],
    };
    return count(runWorld(withBullet, 90).events, "playerHit") > 0;
  }

  it("hits just inside the 15×15 edge", () => {
    expect(hitAtOffset(10.4)).toBe(true);
  });

  it("misses at 10.6 px, which a full 16×16 box (edge 11.0) would still hit", () => {
    expect(hitAtOffset(10.6)).toBe(false);
  });
});

describe("health regeneration (D-056)", () => {
  it("regenerates the base rate per second, always on, capped at max HP", () => {
    let s = withPlayers([], [[1, { x: 0, y: 0 }]]);
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 10 })) };
    const oneSecond = runWorld(s, 60).state;
    expect(findPlayer(oneSecond, 1)!.hp).toBeCloseTo(
      10 + PLAYER_REGEN.hpPerSecond,
      9,
    );
    // Full from 10 HP after 20 s at 0.5/s, and never above max.
    const long = runWorld(s, 60 * 30).state;
    expect(findPlayer(long, 1)?.hp).toBe(PLAYER_HEALTH.maxHp);
  });

  it("keeps regenerating while under fire", () => {
    // Standing in ring lines: hits keep coming, but HP still rises between them.
    const s = withPlayers([{ x: 100, y: 0 }], [[1, { x: 0, y: 0 }]]);
    const afterHit = runWorld(s, 50).state;
    const later = runWorld(afterHit, 30).state;
    expect(findPlayer(later, 1)!.hp).toBeGreaterThan(
      findPlayer(afterHit, 1)!.hp,
    );
  });

  it("does not bring the dead back", () => {
    let s = withPlayers([], [[1, { x: 0, y: 0 }]]);
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 0 })) };
    expect(findPlayer(runWorld(s, 600).state, 1)?.hp).toBe(0);
  });
});

describe("death (D-046 prototype)", () => {
  // Enemy right next to player 1: every ring lands its west bullet.
  const RING_TICKS = 120;
  const close = () =>
    withPlayers(
      [{ x: 40, y: 0 }],
      [
        [1, { x: 0, y: 0 }],
        // 150 px out at 22.5°: inside aggro range but between two ring lines,
        // so the survivor is never hit.
        [
          2,
          {
            x: 40 + 150 * Math.cos(Math.PI / 8),
            y: 150 * Math.sin(Math.PI / 8),
          },
        ],
      ],
    );

  // Each ring costs 2 HP and regen gives 1 back over its 2 s, so a 20 HP
  // Serf lasts about 19 rings; allow plenty.
  function untilDeath(s: SimState): SimState {
    for (let i = 0; i < RING_TICKS * 40; i++) {
      const r = stepWorld(s, [], TICK_SECONDS);
      s = r.state;
      if (r.events.some((e) => e.type === "playerDied" && e.playerId === 1)) {
        return s;
      }
    }
    throw new Error("player 1 never died");
  }

  it("dies from repeated hits despite regen, and stays dead (no auto respawn)", () => {
    const dead = untilDeath(close());
    expect(findPlayer(dead, 1)?.hp).toBe(0);
    expect(findPlayer(runWorld(dead, 600).state, 1)?.hp).toBe(0);
  });

  it("a dead player cannot move or shoot", () => {
    const dead = untilDeath(close());
    const before = findPlayer(dead, 1)!.position;
    const r = applyPlayerInput(
      dead,
      1,
      { move: { x: 1, y: 0 }, fire: { trigger: true, aim: { x: 1, y: 0 } } },
      [],
      TICK_SECONDS,
    );
    expect(findPlayer(r.state, 1)?.position).toEqual(before);
    expect(r.events).toEqual([]);
  });

  it("survivors keep fighting: the enemy is not reset and still attacks them", () => {
    const dead = untilDeath(close());
    const enemyBefore = dead.enemies[0]!;
    const { events, state } = runWorld(dead, RING_TICKS + 1);
    expect(count(events, "enemyAttack")).toBeGreaterThan(0); // player 2 in range
    // Party went 2 → 1, so max HP rescaled (875 → 500), but the HP
    // *fraction* is unchanged: no reset, no free heal (D-045, D-046).
    const after = state.enemies[0]!;
    expect(after.maxHp).toBe(500);
    expect(after.hp / after.maxHp).toBeCloseTo(
      enemyBefore.hp / enemyBefore.maxHp,
      2,
    );
  });

  it("bullets pass through a dead player's spot", () => {
    const dead = untilDeath(close());
    const { events } = runWorld(dead, 240);
    expect(events.some((e) => e.type === "playerHit" && e.playerId === 1)).toBe(
      false,
    );
  });

  it("stepSim treats one input per player per tick", () => {
    const s = withPlayers([], [[1, { x: 0, y: 0 }]]);
    const r = stepSim(s, new Map([[1, IDLE]]), [], TICK_SECONDS);
    expect(findPlayer(r.state, 1)?.position).toEqual({ x: 0, y: 0 });
  });
});
