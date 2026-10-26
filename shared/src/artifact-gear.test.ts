import { describe, expect, it } from "vitest";
import { GEAR_ARTIFACT } from "./artifact-effects.ts";
import type { ArtifactId } from "./artifacts.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import type { Projectile } from "./projectile.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  spawnEnemies,
  stepWorld,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type SimState,
} from "./sim.ts";
import { SERF_BASE } from "./stats.ts";

const STILL: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: false, aim: null },
};

/** A player at (0, 0), 100 HP, wearing these Artifacts. */
function world(
  artifacts: ArtifactId[],
  extra: Partial<PlayerState> = {},
): SimState {
  const sim = addPlayer(
    createSimState([], { respawnSeconds: null }),
    1,
    { x: 0, y: 0 },
    // No regeneration, so HP numbers are exact.
    { ...SERF_BASE, hp: 100, defense: 0, vitality: 0 },
    null,
    null,
    null,
    artifacts,
  );
  return {
    ...sim,
    players: sim.players.map((p) => ({ ...p, ...extra })),
  };
}

const me = (sim: SimState) => sim.players[0]!;

/** An enemy bullet from the east, at this height, of this damage. */
function bullet(sim: SimState, damage: number, y = 0): SimState {
  const shot: Projectile = {
    id: sim.nextProjectileId,
    owner: "enemy",
    ownerId: 999,
    position: { x: 60, y },
    direction: { x: -1, y: 0 },
    speed: 600,
    remaining: 120,
    damage,
    size: 8,
  };
  return {
    ...sim,
    projectiles: [...sim.projectiles, shot],
    nextProjectileId: sim.nextProjectileId + 1,
  };
}

function run(sim: SimState, seconds: number) {
  const events: SimEvent[] = [];
  for (let t = 0; t < Math.round(seconds / TICK_SECONDS); t++) {
    const r = stepWorld(sim, [], TICK_SECONDS);
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

describe("gear Artifacts (16c, D-153)", () => {
  it("the Mantle: casting the ability blocks the next 2 enemy projectiles within 2 s", () => {
    let sim = world(["mantle"]);
    sim = {
      ...sim,
      players: sim.players.map((p) => ({
        ...p,
        ability: { kind: "arcaneBlast", tier: 1 },
        mp: 100,
      })),
    };
    sim = applyPlayerInput(
      sim,
      1,
      { ...STILL, ability: { x: 50, y: 0 } },
      [],
      TICK_SECONDS,
    ).state;
    for (let n = 0; n < 2; n++) sim = run(bullet(sim, 10), 0.2).sim;
    expect(me(sim).hp).toBe(100);
    sim = run(bullet(sim, 10), 0.2).sim;
    expect(me(sim).hp).toBeLessThan(100);
  });

  it("the Hide: a near miss gives speed and a stronger next attack, once every 4 s", () => {
    const sim = run(bullet(world(["hide"]), 10, 30), 0.3).sim;
    expect(me(sim).hp).toBe(100);
    expect(me(sim).hideBoost).toBeGreaterThan(0);
    expect(me(sim).hideStrike).toBe(true);
    // Faster: 30% more ground in one step than without the boost.
    const step = (s: SimState) =>
      applyPlayerInput(
        s,
        1,
        { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } },
        [],
        TICK_SECONDS,
      ).state.players[0]!.position.x - me(s).position.x;
    const plain = world([]);
    expect(step(sim) / step(plain)).toBeCloseTo(
      1 + GEAR_ARTIFACT.hide.speed,
      6,
    );
    // Not again inside 4 s.
    const ready = me(sim).hideReady!;
    expect(ready).toBeGreaterThan(3);
  });

  it("the Aegis of the Eternal King: once a run, below 25% HP, a shield soaks 30% of max HP", () => {
    let sim = run(bullet(world(["aegisKing"]), 80), 0.2).sim;
    expect(me(sim).hp).toBeCloseTo(20, 6);
    expect(me(sim).shield?.amount).toBeCloseTo(30, 6);
    sim = run(bullet(sim, 10), 0.2).sim;
    expect(me(sim).hp).toBeCloseTo(20, 6);
    expect(me(sim).shield?.amount).toBeCloseTo(20, 6);
    // Gone after 5 s, and it never comes back this run.
    sim = run(sim, 5).sim;
    expect(me(sim).shield).toBeUndefined();
    const before = me(sim).hp;
    sim = run(bullet(sim, 5), 0.2).sim;
    expect(me(sim).hp).toBeLessThan(before);
    expect(me(sim).shield).toBeUndefined();
  });

  it("the Ouroboros: each kill restores 2% of max HP and MP", () => {
    // The same fight with and without the ring: the difference is the heal.
    const fight = (artifacts: ArtifactId[]) => {
      let sim = world(artifacts, { hp: 50, mp: 0 });
      sim = spawnEnemies(sim, [
        { kind: "dummy", at: { x: 40, y: 0 }, roomId: null },
      ]);
      sim = {
        ...sim,
        enemies: sim.enemies.map((e) => ({ ...e, hp: 1 })),
        players: sim.players.map((p) => ({ ...p, fireCooldown: 0 })),
      };
      const shot: PlayerInput = {
        move: { x: 0, y: 0 },
        fire: { trigger: true, aim: { x: 1, y: 0 } },
      };
      sim = applyPlayerInput(sim, 1, shot, [], TICK_SECONDS).state;
      return run(sim, 0.3);
    };
    const ring = fight(["ouroboros"]);
    const bare = fight([]);
    expect(ring.events.some((e) => e.type === "defeated")).toBe(true);
    expect(me(ring.sim).hp - me(bare.sim).hp).toBeCloseTo(
      GEAR_ARTIFACT.ouroboros.hp * me(ring.sim).maxHp,
      6,
    );
    expect(me(ring.sim).mp - me(bare.sim).mp).toBeCloseTo(
      GEAR_ARTIFACT.ouroboros.mp * me(ring.sim).combat.maxMp,
      6,
    );
  });

  it("the Resurrection Necklace: a death is survived once at 50% HP, then it shatters", () => {
    let r = run(bullet(world(["resurrection"]), 500), 0.2);
    expect(r.events.some((e) => e.type === "playerDied")).toBe(false);
    expect(r.events).toContainEqual({
      type: "artifactSpent",
      playerId: 1,
      artifact: "resurrection",
    });
    expect(me(r.sim).hp).toBeCloseTo(50, 6);
    expect(me(r.sim).artifacts ?? []).not.toContain("resurrection");
    // Two seconds untouchable.
    r = run(bullet(r.sim, 500), 0.2);
    expect(me(r.sim).hp).toBeCloseTo(50, 6);
    // Then a death is a death.
    r = run(r.sim, 2);
    r = run(bullet(r.sim, 500), 0.2);
    expect(r.events.some((e) => e.type === "playerDied")).toBe(true);
  });

  it("the Veil: after a hit, untouchable for 1 s, at most once every 10 s", () => {
    let sim = run(bullet(world(["veil"]), 10), 0.2).sim;
    expect(me(sim).hp).toBe(90);
    sim = run(bullet(sim, 10), 0.2).sim;
    expect(me(sim).hp).toBe(90);
    // After the second, but within 10 s: a hit hurts and no new veil.
    sim = run(sim, 1).sim;
    sim = run(bullet(sim, 10), 0.2).sim;
    expect(me(sim).hp).toBeLessThan(90);
    expect(me(sim).invulnerable).toBeUndefined();
  });
});
