import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import {
  contains,
  validateLayout,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import { layoutFor } from "./dungeons.ts";
import type { Rect } from "./geometry.ts";
import {
  buildWarrens,
  GOBLIN_WARRENS,
  WARRENS_PIECES,
  WARRENS_RULES,
  type RoomBand,
} from "./goblin-warrens.ts";
import { seededRandom } from "./seeded-random.ts";

const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);

const touches = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height;

/** The main path from the entrance to the throne, following its doors. */
function mainPath(layout: DungeonLayout): RoomDef[] {
  const byId = new Map(layout.rooms.map((r) => [r.id, r]));
  const path = [byId.get("entrance")!];
  for (;;) {
    const here = path.at(-1)!;
    const next = layout.doors
      .filter((d) => d.room === here.id)
      .flatMap((d) =>
        layout.rooms.filter((r) => r !== here && touches(r.bounds, d.rect)),
      )
      .find((r) => r.required);
    if (!next) return path;
    path.push(next);
  }
}

const bandOf = (room: RoomDef): RoomBand | undefined =>
  WARRENS_PIECES.find((p) => p.piece.key === room.id.replace(/-\d+$/, ""))
    ?.band;

/** Which side of `parent` the room `child` sits on. */
function sideOf(parent: Rect, child: Rect): string {
  if (child.x >= parent.x + parent.width) return "east";
  if (child.x + child.width <= parent.x) return "west";
  return child.y < parent.y ? "north" : "south";
}

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
    const CELL = 8;
    for (const seed of SEEDS.slice(0, 100)) {
      const layout = buildWarrens(seed);
      const cols = Math.ceil(layout.world.width / CELL);
      const rows = Math.ceil(layout.world.height / CELL);
      // Rasterize once: cells touched by a wall block; cells touched by a
      // room floor or a doorway are allowed.
      const paint = (rects: readonly Rect[]) => {
        const grid = new Uint8Array(cols * rows);
        for (const r of rects) {
          const c0 = Math.max(0, Math.floor(r.x / CELL));
          const r0 = Math.max(0, Math.floor(r.y / CELL));
          const c1 = Math.min(cols - 1, Math.ceil((r.x + r.width) / CELL) - 1);
          const r1 = Math.min(rows - 1, Math.ceil((r.y + r.height) / CELL) - 1);
          for (let y = r0; y <= r1; y++)
            for (let x = c0; x <= c1; x++) grid[y * cols + x] = 1;
        }
        return grid;
      };
      const blocked = paint(layout.walls);
      const allowed = paint([
        ...layout.rooms.map((r) => r.bounds),
        ...layout.doors.map((d) => d.rect),
      ]);
      const startCell =
        Math.floor(layout.spawn.y / CELL) * cols +
        Math.floor(layout.spawn.x / CELL);
      const seen = new Uint8Array(cols * rows);
      const queue = [startCell];
      seen[startCell] = 1;
      let leak: string | null = null;
      while (queue.length > 0 && !leak) {
        const cell = queue.pop()!;
        const c = cell % cols;
        const r = Math.floor(cell / cols);
        if (!allowed[cell]) leak = `open floor at ${c * CELL},${r * CELL}`;
        if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
          leak = "reached the world edge";
        }
        for (const next of [cell + 1, cell - 1, cell + cols, cell - cols]) {
          if (seen[next] || blocked[next]) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
      expect(leak, `seed ${seed}`).toBeNull();
    }
  });
});
