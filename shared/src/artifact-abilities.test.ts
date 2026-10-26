import { describe, expect, it } from "vitest";
import {
  ARCANE_BLAST,
  GUARD,
  NATURES_REACH,
  type AbilityKind,
} from "./abilities.ts";
import { ABILITY_ARTIFACT } from "./artifact-effects.ts";
import type { ArtifactId } from "./artifacts.ts";
import type { EnemyKind } from "./enemy-config.ts";
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

/** A player at (0, 0) casting `kind` (T1), wearing these Artifacts, with enemies here. */
function world(
  kind: AbilityKind,
  artifacts: ArtifactId[],
  at: [number, number][] = [],
  enemyKind: EnemyKind = "dummy",
  hp = 1e6,
): SimState {
  let sim = addPlayer(
    createSimState([], { respawnSeconds: null }),
    1,
    { x: 0, y: 0 },
    { ...SERF_BASE, hp: 100, mp: 200, defense: 0, vitality: 0 },
    null,
    { kind, tier: 1 },
    null,
    artifacts,
  );
  sim = spawnEnemies(
    sim,
    at.map(([x, y]) => ({ kind: enemyKind, at: { x, y }, roomId: null })),
  );
  return {
    ...sim,
    enemies: sim.enemies.map((e) => ({ ...e, hp, maxHp: hp })),
  };
}

const me = (sim: SimState): PlayerState => sim.players[0]!;
const set = (sim: SimState, change: Partial<PlayerState>): SimState => ({
  ...sim,
  players: sim.players.map((p) => ({ ...p, ...change })),
});

