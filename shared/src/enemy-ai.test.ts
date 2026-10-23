import { describe, expect, it } from "vitest";
import { enemyAct, type AiTarget } from "./enemy-ai.ts";
import { PLAYER_HEALTH } from "./combat-config.ts";
import { GRUNT, SLINGER } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  createSimState,
  findPlayer,
  spawnEnemies,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const grunt = (x: number, y: number): EnemyState => ({
  ...newEnemy(1, "grunt", { x, y }, "r", null),
  attackCooldown: 0,
});
const slinger = (x: number, y: number): EnemyState => ({
  ...newEnemy(1, "slinger", { x, y }, "r", null),
  attackCooldown: 0,
});
const player = (id: number, x: number, y: number): AiTarget => ({
  id,
  position: { x, y },
});

/** Runs one enemy alone for `ticks` ticks against fixed targets. */
function act(
  enemy: EnemyState,
  targets: AiTarget[],
  ticks: number,
  walls: Rect[] = [],
) {
  let e = enemy;
  const contacts: number[] = [];
  let bullets = 0;
  for (let i = 0; i < ticks; i++) {
    const a = enemyAct(e, targets, walls, TICK_SECONDS);
    e = a.enemy;
    if (a.contacts.length > 0) contacts.push(i);
    bullets += a.bullets.length;
  }
  return { enemy: e, contacts, bullets };
}

describe("grunt", () => {
  it("walks straight at the nearest player at its speed", () => {
    const { enemy } = act(
      grunt(0, 0),
      [player(1, 300, 0), player(2, -400, 0)],
      60,
    );
    expect(enemy.position.x).toBeCloseTo(GRUNT.speed, 6);
    expect(enemy.position.y).toBeCloseTo(0, 9);
  });

  it("walks round a wall in its way, never through it (D-112)", () => {
    const wall = { x: 20, y: -50, width: 10, height: 100 };
    let e = grunt(0, 0);
    for (let i = 0; i < 60 * 6; i++) {
      e = enemyAct(e, [player(1, 300, 0)], [wall], TICK_SECONDS).enemy;
      const half = GRUNT.size / 2;
      const inside =
        e.position.x + half > wall.x &&
        e.position.x - half < wall.x + wall.width &&
        e.position.y + half > wall.y &&
        e.position.y - half < wall.y + wall.height;
      expect(inside).toBe(false);
    }
    // Round the end of the wall and on to the player.
    expect(e.position.x).toBeGreaterThan(250);
  });

  it("a wall it cannot get round still stops it", () => {
    // Walls all round: steering finds no way, the body stops at the wall.
    const box = [
      { x: 20, y: -500, width: 10, height: 1000 },
      { x: -500, y: -500, width: 1000, height: 10 },
      { x: -500, y: 490, width: 1000, height: 10 },
      { x: -500, y: -500, width: 10, height: 1000 },
    ];
    const { enemy } = act(grunt(0, 0), [player(1, 300, 0)], 60 * 3, box);
    expect(enemy.position.x).toBeLessThanOrEqual(20 - GRUNT.size / 2 + 1e-6);
  });

  it("hits on contact, at most once per cooldown", () => {
    // Standing on the player for 2 s: a hit at once, then one per cooldown.
    const { contacts } = act(grunt(0, 0), [player(1, 0, 0)], 120);
    const every = Math.round(GRUNT.contactCooldownSeconds / TICK_SECONDS);
    expect(contacts.length).toBe(Math.floor(119 / every) + 1);
    expect(contacts[1]! - contacts[0]!).toBe(
      Math.round(GRUNT.contactCooldownSeconds / TICK_SECONDS),
    );
  });

  it("does nothing without a living target", () => {
    const g = grunt(5, 5);
    expect(act(g, [], 30).enemy.position).toEqual({ x: 5, y: 5 });
  });
});

