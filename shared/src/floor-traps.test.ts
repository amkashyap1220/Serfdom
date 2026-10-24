import { describe, expect, it } from "vitest";
import {
  ARROWS,
  SLUDGE,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import { arrowVolleys, trapWarnings, type RunProgress } from "./dungeon-run.ts";
import { enemyAct } from "./enemy-ai.ts";
import { GRUNT } from "./enemy-config.ts";
import { newEnemy } from "./enemy.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens } from "./goblin-warrens.ts";
import { touches } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { seededRandom } from "./seeded-random.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  fireArrows,
  stepWorld,
  type SimState,
} from "./sim.ts";
import { SERF_BASE } from "./stats.ts";
import { DEFENSE_SCALE } from "./stats.ts";

/** The share of a hit taken at `defense` (D-121). */
const takenAt = (defense: number) => DEFENSE_SCALE / (DEFENSE_SCALE + defense);

const east = { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } };
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("sludge (D-113)", () => {
  const pool = { x: 0, y: -50, width: 200, height: 100 };
  const walk = (sludge: SimState["sludge"]) => {
    let sim: SimState = {
      ...addPlayer(createSimState([]), 1, { x: 10, y: 0 }),
      sludge,
    };
    sim = applyPlayerInput(sim, 1, east, [], TICK_SECONDS).state;
    return findPlayer(sim, 1)!.position.x - 10;
  };

  it("players in it move at 60% speed; outside, at full speed", () => {
    const full = walk([]);
    expect(walk([pool])).toBeCloseTo(full * SLUDGE.speedFactor, 9);
    expect(walk([{ ...pool, x: 500 }])).toBeCloseTo(full, 9);
  });

  it("goblins wade through at full speed", () => {
    const g = newEnemy(1, "grunt", { x: 10, y: 0 }, null, null);
    const moved =
      enemyAct(g, [{ id: 1, position: { x: 400, y: 0 } }], [], TICK_SECONDS)
        .enemy.position.x - 10;
    expect(moved).toBeCloseTo(GRUNT.speed * TICK_SECONDS, 9);
  });

  it("is in the Fungus grotto, in both dungeons", () => {
    const rooms = (build: (s: number) => DungeonLayout) =>
      new Set(
        SEEDS.flatMap((s) =>
          build(s)
            .rooms.filter((r) => r.sludge)
            .map((r) => r.id.replace(/-\d+$/, "")),
        ),
      );
    expect([...rooms(buildWarrens)]).toEqual(["grotto"]);
    expect([...rooms(buildStronghold)]).toEqual(["grotto"]);
  });
});

