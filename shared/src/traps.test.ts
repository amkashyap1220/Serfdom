import { describe, expect, it } from "vitest";
import {
  ROCKFALL,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import {
  HOLES,
  holeSpot,
  newRunProgress,
  rockfallDrops,
  stepRooms,
  type RunProgress,
} from "./dungeon-run.ts";
import { MAX_LEAD_SECONDS, throwPoint } from "./enemy-ai.ts";
import { SLINGER } from "./enemy-config.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens } from "./goblin-warrens.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  dropBoulders,
  spawnEnemies,
  stepWorld,
  type SimState,
} from "./sim.ts";
import { seededRandom } from "./seeded-random.ts";
import { SERF_BASE } from "./stats.ts";

const room = (extra: Partial<RoomDef>): RoomDef => ({
  id: "r",
  name: "R",
  bounds: { x: 0, y: 0, width: 400, height: 400 },
  waves: [[{ kind: "grunt", at: { x: 300, y: 200 } }]],
  required: true,
  ...extra,
});
const layoutOf = (...rooms: RoomDef[]): DungeonLayout => ({
  world: { width: 600, height: 600 },
  walls: [],
  spawn: { x: 200, y: 200 },
  rooms,
  doors: [],
  exitPortal: null,
});

describe("rockfall rooms (D-110)", () => {
  const rockRoom = room({ rockfall: { damage: 4 } });
  const fighting = (clock: number, dropped = 0) =>
    [
      {
        status: "active",
        wave: 0,
        clock,
        released: 0,
        waveStart: 0,
        dropped,
        volleys: 0,
        gap: -1,
      },
    ] as RunProgress;

  it("drop a boulder every ROCKFALL.everySeconds of a fighting room's clock, the first at once", () => {
    const layout = layoutOf(rockRoom);
    const sim = addPlayer(createSimState([]), 1, { x: 200, y: 200 });
    const random = seededRandom(5);
    let progress = fighting(0);
    let drops = 0;
    for (let clock = 0; clock <= 7 + 1e-9; clock += TICK_SECONDS) {
      progress = [{ ...progress[0]!, clock }];
      const r = rockfallDrops(progress, layout, sim.players, random);
      progress = r.progress;
      drops += r.drops.length;
      for (const d of r.drops) expect(d.damage).toBe(4);
    }
    // At 0, 1.05, …, 6.3 s (D-111): 7 boulders in 7 s.
    expect(drops).toBe(Math.floor(7 / ROCKFALL.everySeconds + 1e-9) + 1);
    expect(drops).toBe(7);
  });

  it("only while the room fights, and not in rooms without rockfall", () => {
    const sim = addPlayer(createSimState([]), 1, { x: 200, y: 200 });
    const none = (layout: DungeonLayout, progress: RunProgress) =>
      rockfallDrops(progress, layout, sim.players, Math.random).drops;
    expect(
      none(layoutOf(rockRoom), [{ ...fighting(3)[0]!, status: "cleared" }]),
    ).toEqual([]);
    expect(
      none(layoutOf(rockRoom), [{ ...fighting(3)[0]!, status: "dormant" }]),
    ).toEqual([]);
    expect(none(layoutOf(room({})), fighting(3))).toEqual([]);
  });

  it("land on the floor clear of the walls; about 1 in 4 near a player", () => {
    const layout = layoutOf(
      room({
        bounds: { x: 0, y: 0, width: 1600, height: 1600 },
        rockfall: { damage: 4 },
      }),
    );
    const sim = addPlayer(createSimState([]), 1, { x: 300, y: 300 });
    const r = rockfallDrops(
      fighting(ROCKFALL.everySeconds * 3999),
      layout,
      sim.players,
      seededRandom(9),
    );
    expect(r.drops).toHaveLength(4000);
    const m = ROCKFALL.radius;
    for (const d of r.drops) {
      expect(d.at.x).toBeGreaterThanOrEqual(m);
      expect(d.at.y).toBeGreaterThanOrEqual(m);
      expect(d.at.x).toBeLessThanOrEqual(1600 - m);
      expect(d.at.y).toBeLessThanOrEqual(1600 - m);
    }
    const near = r.drops.filter(
      (d) => Math.hypot(d.at.x - 300, d.at.y - 300) <= ROCKFALL.nearRadius,
    ).length;
    // 25% aimed near, plus the few random ones that happen to land there.
    expect(near / 4000).toBeGreaterThan(0.22);
    expect(near / 4000).toBeLessThan(0.3);
  });

  it("a boulder lands after 1.2 s, hurts like a hit (Defense counts), and can kill", () => {
    const land = (stats = SERF_BASE, hp?: number) => {
      let sim = addPlayer(createSimState([]), 1, { x: 100, y: 100 }, stats);
      if (hp !== undefined)
        sim = { ...sim, players: sim.players.map((p) => ({ ...p, hp })) };
      sim = dropBoulders(sim, [{ at: { x: 110, y: 100 }, damage: 4 }]);
      const events = [];
      for (
        let t = 0;
        t < Math.round(ROCKFALL.warnSeconds / TICK_SECONDS) + 1;
        t++
      ) {
        const r = stepWorld(sim, [], TICK_SECONDS);
        sim = r.state;
        events.push(...r.events);
      }
      return { sim, events };
    };
    const plain = land();
    expect(plain.events.filter((e) => e.type === "hazardHit")).toEqual([
      expect.objectContaining({ hazard: "rockfall", damage: 4, playerId: 1 }),
    ]);
    expect(plain.events.some((e) => e.type === "playerHit")).toBe(false);
    expect(
      findPlayer(land({ ...SERF_BASE, defense: 10 }).sim, 1)?.hp,
    ).toBeCloseTo(18, 0);
    expect(land(SERF_BASE, 1).events.map((e) => e.type)).toContain(
      "playerDied",
    );
  });
});