describe("slinger", () => {
  it("backs away from a close player and approaches a far one", () => {
    const near = act(slinger(100, 0), [player(1, 0, 0)], 30).enemy;
    expect(near.position.x).toBeGreaterThan(100);
    const far = act(slinger(400, 0), [player(1, 0, 0)], 30).enemy;
    expect(far.position.x).toBeLessThan(400);
  });

  it("holds still inside its preferred distance band", () => {
    const mid = (SLINGER.minRange + SLINGER.maxRange) / 2;
    expect(act(slinger(mid, 0), [player(1, 0, 0)], 30).enemy.position).toEqual({
      x: mid,
      y: 0,
    });
  });

  it("throws aimed rocks at the interval, only within throw range", () => {
    const inRange = act(slinger(200, 0), [player(1, 0, 0)], 200);
    // 200 ticks = 3.33 s: a rock at once, then one per throw interval.
    const every = Math.round(SLINGER.throwIntervalSeconds / TICK_SECONDS);
    expect(inRange.bullets).toBe(Math.floor(199 / every) + 1);
    const a = enemyAct(slinger(200, 0), [player(1, 0, 0)], [], TICK_SECONDS);
    expect(a.bullets[0]?.direction.x).toBeCloseTo(-1, 9);
    expect(a.bullets[0]?.spec).toEqual(SLINGER.rock);
    // Too far: walks closer instead of throwing.
    const tooFar = enemyAct(
      slinger(SLINGER.throwRange + 50, 0),
      [player(1, 0, 0)],
      [],
      TICK_SECONDS,
    );
    expect(tooFar.bullets).toEqual([]);
  });
});

describe("enemies in the world tick", () => {
  function world(): SimState {
    let s = createSimState([], { respawnSeconds: null });
    s = addPlayer(s, 1, { x: 0, y: 0 });
    return s;
  }
  function run(s: SimState, ticks: number) {
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      const r = stepWorld(s, [], TICK_SECONDS);
      s = r.state;
      events.push(...r.events);
    }
    return { s, events };
  }

  it("a grunt's contact hit damages the player and names the grunt", () => {
    const s = spawnEnemies(world(), [
      { kind: "grunt", at: { x: 30, y: 0 }, roomId: "r" },
    ]);
    const { s: after, events } = run(s, 60);
    const hits = events.filter((e) => e.type === "playerHit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ enemyId: 1, damage: GRUNT.contactDamage });
    // Down by the hits, partly regenerated since.
    expect(findPlayer(after, 1)!.hp).toBeLessThan(PLAYER_HEALTH.maxHp);
  });

  it("a slinger's rock travels and hits the player", () => {
    const s = spawnEnemies(world(), [
      { kind: "slinger", at: { x: 200, y: 0 }, roomId: "r" },
    ]);
    // Its first throw waits half an interval; the rock flies 200 px in 1 s.
    const { events } = run(s, 60 * 3);
    expect(events.some((e) => e.type === "enemyAttack")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "playerHit" && e.damage === SLINGER.rock.damage,
      ),
    ).toBe(true);
  });

  it("removes dungeon enemies once defeated (they never respawn)", () => {
    let s = spawnEnemies(world(), [
      { kind: "grunt", at: { x: 500, y: 0 }, roomId: "r" },
    ]);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0 })) };
    expect(run(s, 1).s.enemies).toEqual([]);
  });

  it("gives spawned enemies fresh ids and a short delay before their first attack", () => {
    const s = spawnEnemies(world(), [
      { kind: "grunt", at: { x: 0, y: 0 }, roomId: "r" },
      { kind: "slinger", at: { x: 200, y: 0 }, roomId: "r" },
    ]);
    expect(s.enemies.map((e) => e.id)).toEqual([1, 2]);
    expect(s.nextEnemyId).toBe(3);
    // Standing on the player, the grunt still waits before its first hit.
    const first = run(s, 1).events.filter((e) => e.type === "playerHit");
    expect(first).toEqual([]);
  });
});
