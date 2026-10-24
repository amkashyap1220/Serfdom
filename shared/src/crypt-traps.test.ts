import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import {
  BRAZIERS,
  RUNES,
  type DungeonLayout,
  type RoomDef,
  type RuneSpot,
} from "./dungeon-layout.ts";
import {
  arrowVolleys,
  runeBursts,
  runeColumn,
  runeWarnings,
  trapWarnings,
  type RoomProgress,
  type RunProgress,
} from "./dungeon-run.ts";
import {
  buildCrypt,
  CRYPT_MECHANIC_ROOMS,
  CRYPT_PIECES,
} from "./forgotten-crypt.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { seededRandom } from "./seeded-random.ts";
import {
  addPlayer,
  burstRunes,
  createSimState,
  fireArrows,
  stepWorld,
  type SimEvent,
} from "./sim.ts";

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
const baseRoom = (extra: Partial<RoomDef>): RoomDef => ({
  id: "hall",
  name: "Hall",
  bounds: { x: 0, y: 0, width: 600, height: 400 },
  waves: [],
  required: true,
  ...extra,
});

describe("cursed runes (D-123)", () => {
  // Three columns of two runes.
  const runes: RuneSpot[] = [0, 1, 2].flatMap((column) =>
    [100, 300].map((y) => ({ at: { x: 150 + 100 * column, y }, column })),
  );
  const layout = layoutOf(baseRoom({ runes }));

  it("sweep west to east and back: 0, 1, 2, 1, 0, 1 …", () => {
    expect(Array.from({ length: 7 }, (_, k) => runeColumn(k, 3))).toEqual([
      0, 1, 2, 1, 0, 1, 2,
    ]);
    expect(runeColumn(5, 1)).toBe(0);
  });

  it("a column glows for 1 s, then bursts for 12 within 32 px of each of its runes; the next starts 1.2 s after", () => {
    expect(runeWarnings(fighting(0.5), layout)).toEqual([
      { room: "hall", column: 0, warn: 0.5 },
    ]);
    expect(runeBursts(fighting(0.99), layout).bursts).toEqual([]);
    const first = runeBursts(fighting(RUNES.warnSeconds), layout);
    expect(first.bursts).toEqual([
      { at: { x: 150, y: 100 }, radius: 32, damage: 12 },
      { at: { x: 150, y: 300 }, radius: 32, damage: 12 },
    ]);
    expect(first.progress[0]!.runeSteps).toBe(1);
    // Between steps, nothing glows; then column 1 does.
    expect(runeWarnings(fighting(1.1, { runeSteps: 1 }), layout)).toEqual([]);
    expect(
      runeWarnings(
        fighting(RUNES.everySeconds + 0.5, { runeSteps: 1 }),
        layout,
      ),
    ).toEqual([{ room: "hall", column: 1, warn: 0.5 }]);
    const second = runeBursts(
      fighting(RUNES.everySeconds + RUNES.warnSeconds, { runeSteps: 1 }),
      layout,
    );
    expect(second.bursts.map((b) => b.at.x)).toEqual([250, 250]);
  });

  it("only while the room fights", () => {
    const dormant = [{ ...fighting(5)[0]!, status: "dormant" as const }];
    expect(runeBursts(dormant, layout).bursts).toEqual([]);
    expect(runeWarnings(dormant, layout)).toEqual([]);
  });

  it("a burst hits players on the rune for 12 as the room's hit, flashes, and misses the rest", () => {
    let sim = addPlayer(createSimState([]), 1, { x: 110, y: 100 });
    sim = addPlayer(sim, 2, { x: 200, y: 100 });
    sim = burstRunes(sim, [{ at: { x: 100, y: 100 }, radius: 32, damage: 12 }]);
    const r = stepWorld(sim, [], TICK_SECONDS);
    const hits = r.events.filter((e) => e.type === "hazardHit");
    expect(hits).toEqual([
      expect.objectContaining({ playerId: 1, hazard: "runes", damage: 12 }),
    ]);
    expect(
      r.events.some((e: SimEvent) => e.type === "blast" && e.kind === "rune"),
    ).toBe(true);
    expect(r.state.hazards).toEqual([]);
  });
});

