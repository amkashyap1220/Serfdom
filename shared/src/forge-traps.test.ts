import { describe, expect, it } from "vitest";
import {
  JETS,
  ROCKFALL,
  SLAG,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import {
  arrowVolleys,
  rockfallDrops,
  trapWarnings,
  type RoomProgress,
  type RunProgress,
} from "./dungeon-run.ts";
import {
  buildForge,
  FORGE_PIECES,
  FORGE_RECIPE,
  FORGE_TRAP_ROOMS,
} from "./ember-forge.ts";
import type { Rect } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { seededRandom } from "./seeded-random.ts";
import {
  addPlayer,
  beamBox,
  createSimState,
  dropBoulders,
  fireJets,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const fighting = (clock: number, extra: Partial<RoomProgress> = {}) =>
  [
    {
      status: "active",
      wave: 0,
      clock,
      released: 0,
      waveStart: 0,
      dropped: 0,
      volleys: 0,
      gap: -1,
      runeSteps: 0,
      ...extra,
    },
  ] as RunProgress;
const layoutOf = (room: RoomDef): DungeonLayout => ({
  world: { width: 800, height: 800 },
  walls: [],
  spawn: { x: 100, y: 100 },
  rooms: [room],
  doors: [],
  exitPortal: null,
});
const hall = (extra: Partial<RoomDef>): RoomDef => ({
  id: "hall",
  name: "Hall",
  bounds: { x: 0, y: 0, width: 640, height: 400 },
  waves: [],
  required: true,
  ...extra,
});

function step(sim: SimState, seconds: number, walls: readonly Rect[] = []) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(sim, walls, TICK_SECONDS);
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

const hazardHits = (events: SimEvent[]) =>
  events.filter((e) => e.type === "hazardHit");

describe("where 13c's traps are (D-133)", () => {
  const piece = (key: string) =>
    FORGE_PIECES.find((p) => p.piece.key === key)!.piece;

  it("fire jets: 4 nozzles in the Bellows room, 5 in the Chain gallery and Great furnace, 128 px apart on the north wall, firing south", () => {
    const nozzles = (key: string) => {
      const a = piece(key).arrows!;
      expect(a.jet).toBe(true);
      expect(a.direction).toEqual({ x: 0, y: 1 });
      expect(a.slits.every((s) => s.y === 10)).toBe(true);
      return a.slits.map((s) => s.x);
    };
    expect(nozzles("bellows")).toEqual([184, 312, 440, 568]);
    expect(nozzles("chains")).toEqual([144, 272, 400, 528, 656]);
    expect(nozzles("furnace")).toEqual([160, 288, 416, 544, 672]);
  });

  it("slag spills in the Ore store, Anvil hall, and Slag pit; no other traps; the six trap rooms are the thinned ones", () => {
    const withJets = FORGE_PIECES.filter((p) => p.piece.arrows?.jet);
    const withSlag = FORGE_PIECES.filter((p) => p.piece.rockfall === "slag");
    expect(withSlag.map((p) => p.piece.key)).toEqual([
      "orestore",
      "anvils",
      "slagpit",
    ]);
    expect(
      FORGE_PIECES.filter(
        (p) => p.piece.rockfall === true || p.piece.runes || p.piece.sludge,
      ),
    ).toEqual([]);
    expect(new Set([...withJets, ...withSlag].map((p) => p.piece.key))).toEqual(
      FORGE_TRAP_ROOMS,
    );
  });

  it("built maps carry them, turned with their rooms, at the forge's trap damage", () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const room of buildForge(seed).rooms) {
        if (room.arrows) {
          expect(room.arrows.jet).toBe(true);
          expect(room.arrows.damage).toBe(FORGE_RECIPE.arrowDamage);
        }
        if (room.rockfall) {
          expect(room.rockfall).toEqual({
            damage: FORGE_RECIPE.rockfallDamage,
            slag: true,
          });
        }
      }
    }
  });
});

