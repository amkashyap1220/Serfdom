import { describe, expect, it } from "vitest";
import {
  enemyAct,
  isTelegraphing,
  shieldBlocks,
  slamCentre,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { GHOST, KNIGHT, NECROMANCER } from "./enemy-config.ts";
import {
  damageEnemy,
  isFaded,
  isHittable,
  isPile,
  newEnemy,
  type EnemyState,
} from "./enemy.ts";
import type { Rect } from "./geometry.ts";
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
const still = (x: number, y: number): AiTarget => ({
  id: 1,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});

function run(
  enemy: EnemyState,
  seconds: number,
  targets: (t: number) => AiTarget[],
  walls: readonly Rect[] = [],
): { enemy: EnemyState; actions: EnemyAction[] } {
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets(t), walls, TICK_SECONDS);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

/** A world with player 1 at (0, 0) (tough enough to watch) and these enemies. */
function world(
  enemies: {
    kind: "ghost" | "necromancer" | "knight" | "skeleton";
    x: number;
    y: number;
  }[],
): SimState {
  let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
    x: 0,
    y: 0,
  });
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

/** A player shot at `from`, flying `direction`. */
const shot = (
  from: { x: number; y: number },
  direction: { x: number; y: number },
): Projectile => ({
  id: 99,
  owner: "player",
  ownerId: 1,
  position: from,
  direction,
  speed: 600,
  remaining: 600,
  damage: 30,
  size: 6,
});

describe("ghosts (D-122)", () => {
  it("float straight through walls at you", () => {
    const wall = { x: 50, y: -100, width: 20, height: 200 };
    const ghost = newEnemy(1, "ghost", { x: 0, y: 0 }, null, null);
    const { enemy } = run(ghost, 2, () => [still(300, 0)], [wall]);
    expect(enemy.position.x).toBeCloseTo(GHOST.speed * 2, 0);
  });

  it("fade out for 1.5 s every 3 s, and touch you for 10 only while visible", () => {
    const ghost = {
      ...newEnemy(1, "ghost", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const { actions } = run(ghost, 4.5, () => [still(5, 0)]);
    const faded = actions.map((a) => isFaded(a.enemy));
    const fadesAt = faded.indexOf(true);
    expect(fadesAt).toBe(ticks(GHOST.visibleSeconds) - 1);
    expect(faded.lastIndexOf(true)).toBe(
      fadesAt + ticks(GHOST.fadedSeconds) - 1,
    );
    const hitTicks = actions
      .map((a, i) => (a.contacts.length > 0 ? i : -1))
      .filter((i) => i >= 0);
    expect(hitTicks.every((i) => !faded[i])).toBe(true);
    expect(
      actions.flatMap((a) => a.contacts).every((c) => c.damage === 10),
    ).toBe(true);
  });

  it("faded, shots pass through and auto-aim skips it", () => {
    let sim = world([{ kind: "ghost", x: 200, y: 0 }]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({
        ...e,
        ai: { kind: "ghost", faded: true, timer: 99 },
      })),
      projectiles: [shot({ x: 150, y: 0 }, { x: 1, y: 0 })],
    };
    expect(isHittable(sim.enemies[0]!)).toBe(false);
    expect(aimTargets(sim)).toEqual([]);
    const events: SimEvent[] = [];
    for (let t = 0; t < ticks(0.3); t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      events.push(...r.events);
    }
    expect(events.some((e) => e.type === "hit")).toBe(false);
    expect(sim.enemies[0]!.hp).toBe(GHOST.maxHp);
  });
});

describe("necromancers (D-122)", () => {
  it("raise the nearest bone pile within 250 px as a whole skeleton whose next death is final", () => {
    let sim = world([
      { kind: "necromancer", x: 300, y: 0 },
      { kind: "skeleton", x: 400, y: 0 },
      { kind: "skeleton", x: 900, y: 0 },
    ]);
    // Both skeletons fall into piles; only the near one is in reach.
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) =>
        e.kind === "skeleton"
          ? damageEnemy(e, 999).enemy
          : { ...e, ai: { kind: "necromancer", raise: 0 } },
      ),
    };
    const [near, far] = sim.enemies.filter((e) => e.kind === "skeleton");
    const r = stepWorld(sim, [], TICK_SECONDS);
    const raised = r.state.enemies.find((e) => e.id === near!.id)!;
    expect(isPile(raised)).toBe(false);
    expect(raised.hp).toBe(raised.maxHp);
    expect(raised.ai).toMatchObject({ kind: "skeleton", revived: true });
    expect(isPile(r.state.enemies.find((e) => e.id === far!.id)!)).toBe(true);
    expect(
      r.events.filter((e) => e.type === "blast" && e.kind === "raise"),
    ).toHaveLength(1);
    // The raised one dies for good next time.
    expect(damageEnemy(raised, 999).defeated).toBe(true);
    // And the necromancer waits 6 s before the next raise.
    const necro = r.state.enemies.find((e) => e.kind === "necromancer")!;
    expect(necro.ai).toEqual({
      kind: "necromancer",
      raise: NECROMANCER.raiseIntervalSeconds,
    });
  });

  it("throw 3 slow skulls, 9 each, 15° apart, every 3 s", () => {
    const necro = {
      ...newEnemy(1, "necromancer", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const { actions } = run(necro, 6.1, () => [still(230, 0)]);
    const throws = actions.filter((a) => a.bullets.length > 0);
    expect(throws).toHaveLength(3);
    for (const a of throws) {
      expect(a.bullets.map((b) => b.spec.damage)).toEqual([9, 9, 9]);
      expect(a.bullets[0]!.spec.speed).toBe(150);
    }
  });
});

