import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { contains, validateLayout, type RoomDef } from "./dungeon-layout.ts";
import { layoutFor } from "./dungeons.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import {
  buildWarrens,
  GOBLIN_WARRENS,
  WARRENS_PIECES,
  WARRENS_RULES,
  type RoomBand,
} from "./goblin-warrens.ts";
import { seededRandom } from "./seeded-random.ts";
import { findLeak, mainPath, sideOf, touches } from "./layout-test-helpers.ts";

const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);

const bandOf = (room: RoomDef): RoomBand | undefined =>
  WARRENS_PIECES.find((p) => p.piece.key === room.id.replace(/-\d+$/, ""))
    ?.band;

describe("seeded random (T-050)", () => {
  it("the same seed gives the same numbers; different seeds differ", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});

describe("procedural Goblin Warrens (D-104)", () => {
  it("seed 0 is the handcrafted layout; a seed always rebuilds the same map", () => {
    expect(buildWarrens(0)).toBe(GOBLIN_WARRENS);
    expect(layoutFor("goblin-warrens", 0)).toBe(GOBLIN_WARRENS);
    for (const seed of [1, 77, 123456789, 4294967295]) {
      expect(buildWarrens(seed)).toEqual(buildWarrens(seed));
    }
    expect(buildWarrens(1)).not.toEqual(buildWarrens(2));
  });

  it("every one of 2,000 seeds passes validation without the fallback", () => {
    for (const seed of SEEDS) {
      const layout = buildWarrens(seed);
      expect(layout, `seed ${seed}`).not.toBe(GOBLIN_WARRENS);
      expect(validateLayout(layout), `seed ${seed}`).toEqual([]);
    }
  });

  it("follows the rules: entrance → light, medium, medium, heavy → throne, never west", () => {
    for (const seed of SEEDS) {
      const layout = buildWarrens(seed);
      const path = mainPath(layout);
      const where = `seed ${seed}`;
      expect(path.map((r) => r.id).at(0), where).toBe("entrance");
      expect(path.at(-1)?.id, where).toBe("throne");
      expect(path.slice(1, -1).map(bandOf), where).toEqual(
        WARRENS_RULES.mainPath,
      );
      expect(contains(path[0]!.bounds, layout.spawn), where).toBe(true);
      expect(contains(path.at(-1)!.bounds, layout.exitPortal!), where).toBe(
        true,
      );
      for (let i = 1; i < path.length; i++) {
        expect(sideOf(path[i - 1]!.bounds, path[i]!.bounds), where).not.toBe(
          "west",
        );
      }
      // Only the main path is required; the throne holds the Warlord.
      expect(layout.rooms.filter((r) => r.required).length, where).toBe(
        path.length,
      );
      expect(
        path
          .at(-1)!
          .waves.flat()
          .map((s) => s.kind),
        where,
      ).toEqual(["warlord"]);
      const hp = path.reduce((sum, r) => sum + pieceHp(r), 0);
      expect(hp, where).toBeGreaterThanOrEqual(WARRENS_RULES.requiredHp.min);
      expect(hp, where).toBeLessThanOrEqual(WARRENS_RULES.requiredHp.max);
    }
  });

  it("0–2 optional side rooms, light or medium, off combat rooms", () => {
    const counts = new Set<number>();
    for (const seed of SEEDS) {
      const layout = buildWarrens(seed);
      const path = new Set(mainPath(layout).map((r) => r.id));
      const side = layout.rooms.filter((r) => !path.has(r.id));
      counts.add(side.length);
      expect(side.length).toBeLessThanOrEqual(2);
      for (const room of side) {
        expect(room.required).toBe(false);
        expect(WARRENS_RULES.sideBands).toContain(bandOf(room));
        const door = layout.doors.find((d) => touches(room.bounds, d.rect))!;
        expect(["entrance", "throne"]).not.toContain(door.room);
        expect(path.has(door.room)).toBe(true);
      }
    }
    expect([...counts].sort()).toEqual([0, 1, 2]);
  });

  it("varies: turns north and south, and uses every piece", () => {
    const turns = new Set<string>();
    const pieces = new Set<string>();
    for (const seed of SEEDS.slice(0, 300)) {
      const layout = buildWarrens(seed);
      const path = mainPath(layout);
      for (let i = 1; i < path.length; i++) {
        turns.add(sideOf(path[i - 1]!.bounds, path[i]!.bounds));
      }
      for (const r of layout.rooms) pieces.add(r.id.replace(/-\d+$/, ""));
    }
    expect([...turns].sort()).toEqual(["east", "north", "south"]);
    for (const { piece } of WARRENS_PIECES) expect(pieces).toContain(piece.key);
  });

  it("has no gaps in its walls: with every door open, you stay inside rooms and doorways", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      expect(findLeak(buildWarrens(seed)), `seed ${seed}`).toBeNull();
    }
  });
});