/** Casts toward (x, y) from the player now. */
function cast(sim: SimState, x: number, y: number) {
  const input: PlayerInput = {
    move: { x: 0, y: 0 },
    fire: { trigger: false, aim: null },
    ability: { x, y },
  };
  return applyPlayerInput(sim, 1, input, [], TICK_SECONDS);
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

/** An enemy bullet from the east, of this damage. */
function bullet(sim: SimState, damage: number): SimState {
  const shot: Projectile = {
    id: sim.nextProjectileId,
    owner: "enemy",
    ownerId: 999,
    position: { x: 60, y: 0 },
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

type Hit = Extract<SimEvent, { type: "hit" }>;
const hitsOn = (events: SimEvent[], enemyId: number | undefined) =>
  events.filter((e): e is Hit => e.type === "hit" && e.enemyId === enemyId);

describe("class ability Artifacts (16d, D-153)", () => {
  it("Aegis of the Last Stand: when Guard ends, twice what it blocked bursts within 150 px", () => {
    let sim = cast(world("guard", ["lastStand"], [[120, 40]]), 1, 0).state;
    sim = run(bullet(sim, 40), 0.2).sim;
    const stored = me(sim).lastStand!;
    expect(stored).toBeGreaterThan(0);
    const { events } = run(sim, GUARD.seconds);
    const blow = hitsOn(events, sim.enemies[0]!.id);
    expect(blow).toHaveLength(1);
    expect(blow[0]!.damage).toBeCloseTo(
      Math.min(ABILITY_ARTIFACT.lastStand.max, stored * 2),
      6,
    );
  });

  it("Horn of the Blood King: kills in Battle Cry heal 3% each, at most 30% a cry", () => {
    // Twelve weak dummies cut down by one unarmed shot each tick would take
    // long; one axe cleave takes several at once. Compare with and without.
    const fight = (artifacts: ArtifactId[]) => {
      const at = Array.from(
        { length: 12 },
        (_, i) => [50, -25 + i * 4] as [number, number],
      );
      let sim = cast(world("battleCry", artifacts, at, "dummy", 1), 1, 0).state;
      sim = set(sim, { hp: 400, maxHp: 1000, fireCooldown: 0 });
      sim = {
        ...sim,
        players: sim.players.map((p) => ({
          ...p,
          combat: { ...p.combat, weapon: "axe" as const },
        })),
      };
      return applyPlayerInput(
        sim,
        1,
        { move: { x: 0, y: 0 }, fire: { trigger: true, aim: { x: 1, y: 0 } } },
        [],
        TICK_SECONDS,
      );
    };
    const horn = fight(["bloodKing"]);
    const bare = fight([]);
    const kills = horn.events.filter((e) => e.type === "defeated").length;
    expect(kills).toBeGreaterThan(10);
    // Twelve kills would be 36%; the cry heals at most 30%.
    expect(me(horn.state).hp - me(bare.state).hp).toBeCloseTo(
      1000 * Math.min(ABILITY_ARTIFACT.bloodKing.max, kills * 0.03),
      6,
    );
  });

  it("Veil of the Unseen End: Vanish leaves a decoy that bursts for 150 when Vanish ends", () => {
    let sim = cast(world("vanish", ["unseenEnd"], [[60, 0]]), 1, 0).state;
    expect(sim.decoys).toHaveLength(1);
    // A shot ends Vanish; the decoy bursts.
    sim = set(sim, { fireCooldown: 0 });
    sim = applyPlayerInput(
      sim,
      1,
      { move: { x: 0, y: 0 }, fire: { trigger: true, aim: { x: 0, y: 1 } } },
      [],
      TICK_SECONDS,
    ).state;
    const r = run(sim, 0.1);
    expect(r.sim.decoys).toEqual([]);
    expect(hitsOn(r.events, sim.enemies[0]!.id).map((h) => h.damage)).toContain(
      ABILITY_ARTIFACT.unseenEnd.damage,
    );
  });

  it("Quiver of the Worldseeker: a Volley arrow on a boss sends a seeking arrow from you", () => {
    const seeking = (kind: EnemyKind) => {
      const sim = cast(
        world("volley", ["worldseeker"], [[150, 0]], kind),
        1,
        0,
      ).state;
      const r = run(sim, 0.5);
      return hitsOn(r.events, sim.enemies[0]!.id).length;
    };
    const plain = (kind: EnemyKind) => {
      const sim = cast(world("volley", [], [[150, 0]], kind), 1, 0).state;
      return hitsOn(run(sim, 0.5).events, sim.enemies[0]!.id).length;
    };
    expect(seeking("warlord")).toBeGreaterThan(plain("warlord"));
    expect(seeking("dummy")).toBe(plain("dummy"));
  });

  it("Aetherion's Codex: Arcane Blast pulls in enemies just outside it before it detonates", () => {
    const just = ARCANE_BLAST.radius * 1.3;
    const blast = (artifacts: ArtifactId[]) => {
      const sim = cast(
        world("arcaneBlast", artifacts, [[100 + just, 0]]),
        100,
        0,
      ).state;
      return hitsOn(run(sim, 0.05).events, sim.enemies[0]!.id).length;
    };
    expect(blast(["codex"])).toBe(1);
    expect(blast([])).toBe(0);
  });

  it("The Tome of the First Dawn: Healing also shields for half the heal, at most 20% of max HP", () => {
    const sim = cast(
      set(world("healing", ["firstDawn"]), { hp: 10 }),
      1,
      0,
    ).state;
    const healed = me(sim).hp - 10;
    expect(me(sim).shield?.amount).toBeCloseTo(
      Math.min(healed * 0.5, 100 * 0.2),
      6,
    );
  });

  it("The Worldsong: Inspiration destroys up to 6 enemy projectiles within 150 px", () => {
    let sim = world("inspiration", ["worldsong"]);
    for (let i = 0; i < 8; i++) sim = bullet(sim, 1);
    sim = {
      ...sim,
      projectiles: sim.projectiles.map((p, i) => ({
        ...p,
        position: { x: 50 + i * 5, y: 0 },
      })),
    };
    sim = cast(sim, 1, 0).state;
    expect(sim.projectiles.filter((p) => p.owner === "enemy")).toHaveLength(2);
  });

  it("The Black Testament: a cursed enemy's death gives +10 MP and lengthens curses near it", () => {
    let sim = world(
      "curse",
      ["testament"],
      [
        [100, 0],
        [110, 20],
      ],
    );
    sim = set(cast(sim, 100, 0).state, { mp: 50 });
    sim = {
      ...sim,
      enemies: sim.enemies.map((e, i) => (i === 0 ? { ...e, hp: 1 } : e)),
    };
    const before = sim.enemies[1]!.curse!.remaining;
    // A shot kills the weak cursed one.
    sim = set(sim, { fireCooldown: 0 });
    sim = applyPlayerInput(
      sim,
      1,
      { move: { x: 0, y: 0 }, fire: { trigger: true, aim: { x: 1, y: 0 } } },
      [],
      TICK_SECONDS,
    ).state;
    const r = run(sim, 0.4);
    expect(r.events.some((e) => e.type === "defeated")).toBe(true);
    expect(me(r.sim).mp).toBeGreaterThan(50 + 10 - 1);
    const other = r.sim.enemies.find((e) => e.position.y === 20);
    expect(other?.curse?.remaining ?? 0).toBeGreaterThan(before - 0.5 + 1.5);
  });

  it("The Worldroot Totem: every 3rd Nature's Reach roots; the next hit on a rooted enemy +50%", () => {
    let sim = world("naturesReach", ["worldroot"], [[100, 0]]);
    const rooted: number[] = [];
    for (let n = 1; n <= 3; n++) {
      sim = set(sim, { abilityCooldown: 0, mp: 200 });
      sim = cast(sim, 100, 0).state;
      sim = run(sim, 0.05).sim;
      if (sim.enemies[0]!.rooted) rooted.push(n);
      sim = { ...sim, zones: [] };
    }
    expect(rooted).toEqual([3]);
    // The root lands with the first pulse, so the bonus waits for the next hit.
    const e = sim.enemies[0]!;
    expect(e.rooted?.bonus).toBe(true);
    expect(NATURES_REACH.radius).toBeGreaterThan(0);
  });

  it("Eternity's Conduit: the last target leaves a field that zaps enemies walking in, once each", () => {
    let sim = world("chainLightning", ["conduit"], [[100, 0]]);
    sim = cast(sim, 100, 0).state;
    expect(sim.fields).toHaveLength(1);
    // The target inside when it formed is not zapped by it.
    let r = run(sim, 0.2);
    expect(hitsOn(r.events, sim.enemies[0]!.id)).toEqual([]);
    // One walking in is, once.
    r.sim = spawnEnemies(r.sim, [
      { kind: "dummy", at: { x: 105, y: 5 }, roomId: null },
    ]);
    const walker = r.sim.enemies.at(-1)!.id;
    r = run(r.sim, 0.5);
    expect(hitsOn(r.events, walker)).toHaveLength(1);
  });
});