describe("grave knights (D-122)", () => {
  const knight = (facing = { x: -1, y: 0 }) => {
    const e = newEnemy(1, "knight", { x: 0, y: 0 }, null, null);
    if (e.ai.kind !== "knight") throw new Error("not a knight");
    return { ...e, ai: { ...e.ai, facing, slam: 99 } };
  };

  it("turn toward you at only 120°/s", () => {
    // Facing west, the player straight east: half a turn takes 1.5 s.
    const after = (s: number) =>
      run(knight(), s, () => [still(300, 0)]).enemy.ai;
    const half = after(0.5);
    if (half.kind !== "knight") throw new Error("not a knight");
    expect((Math.acos(-half.facing.x) * 180) / Math.PI).toBeCloseTo(60, 0);
    const done = after(1.6);
    if (done.kind !== "knight") throw new Error("not a knight");
    expect(done.facing.x).toBeCloseTo(1, 3);
  });

  it("the shield stops shots at its front 120° and nothing else", () => {
    const k = knight();
    // Facing west: a shot flying east hits its front.
    expect(shieldBlocks(k, { x: 1, y: 0 })).toBe(true);
    expect(shieldBlocks(k, { x: 1, y: 1.6 })).toBe(true); // ~58° off the front
    expect(shieldBlocks(k, { x: 1, y: 1.9 })).toBe(false); // ~62°, round the edge
    expect(shieldBlocks(k, { x: -1, y: 0 })).toBe(false); // from behind
    let sim = world([{ kind: "knight", x: 200, y: 0 }]);
    const id = sim.enemies[0]!.id;
    const fire = (
      from: { x: number; y: number },
      dir: { x: number; y: number },
    ) => {
      let s: SimState = {
        ...sim,
        enemies: sim.enemies.map((e) =>
          e.ai.kind === "knight"
            ? { ...e, ai: { ...e.ai, facing: { x: -1, y: 0 }, slam: 99 } }
            : e,
        ),
        projectiles: [shot(from, dir)],
      };
      const events: SimEvent[] = [];
      for (let t = 0; t < ticks(0.2); t++) {
        const r = stepWorld(s, [], TICK_SECONDS);
        s = r.state;
        events.push(...r.events);
      }
      return { hp: s.enemies.find((e) => e.id === id)!.hp, events };
    };
    const front = fire({ x: 150, y: 0 }, { x: 1, y: 0 });
    expect(front.hp).toBe(KNIGHT.maxHp);
    expect(
      front.events.some((e) => e.type === "blast" && e.kind === "shieldBlock"),
    ).toBe(true);
    const back = fire({ x: 250, y: 0 }, { x: -1, y: 0 });
    expect(back.hp).toBe(KNIGHT.maxHp - 30);
    sim = world([]);
  });

  it("slams after a 0.9 s warning, for 18, exactly where the warning was, then waits 3 s", () => {
    const k = {
      ...knight({ x: 1, y: 0 }),
      ai: { ...knight({ x: 1, y: 0 }).ai, slam: 0 },
    };
    const { actions } = run(k, 4.5, () => [still(40, 0)]);
    const warning = actions[0]!;
    expect(isTelegraphing(warning.enemy)).toBe(true);
    expect(warning.slam?.warning).toBe(true);
    const hits = actions
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.slam && !a.slam.warning);
    expect(hits[0]!.i).toBe(ticks(KNIGHT.slam.windupSeconds));
    expect(hits[0]!.a.slam!.at).toEqual(warning.slam!.at);
    expect(hits[0]!.a.slam!.at).toEqual(
      slamCentre({ x: 0, y: 0 }, { x: 1, y: 0 }),
    );
    expect(hits[0]!.a.contacts).toEqual([{ playerId: 1, damage: 18 }]);
    // The next warning comes no sooner than 3 s after the hit.
    const next = actions.findIndex((a, i) => i > hits[0]!.i && a.slam?.warning);
    expect(next - hits[0]!.i).toBeGreaterThanOrEqual(
      ticks(KNIGHT.slam.cooldownSeconds) - 1,
    );
  });
});