describe("arrow traps (D-113)", () => {
  const slits = Array.from({ length: 10 }, (_, i) => ({
    x: 40 + 40 * i,
    y: 10,
  }));
  const room = (extra: Partial<RoomDef> = {}): RoomDef => ({
    id: "gate",
    name: "Gate",
    bounds: { x: 0, y: 0, width: 440, height: 400 },
    waves: [],
    required: true,
    arrows: { slits, direction: { x: 0, y: 1 }, damage: 6 },
    ...extra,
  });
  const layout = (r = room()): DungeonLayout => ({
    world: { width: 600, height: 600 },
    walls: [],
    spawn: { x: 200, y: 200 },
    rooms: [r],
    doors: [],
    exitPortal: null,
  });
  const at = (clock: number, volleys = 0, gap = -1) =>
    [
      {
        status: "active",
        wave: 0,
        clock,
        released: 0,
        waveStart: 0,
        dropped: 0,
        volleys,
        gap,
        runeSteps: 0,
      },
    ] as RunProgress;

  it("fire at 0.8 s and then every 3.5 s, from every slit but a gap of 3", () => {
    const random = seededRandom(3);
    let progress = at(0);
    const times: number[] = [];
    for (let clock = 0; clock <= 8.5; clock += TICK_SECONDS) {
      progress = [{ ...progress[0]!, clock }];
      const r = arrowVolleys(progress, layout(), random);
      progress = r.progress;
      if (r.shots.length > 0) {
        times.push(Math.round(clock * 100) / 100);
        expect(r.shots).toHaveLength(slits.length - ARROWS.gap);
        for (const s of r.shots)
          expect(s).toMatchObject({ direction: { x: 0, y: 1 }, damage: 6 });
      }
    }
    expect(times).toEqual([0.8, 4.3, 7.8]);
  });

  it("show the coming gap while they glow, and skip exactly those slits", () => {
    let progress = arrowVolleys(at(0.1), layout(), seededRandom(5)).progress;
    const glow = trapWarnings(progress, layout());
    expect(glow).toEqual([
      { room: "gate", gap: progress[0]!.gap, warn: expect.any(Number) },
    ]);
    expect(glow[0]!.warn).toBeCloseTo(0.1 / ARROWS.warnSeconds, 6);
    progress = [{ ...progress[0]!, clock: 0.8 }];
    const fired = arrowVolleys(progress, layout(), seededRandom(5));
    const xs = fired.shots.map((s) => s.at.x);
    const gap = glow[0]!.gap;
    for (let k = gap; k < gap + ARROWS.gap; k++)
      expect(xs).not.toContain(slits[k]!.x);
    // Between volleys (well before the next glow) nothing glows.
    expect(
      trapWarnings([{ ...fired.progress[0]!, clock: 1.5 }], layout()),
    ).toEqual([]);
  });

  it("only while the room fights", () => {
    const cleared = [{ ...at(0.8)[0]!, status: "cleared" as const }];
    expect(arrowVolleys(cleared, layout(), Math.random).shots).toEqual([]);
    expect(trapWarnings(cleared, layout())).toEqual([]);
  });

  it("an arrow hits a player as the room's hit (Defense counts); an obstacle stops it", () => {
    const shoot = (
      walls: { x: number; y: number; width: number; height: number }[],
      defense = 0,
    ) => {
      let sim = addPlayer(
        createSimState([]),
        1,
        { x: 100, y: 200 },
        { ...SERF_BASE, defense },
      );
      sim = fireArrows(
        sim,
        [{ at: { x: 100, y: 10 }, direction: { x: 0, y: 1 }, damage: 6 }],
        1200,
      );
      const events = [];
      for (let t = 0; t < 60; t++) {
        const r = stepWorld(sim, walls, TICK_SECONDS);
        sim = r.state;
        events.push(...r.events);
      }
      return { hp: findPlayer(sim, 1)!.hp, events };
    };
    const open = shoot([]);
    expect(open.events.filter((e) => e.type === "hazardHit")).toEqual([
      expect.objectContaining({ hazard: "arrows", damage: 6 }),
    ]);
    expect(shoot([], 10).hp).toBeCloseTo(20 - 6 * takenAt(10), 0);
    const covered = shoot([{ x: 80, y: 100, width: 40, height: 20 }]);
    expect(covered.events.some((e) => e.type === "hazardHit")).toBe(false);
    expect(covered.hp).toBe(20);
  });

  it("are in the Stronghold's Gatehouse only, with 6 damage, and fire across the path", () => {
    let seen = 0;
    for (const seed of SEEDS) {
      const layout = buildStronghold(seed);
      for (const r of layout.rooms) {
        if (!r.arrows) continue;
        expect(r.id.replace(/-\d+$/, "")).toBe("gatehouse");
        expect(r.arrows.damage).toBe(6);
        // Across the way in: at right angles to the step from the room its
        // door leads from.
        const door = layout.doors.find(
          (d) => d.room !== r.id && touches(r.bounds, d.rect),
        )!;
        const from = layout.rooms.find((x) => x.id === door.room)!.bounds;
        const dx = r.bounds.x + r.bounds.width / 2 - (from.x + from.width / 2);
        const dy =
          r.bounds.y + r.bounds.height / 2 - (from.y + from.height / 2);
        const along =
          Math.abs(dx) > Math.abs(dy)
            ? { x: Math.sign(dx), y: 0 }
            : { x: 0, y: Math.sign(dy) };
        expect(
          r.arrows.direction.x * along.x + r.arrows.direction.y * along.y,
        ).toBeCloseTo(0, 9);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(SEEDS.some((s) => buildWarrens(s).rooms.some((r) => r.arrows))).toBe(
      false,
    );
  });
});