describe("ambush holes (D-109)", () => {
  const holes = [
    { x: 200, y: 20 },
    { x: 380, y: 200 },
  ];
  const five = Array.from({ length: 5 }, () => ({
    kind: "grunt" as const,
    at: { x: 200, y: 20 },
  }));

  it("let the hole wave out 2 at a time, every 4 s from the wave's start", () => {
    const layout = layoutOf(
      room({
        waves: [[{ kind: "grunt", at: { x: 300, y: 300 } }], five],
        holes,
        holeWave: 1,
      }),
    );
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 200,
      y: 200,
    });
    let progress = newRunProgress(layout);
    const tick = () => {
      const r = stepRooms(progress, sim, layout);
      progress = r.progress;
      sim = spawnEnemies(sim, r.spawns);
      return r.spawns;
    };
    expect(tick()).toHaveLength(1); // wave 0 at once
    for (let t = 0; t < 120; t++) tick(); // wave 0 alive: nothing more
    sim = { ...sim, enemies: [] }; // wave 0 dies
    expect(tick()).toHaveLength(2); // the first burst at once
    let released = 2;
    const ticksPerBurst = Math.round(HOLES.everySeconds / TICK_SECONDS);
    for (let t = 1; t < ticksPerBurst; t++) expect(tick()).toEqual([]);
    released += tick().length;
    expect(released).toBe(4);
    // All out and dead: only then is the room cleared.
    for (let t = 0; t < ticksPerBurst; t++) released += tick().length;
    expect(released).toBe(5);
    expect(progress[0]?.status).toBe("active");
    sim = { ...sim, enemies: [] };
    tick();
    expect(progress[0]?.status).toBe("cleared");
  });

  it("a burst stands side by side by its hole, inside the room", () => {
    const r = room({ holes, holeWave: 0 });
    expect(holeSpot(r, 0, 0)).toEqual({ x: 186, y: 20 });
    expect(holeSpot(r, 0, 1)).toEqual({ x: 214, y: 20 });
    // The side hole lines its goblins up vertically.
    expect(holeSpot(r, 1, 0)).toEqual({ x: 380, y: 186 });
  });
});