describe("the 11b room pool (D-105)", () => {
  const signature = (waves: RoomDef["waves"]) =>
    waves
      .flat()
      .map((s) => s.kind)
      .sort()
      .join(",");

  it("matches the approved table: bands and first-setup HP", () => {
    expect(
      Object.fromEntries(
        WARRENS_PIECES.map((p) => [p.piece.key, [p.band, pieceHp(p.piece)]]),
      ),
    ).toEqual({
      tunnel: ["light", 850],
      den: ["light", 930],
      passage: ["light", 760],
      grotto: ["light", 930],
      camp: ["medium", 1845],
      guard: ["medium", 2670],
      kitchen: ["medium", 1890],
      gallery: ["medium", 1930],
      ambush: ["heavy", 3380], // 3,455 before its second wave came from holes (D-109)
      pit: ["heavy", 3320],
      warcamp: ["heavy", 3100],
    });
  });

  it("every room has two setups, the second within ±10% of the first and a different mix", () => {
    for (const { piece, setups } of WARRENS_PIECES) {
      expect(setups, piece.key).toHaveLength(2);
      const first = pieceHp({ waves: setups[0]! });
      const second = pieceHp({ waves: setups[1]! });
      expect(Math.abs(second - first) / first, piece.key).toBeLessThanOrEqual(
        0.1,
      );
      expect(signature(setups[1]!), piece.key).not.toBe(signature(setups[0]!));
    }
  });

  it("every spawn of every setup sits inside its room", () => {
    for (const { piece, setups } of WARRENS_PIECES) {
      for (const s of setups.flat(2)) {
        const half = ENEMY_STATS[s.kind].size / 2;
        expect(s.at.x - half, piece.key).toBeGreaterThanOrEqual(0);
        expect(s.at.y - half, piece.key).toBeGreaterThanOrEqual(0);
        expect(s.at.x + half, piece.key).toBeLessThanOrEqual(piece.width);
        expect(s.at.y + half, piece.key).toBeLessThanOrEqual(piece.height);
      }
    }
  });

  it("every possible main path, with any setups, lands inside the HP band", () => {
    const hps = (band: RoomBand) =>
      WARRENS_PIECES.filter((p) => p.band === band).map((p) => ({
        key: p.piece.key,
        hp: p.setups.map((w) => pieceHp({ waves: w })),
      }));
    const throne = pieceHp(
      GOBLIN_WARRENS.rooms.find((r) => r.id === "throne")!,
    );
    const { min, max } = WARRENS_RULES.requiredHp;
    let paths = 0;
    for (const light of hps("light"))
      for (const m1 of hps("medium"))
        for (const m2 of hps("medium")) {
          if (m1.key === m2.key) continue;
          for (const heavy of hps("heavy"))
            for (const a of light.hp)
              for (const b of m1.hp)
                for (const c of m2.hp)
                  for (const d of heavy.hp) {
                    const total = a + b + c + d + throne;
                    expect(total).toBeGreaterThanOrEqual(min);
                    expect(total).toBeLessThanOrEqual(max);
                    paths++;
                  }
        }
    expect(paths).toBe(4 * 4 * 3 * 3 * 16);
  });

  it("generated maps use both setups of every room", () => {
    const seen = new Map<string, Set<string>>();
    for (const seed of SEEDS.slice(0, 400)) {
      for (const room of buildWarrens(seed).rooms) {
        const key = room.id.replace(/-\d+$/, "");
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(signature(room.waves));
      }
    }
    for (const { piece, setups } of WARRENS_PIECES) {
      expect([...(seen.get(piece.key) ?? [])].sort(), piece.key).toEqual(
        setups.map(signature).sort(),
      );
    }
  });
});