describe("spirit braziers (D-123)", () => {
  const slits = [0, 1, 2, 3, 4].map((i) => ({ x: 80 + 80 * i, y: 10 }));
  const layout = layoutOf(
    baseRoom({
      arrows: { slits, direction: { x: 0, y: 1 }, damage: 10, fire: true },
    }),
  );
  const random = seededRandom(1);

  it("alternate braziers fire every 3 s, the evens then the odds, after a 0.8 s glow", () => {
    let p = fighting(0.5);
    p = arrowVolleys(p, layout, random).progress;
    expect(trapWarnings(p, layout)).toEqual([
      { room: "hall", gap: 0, warn: expect.closeTo((0.5 / 0.8) * 1, 5) },
    ]);
    const first = arrowVolleys(
      [{ ...p[0]!, clock: BRAZIERS.warnSeconds }],
      layout,
      random,
    );
    expect(first.shots.map((s) => s.at.x)).toEqual([80, 240, 400]);
    expect(first.shots.every((s) => s.fire && s.damage === 10)).toBe(true);
    const second = arrowVolleys(
      [
        {
          ...first.progress[0]!,
          clock: BRAZIERS.warnSeconds + BRAZIERS.everySeconds,
        },
      ],
      layout,
      random,
    );
    expect(second.shots.map((s) => s.at.x)).toEqual([160, 320]);
  });

  it("send slow fireballs (140 px/s) that hit as the room's, for 10", () => {
    let sim = addPlayer(createSimState([]), 1, { x: 100, y: 120 });
    sim = fireArrows(
      sim,
      [
        {
          at: { x: 100, y: 10 },
          direction: { x: 0, y: 1 },
          damage: 10,
          fire: true,
        },
      ],
      800,
    );
    expect(sim.projectiles[0]).toMatchObject({
      speed: BRAZIERS.speed,
      size: BRAZIERS.size,
      hazard: "braziers",
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === "hazardHit")).toEqual([
      expect.objectContaining({ hazard: "braziers", damage: 10 }),
    ]);
  });
});

describe("the crypt's runes and braziers (D-123)", () => {
  const piece = (key: string) =>
    CRYPT_PIECES.find((p) => p.piece.key === key)!.piece;

  it("runes in the Chapel, Embalming room, and Charnel pit; braziers in the Catacomb, Burial vault, Tomb of kings", () => {
    const withRunes = CRYPT_PIECES.filter((p) => p.piece.runes?.length).map(
      (p) => p.piece.key,
    );
    const withFire = CRYPT_PIECES.filter((p) => p.piece.arrows?.fire).map(
      (p) => p.piece.key,
    );
    expect(withRunes.sort()).toEqual(["chapel", "charnel", "embalming"]);
    expect(withFire.sort()).toEqual(["catacomb", "kings", "vault"]);
    expect([...CRYPT_MECHANIC_ROOMS].sort()).toEqual(
      [...withRunes, ...withFire].sort(),
    );
  });

  it("runes keep off the entrance side and every obstacle, in columns counted from the west", () => {
    for (const key of ["chapel", "embalming", "charnel"]) {
      const p = piece(key);
      for (const r of p.runes!) {
        expect(r.at.x, key).toBeGreaterThanOrEqual(144);
        expect(r.column).toBe((r.at.x - 144) / RUNES.spacing);
        for (const o of p.obstacles ?? []) {
          const apart =
            r.at.x + RUNES.radius < o.x ||
            r.at.x - RUNES.radius > o.x + o.width ||
            r.at.y + RUNES.radius < o.y ||
            r.at.y - RUNES.radius > o.y + o.height;
          expect(apart, `${key} ${r.at.x},${r.at.y}`).toBe(true);
        }
      }
    }
  });

  it("those six rooms lose 20% of their skeletons and archers; ghosts, necromancers, knights stay", () => {
    const count = (key: string, kind: string) =>
      piece(key)
        .waves.flat()
        .filter((s) => s.kind === kind).length;
    // The Charnel pit: 16 skeletons and 8 archers; a knight and 2
    // necromancers swap in (15 + 6 = 21 left), then 20% of 21 (4) go,
    // skeletons first.
    expect(count("charnel", "skeleton")).toBe(15 - 4);
    expect(count("charnel", "archer")).toBe(6);
    expect(count("charnel", "knight")).toBe(1);
    expect(count("charnel", "necromancer")).toBe(2);
    // The Hall of the dead has no runes or braziers: unthinned (7,020 HP).
    expect(pieceHp(piece("deadhall"))).toBe(7020);
  });

  it("generated crypts carry them, turned with their rooms, and brazier fireballs do 10", () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const room of buildCrypt(seed).rooms) {
        if (room.arrows) {
          expect(room.arrows.fire, room.id).toBe(true);
          expect(room.arrows.damage).toBe(10);
        }
        for (const r of room.runes ?? []) {
          const b = room.bounds;
          expect(r.at.x).toBeGreaterThanOrEqual(b.x);
          expect(r.at.x).toBeLessThanOrEqual(b.x + b.width);
          expect(r.at.y).toBeGreaterThanOrEqual(b.y);
          expect(r.at.y).toBeLessThanOrEqual(b.y + b.height);
        }
      }
    }
  });
});