describe("fire jets (D-133)", () => {
  const slits = [0, 1, 2, 3].map((i) => ({ x: 184 + 128 * i, y: 10 }));
  const room = hall({
    arrows: { slits, direction: { x: 0, y: 1 }, damage: 12, jet: true },
  });
  const layout = layoutOf(room);
  const random = seededRandom(1);

  it("take turns: alternate nozzles glow for 0.8 s and fire, a new group every 2 s", () => {
    let p = arrowVolleys(fighting(0.4), layout, random).progress;
    expect(trapWarnings(p, layout)).toEqual([
      { room: "hall", gap: 0, warn: expect.closeTo(0.5, 5) },
    ]);
    const first = arrowVolleys(
      [{ ...p[0]!, clock: JETS.warnSeconds }],
      layout,
      random,
    );
    expect(first.shots.map((s) => s.at.x)).toEqual([184, 440]);
    expect(
      first.shots.every(
        (s) => s.jet && s.damage === 12 && s.room === room.bounds,
      ),
    ).toBe(true);
    p = first.progress;
    // Nothing more until the next group's time.
    expect(
      arrowVolleys([{ ...p[0]!, clock: 2.7 }], layout, random).shots,
    ).toEqual([]);
    const second = arrowVolleys(
      [{ ...p[0]!, clock: JETS.warnSeconds + JETS.everySeconds }],
      layout,
      random,
    );
    expect(second.shots.map((s) => s.at.x)).toEqual([312, 568]);
  });

  it("a beam runs across to the far side of the room, or stops at the first obstacle", () => {
    const block = { x: 280, y: 96, width: 64, height: 48 };
    const sim = fireJets(
      createSimState([]),
      [
        {
          at: { x: 184, y: 10 },
          direction: { x: 0, y: 1 },
          damage: 12,
          room: room.bounds,
        },
        {
          at: { x: 312, y: 10 },
          direction: { x: 0, y: 1 },
          damage: 12,
          room: room.bounds,
        },
      ],
      [block],
    );
    expect(sim.beams!.map((b) => b.to)).toEqual([
      { x: 184, y: 400 },
      { x: 312, y: 96 },
    ]);
    expect(beamBox(sim.beams![1]!)).toEqual({
      x: 296,
      y: 10,
      width: JETS.width,
      height: 86,
    });
  });

  it("burns each player it touches once, for 12 as the room's hit, for 0.5 s, and stopped by cover", () => {
    // Player 1 stands in the beam; player 2 just touches its edge with
    // their hurtbox; player 3 shelters behind the block; player 4 is clear.
    let sim = createSimState([]);
    sim = addPlayer(sim, 1, { x: 312, y: 60 });
    sim = addPlayer(sim, 2, { x: 184 + 16 + 15, y: 200 });
    sim = addPlayer(sim, 3, { x: 312, y: 200 });
    sim = addPlayer(sim, 4, { x: 184 + 16 + 17, y: 200 });
    const block = { x: 280, y: 96, width: 64, height: 48 };
    sim = fireJets(
      sim,
      [184, 312].map((x) => ({
        at: { x, y: 10 },
        direction: { x: 0, y: 1 },
        damage: 12,
        room: room.bounds,
      })),
      [block],
    );
    const { sim: after, events } = step(sim, 1, [block]);
    const hits = hazardHits(events);
    expect(
      hits.map((h) => (h as { playerId: number }).playerId).sort(),
    ).toEqual([1, 2]);
    expect(hits[0]).toMatchObject({ hazard: "jets", damage: 12 });
    expect(after.beams).toEqual([]);
  });

  it("a player walking into a beam while it burns is hit; once it is out, nobody is", () => {
    let sim = addPlayer(createSimState([]), 1, { x: 100, y: 200 });
    sim = fireJets(
      sim,
      [
        {
          at: { x: 184, y: 10 },
          direction: { x: 0, y: 1 },
          damage: 12,
          room: room.bounds,
        },
      ],
      [],
    );
    sim = step(sim, 0.2).sim;
    // Steps into it 0.2 s in.
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, position: { x: 184, y: 200 } })),
    };
    expect(hazardHits(step(sim, 0.1).events)).toHaveLength(1);
    const late = step(sim, JETS.beamSeconds);
    expect(late.sim.beams).toEqual([]);
  });
});

describe("slag spills (D-133)", () => {
  const room = hall({ rockfall: { damage: 10, slag: true } });
  const layout = layoutOf(room);

  it("fall one every 1.6 s, slower than boulders (1.05 s)", () => {
    const random = seededRandom(2);
    const at = (clock: number) =>
      rockfallDrops(fighting(clock), layout, [], random).drops.length;
    expect(at(0)).toBe(1);
    expect(at(SLAG.everySeconds - 0.01)).toBe(1);
    expect(at(SLAG.everySeconds)).toBe(2);
    expect(at(10 * SLAG.everySeconds)).toBe(11);
    const drops = rockfallDrops(fighting(0), layout, [], random).drops;
    expect(drops[0]).toMatchObject({ damage: 10, slag: true });
    expect(ROCKFALL.everySeconds).toBeLessThan(SLAG.everySeconds);
  });

  it("land after the boulder's 1.2 s warning for 10, then leave burning floor: 3 every 0.5 s for 3 s, all the room's hits", () => {
    let sim = addPlayer(createSimState([]), 1, { x: 200, y: 200 });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1000, maxHp: 1000 })),
    };
    sim = dropBoulders(sim, [
      { at: { x: 200, y: 200 }, damage: 10, slag: true },
    ]);
    expect(sim.hazards[0]).toMatchObject({
      hazard: "slag",
      radius: ROCKFALL.radius,
      landsIn: ROCKFALL.warnSeconds,
      fire: SLAG.fire,
    });
    const { sim: after, events } = step(sim, ROCKFALL.warnSeconds + 3.2);
    const hits = hazardHits(events);
    expect(hits.every((h) => (h as { hazard: string }).hazard === "slag")).toBe(
      true,
    );
    expect(hits.map((h) => (h as { damage: number }).damage)).toEqual([
      10, 3, 3, 3, 3, 3, 3,
    ]);
    expect(after.fires).toEqual([]);
    // No enemy hit among them: a death names the slag spill.
    expect(events.some((e) => e.type === "playerHit")).toBe(false);
  });

  it("an ordinary rockfall room still drops plain boulders that leave nothing", () => {
    const sim = dropBoulders(createSimState([]), [
      { at: { x: 200, y: 200 }, damage: 10 },
    ]);
    expect(sim.hazards[0]!.hazard).toBe("rockfall");
    expect(sim.hazards[0]!.fire).toBeUndefined();
  });
});
