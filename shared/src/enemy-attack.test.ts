import { describe, expect, it } from "vitest";
import { ENEMY_RING_ATTACK, PLAYER_HEALTH } from "./combat-config.ts";
import { ringDirections } from "./enemy.ts";
import { applyDamage } from "./health.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  createSimState,
  stepSim,
  type SimEvent,
  type SimState,
  type TickInput,
} from "./sim.ts";

const IDLE: TickInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: false, aim: null },
};

function run(
  state: SimState,
  ticks: number,
  input: TickInput = IDLE,
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepSim(state, input, [], TICK_SECONDS);
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

describe("ringDirections", () => {
  it("gives 8 evenly spaced unit vectors starting east", () => {
    const dirs = ringDirections(8);
    expect(dirs).toHaveLength(8);
    expect(dirs[0]).toEqual({ x: 1, y: 0 });
    for (const [i, d] of dirs.entries()) {
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
      expect(Math.atan2(d.y, d.x)).toBeCloseTo(
        Math.atan2(Math.sin((i * Math.PI) / 4), Math.cos((i * Math.PI) / 4)),
        12,
      );
    }
  });

  it("rejects a non-positive or fractional count", () => {
    expect(() => ringDirections(0)).toThrow(RangeError);
    expect(() => ringDirections(2.5)).toThrow(RangeError);
  });
});

describe("enemy ring attack", () => {
  it("does not attack while the player is out of aggro range", () => {
    const s = createSimState({ x: 0, y: 0 }, [{ x: 301, y: 0 }]);
    expect(count(run(s, 300).events, "enemyAttack")).toBe(0);
  });

  it("fires a ring of 8 at once when the player is in range, then every 2 s", () => {
    const s = createSimState({ x: 0, y: 0 }, [{ x: 300, y: 0 }]);
    const first = stepSim(s, IDLE, [], TICK_SECONDS);
    expect(first.events).toContainEqual({
      type: "enemyAttack",
      enemyId: 1,
      bullets: ENEMY_RING_ATTACK.bullets,
    });
    expect(
      first.state.projectiles.filter((p) => p.owner === "enemy"),
    ).toHaveLength(8);
    // 2 s = 120 ticks: rings on ticks 0 and 120.
    expect(count(run(s, 120).events, "enemyAttack")).toBe(1);
    expect(count(run(s, 121).events, "enemyAttack")).toBe(2);
  });

  it("hits the player for 20 per bullet", () => {
    // Enemy 100 px east: the west-pointing bullet travels straight at the player.
    const s = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const { state, events } = run(s, 60);
    expect(count(events, "playerHit")).toBe(1);
    expect(state.player.hp).toBe(
      PLAYER_HEALTH.maxHp - ENEMY_RING_ATTACK.damage,
    );
  });

  it("is stopped by walls", () => {
    const s = createSimState({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const wall = { x: 40, y: -50, width: 10, height: 100 };
    let state = s;
    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const r = stepSim(state, IDLE, [wall], TICK_SECONDS);
      state = r.state;
      events.push(...r.events);
    }
    expect(count(events, "playerHit")).toBe(0);
    expect(state.player.hp).toBe(PLAYER_HEALTH.maxHp);
  });
});

describe("player hurtbox is 15×15, smaller than the 16×16 sprite (D-038)", () => {
  // An enemy bullet (6×6, half 3) flying west along y = offset toward a
  // player at the origin. It hits if |offset| < 7.5 (hurtbox half) + 3.
  function hitAtOffset(offset: number): boolean {
    const s = createSimState({ x: 0, y: 0 }, []);
    const withBullet: SimState = {
      ...s,
      projectiles: [
        {
          id: 99,
          owner: "enemy",
          position: { x: 60, y: offset },
          direction: { x: -1, y: 0 },
          speed: ENEMY_RING_ATTACK.speed,
          remaining: 200,
          damage: 20,
          size: ENEMY_RING_ATTACK.size,
        },
      ],
    };
    return count(run(withBullet, 90).events, "playerHit") > 0;
  }

  it("hits just inside the 15×15 edge", () => {
    expect(hitAtOffset(10.4)).toBe(true);
  });

  it("misses at 10.6 px, which a full 16×16 box (edge 11.0) would still hit", () => {
    expect(hitAtOffset(10.6)).toBe(false);
  });
});

describe("prototype player death and respawn", () => {
  // Enemy right next to the player: every ring lands its west bullet.
  const close = () => createSimState({ x: 0, y: 0 }, [{ x: 40, y: 0 }]);
  const RING_TICKS = 120;

  it("dies after 10 hits of 20 (200 HP)", () => {
    const { events, state } = run(close(), RING_TICKS * 9 + 30);
    expect(count(events, "playerHit")).toBe(10);
    expect(count(events, "playerDied")).toBe(1);
    expect(state.player.hp).toBe(0);
  });

  it("cannot move or shoot while dead", () => {
    const dead = run(close(), RING_TICKS * 9 + 30).state;
    const input: TickInput = {
      move: { x: 1, y: 0 },
      fire: { trigger: true, aim: { x: 1, y: 0 } },
    };
    const r = run(dead, 30, input);
    expect(r.state.player.position).toEqual(dead.player.position);
    expect(count(r.events, "shot")).toBe(0);
    expect(count(r.events, "enemyAttack")).toBe(0);
  });

  it("respawns after 2 s at spawn with full HP, clearing bullets and resetting enemies", () => {
    const start = createSimState({ x: 0, y: 0 }, [{ x: 40, y: 0 }]);
    const moved: SimState = {
      ...start,
      player: { ...start.player, position: { x: 5, y: 5 } },
      enemies: start.enemies.map((e) => ({ ...e, hp: 100 })),
    };
    // Step until the exact tick the player dies.
    let dead = moved;
    for (let i = 0; i < RING_TICKS * 12; i++) {
      const r = stepSim(dead, IDLE, [], TICK_SECONDS);
      dead = r.state;
      if (r.events.some((e) => e.type === "playerDied")) break;
    }
    expect(dead.player.hp).toBe(0);
    expect(dead.player.respawnIn).toBe(PLAYER_HEALTH.respawnSeconds);
    // One tick short of 2 s: still dead.
    expect(run(dead, 119).state.player.hp).toBe(0);
    const { state, events } = run(dead, 120);
    expect(count(events, "playerRespawned")).toBe(1);
    expect(state.player.hp).toBe(PLAYER_HEALTH.maxHp);
    expect(state.player.position).toEqual({ x: 0, y: 0 });
    expect(state.enemies[0]?.hp).toBe(state.enemies[0]?.maxHp);
    expect(state.enemies[0]?.attackCooldown).toBe(0);
    expect(state.projectiles).toEqual([]);
  });
});
