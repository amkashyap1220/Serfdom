import { describe, expect, it } from "vitest";
import { enemyAct, type AiTarget } from "./enemy-ai.ts";
import { BOMBER, GRUNT, SHAMAN, SKULKER } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
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

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const ready = (e: EnemyState): EnemyState => ({ ...e, attackCooldown: 0 });

describe("goblin skulker (D-115)", () => {
  it("runs to where a moving player is heading, not behind them like a grunt", () => {
    // The player runs east along y = 0; both goblins start to the north.
    const run = (kind: "skulker" | "grunt") => {
      let e = newEnemy(1, kind, { x: 0, y: -200 }, null, null);
      for (let t = 0; t < ticks(1); t++) {
        const target: AiTarget = {
          id: 1,
          position: { x: 150 * t * TICK_SECONDS, y: 0 },
          velocity: { x: 150, y: 0 },
        };
        e = enemyAct(e, [target], [], TICK_SECONDS).enemy;
      }
      return e.position.x;
    };
    // After 1 s the player is at x = 150; the skulker is ahead of the grunt.
    expect(run("skulker")).toBeGreaterThan(run("grunt") + 20);
  });

  it("lunges once close and hits like a grunt, once per 1.2 s", () => {
    let e = ready(newEnemy(1, "skulker", { x: 40, y: 0 }, null, null));
    const hits: number[] = [];
    for (let t = 0; t < ticks(2); t++) {
      const a = enemyAct(
        e,
        [{ id: 1, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }],
        [],
        TICK_SECONDS,
      );
      e = a.enemy;
      for (const c of a.contacts) hits.push(c.damage);
    }
    expect(hits).toEqual([SKULKER.contactDamage, SKULKER.contactDamage]);
    expect(SKULKER.speed).toBeGreaterThan(GRUNT.speed);
  });
});

describe("goblin bomber (D-115)", () => {
  const withBomber = (at = { x: 240, y: 0 }) => {
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 0 },
    );
    sim = spawnEnemies(sim, [{ kind: "bomber", at, roomId: null }]);
    return {
      ...sim,
      enemies: sim.enemies.map(ready),
      players: sim.players.map((p) => ({ ...p, hp: 1000, maxHp: 1000 })),
    };
  };

  it("lobs a bomb that lands after 0.9 s (4 damage within 40 px) and burns 2 every 0.5 s for 3 s", () => {
    let sim: SimState = withBomber();
    const hits: { t: number; damage: number; by: number }[] = [];
    for (let t = 0; t < ticks(4.5); t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      // Keep the bomber from throwing again, to watch one bomb.
      sim = {
        ...sim,
        enemies: sim.enemies.map((e) => ({ ...e, attackCooldown: 99 })),
      };
      for (const e of r.events as SimEvent[]) {
        if (e.type === "playerHit")
          hits.push({ t, damage: e.damage, by: e.enemyId });
      }
    }
    expect(hits[0]).toMatchObject({ damage: BOMBER.damage, by: 1 });
    expect(hits[0]!.t).toBe(ticks(BOMBER.flightSeconds));
    const burns = hits.slice(1);
    expect(burns.map((h) => h.damage)).toEqual(
      Array(6).fill(BOMBER.fire.damage),
    );
    // The fire is out after 3 s.
    expect(sim.fires).toEqual([]);
  });

  it("keeps its distance: backs off when you come close", () => {
    let sim: SimState = withBomber({ x: 100, y: 0 });
    for (let t = 0; t < ticks(1); t++)
      sim = stepWorld(sim, [], TICK_SECONDS).state;
    expect(sim.enemies[0]!.position.x).toBeGreaterThan(100);
  });
});

describe("goblin shaman (D-115)", () => {
  const scene = () => {
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 0 },
    );
    sim = spawnEnemies(sim, [
      { kind: "shaman", at: { x: 400, y: 0 }, roomId: null },
      { kind: "grunt", at: { x: 430, y: 40 }, roomId: null },
      { kind: "shaman", at: { x: 440, y: -40 }, roomId: null },
      { kind: "grunt", at: { x: 900, y: 0 }, roomId: null },
    ]);
    return {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1000, maxHp: 1000 })),
    };
  };

  it("never attacks; chants every 4 s, strengthening goblins within 120 px (not other shamans) for 5 s", () => {
    let sim: SimState = scene();
    let chants = 0;
    const attacks: SimEvent[] = [];
    for (let t = 0; t < ticks(SHAMAN.chantIntervalSeconds / 2) + 2; t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      chants += r.events.filter(
        (e) => e.type === "blast" && e.kind === "chant",
      ).length;
      attacks.push(...r.events.filter((e) => e.type === "playerHit"));
    }
    expect(chants).toBeGreaterThan(0);
    expect(attacks).toEqual([]);
    const [shaman, near, other, far] = sim.enemies;
    expect(near!.chant).toBeGreaterThan(0);
    expect(shaman!.chant ?? 0).toBe(0);
    expect(other!.chant ?? 0).toBe(0);
    expect(far!.chant ?? 0).toBe(0);
    // It wears off after 5 s.
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({
        ...e,
        attackCooldown: e.kind === "shaman" ? 99 : e.attackCooldown,
      })),
    };
    for (let t = 0; t < ticks(SHAMAN.chantSeconds) + 1; t++)
      sim = stepWorld(sim, [], TICK_SECONDS).state;
    expect(sim.enemies[1]!.chant ?? 0).toBe(0);
  });

  it("a chanted goblin hits 50% harder", () => {
    let sim: SimState = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      { x: 0, y: 0 },
    );
    sim = spawnEnemies(sim, [
      { kind: "grunt", at: { x: 5, y: 0 }, roomId: null },
    ]);
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => ({ ...ready(e), chant: 3 })),
    };
    const hit = stepWorld(sim, [], TICK_SECONDS).events.find(
      (e) => e.type === "playerHit",
    );
    expect(hit).toMatchObject({
      damage: GRUNT.contactDamage * (1 + SHAMAN.damageBonus),
    });
    expect(findPlayer(sim, 1)).toBeDefined();
  });

  it("keeps 200 px from players: backs away from one close by", () => {
    let e = newEnemy(1, "shaman", { x: 100, y: 0 }, null, null);
    for (let t = 0; t < ticks(1); t++) {
      e = enemyAct(
        e,
        [{ id: 1, position: { x: 0, y: 0 } }],
        [],
        TICK_SECONDS,
      ).enemy;
    }
    expect(e.position.x).toBeGreaterThan(100 + SHAMAN.speed * 0.9);
  });
});