describe("slingers that lead their shots (D-109)", () => {
  const from = { x: 0, y: 0 };

  it("aim where a moving target will be, at most 0.6 s ahead", () => {
    const still = {
      id: 1,
      position: { x: 100, y: 0 },
      velocity: { x: 0, y: 0 },
    };
    const moving = {
      id: 1,
      position: { x: 100, y: 0 },
      velocity: { x: 0, y: 150 },
    };
    expect(throwPoint(from, still, 200, true)).toEqual({ x: 100, y: 0 });
    expect(throwPoint(from, moving, 200, false)).toEqual({ x: 100, y: 0 });
    // 100 px at 200 px/s: 0.5 s ahead.
    expect(throwPoint(from, moving, 200, true)).toEqual({ x: 100, y: 75 });
    const far = { ...moving, position: { x: 400, y: 0 } };
    expect(throwPoint(from, far, 200, true).y).toBe(150 * MAX_LEAD_SECONDS);
  });

  it("a leading slinger's rock flies ahead of a strafing player; a plain one's straight at them", () => {
    const rockAim = (leads: boolean) => {
      let sim: SimState = createSimState([], { respawnSeconds: null });
      sim = addPlayer(sim, 1, { x: 300, y: 300 });
      sim = spawnEnemies(sim, [
        { kind: "slinger", at: { x: 100, y: 300 }, roomId: null, leads },
      ]);
      sim = {
        ...sim,
        enemies: sim.enemies.map((e) => ({ ...e, attackCooldown: 0 })),
      };
      const south = {
        move: { x: 0, y: 1 },
        fire: { trigger: false, aim: null },
      };
      for (let t = 0; t < 20; t++) {
        sim = applyPlayerInput(sim, 1, south, [], TICK_SECONDS).state;
        sim = stepWorld(sim, [], TICK_SECONDS).state;
        const rock = sim.projectiles.find((p) => p.owner === "enemy");
        if (rock) return rock.direction;
      }
      throw new Error("no rock");
    };
    expect(rockAim(false).y).toBeLessThan(0.15);
    expect(rockAim(true).y).toBeGreaterThan(0.3);
    expect(SLINGER.rock.speed).toBe(200);
  });
});

describe("where the traps go (D-109)", () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
  const slingers = (build: (s: number) => DungeonLayout) =>
    SEEDS.flatMap((seed) =>
      build(seed).rooms.flatMap((r) =>
        r.waves.flat().filter((s) => s.kind === "slinger"),
      ),
    );

  it("one Warrens slinger in three leads; every Stronghold slinger does", () => {
    const warrens = slingers(buildWarrens);
    const share = warrens.filter((s) => s.leads).length / warrens.length;
    expect(share).toBeGreaterThan(0.28);
    expect(share).toBeLessThan(0.39);
    expect(slingers(buildStronghold).every((s) => s.leads)).toBe(true);
  });

  it("rockfall in the Tunnel and Guard room (5 in the Warrens) and the Armory too (9 in the Stronghold, D-111); holes in the Ambush hall and Barracks", () => {
    const seen = new Map<string, Set<string>>();
    const note = (key: string, what: string) => {
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(what);
    };
    for (const [name, build, damage] of [
      ["warrens", buildWarrens, 5],
      ["stronghold", buildStronghold, 9],
    ] as const) {
      for (const seed of SEEDS) {
        for (const r of build(seed).rooms) {
          const key = r.id.replace(/-\d+$/, "");
          if (r.rockfall) {
            expect(r.rockfall.damage).toBe(damage);
            note(`${name} rockfall`, key);
          }
          if (r.holes) note(`${name} holes`, key);
        }
      }
    }
    expect([...seen.get("warrens rockfall")!].sort()).toEqual([
      "guard",
      "tunnel",
    ]);
    expect([...seen.get("warrens holes")!].sort()).toEqual(["ambush"]);
    expect([...seen.get("stronghold rockfall")!].sort()).toEqual([
      "armory",
      "guard",
      "tunnel",
    ]);
    expect([...seen.get("stronghold holes")!].sort()).toEqual([
      "ambush",
      "barracks",
    ]);
  });

  it("seed 0 stays the handcrafted Warrens, without traps", () => {
    const fixed = buildWarrens(0);
    expect(fixed.rooms.some((r) => r.rockfall || r.holes)).toBe(false);
  });
});
