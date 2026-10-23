import { pieceHp } from "./dungeon-gen.ts";
import {
  contains,
  validateLayout,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import type { DungeonRecipe, RoomBand } from "./dungeon-recipe.ts";
import type { Rect } from "./geometry.ts";

/*
 * Shared checks for generated layouts (tests only): the Warrens and the
 * Stronghold are held to the same structural rules.
 */

export const touches = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height;

/** The main path from the entrance to the boss room, following its doors. */
export function mainPath(layout: DungeonLayout): RoomDef[] {
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

/** Which side of `parent` the room `child` sits on. */
export function sideOf(parent: Rect, child: Rect): string {
  if (child.x >= parent.x + parent.width) return "east";
  if (child.x + child.width <= parent.x) return "west";
  return child.y < parent.y ? "north" : "south";
}

export const bandIn = (
  recipe: DungeonRecipe,
  room: RoomDef,
): RoomBand | undefined =>
  recipe.pieces.find((p) => p.piece.key === room.id.replace(/-\d+$/, ""))?.band;

/** Everything about `layout` that breaks `recipe`'s rules; empty if none. */
export function recipeProblems(
  recipe: DungeonRecipe,
  layout: DungeonLayout,
): string[] {
  const problems = [...validateLayout(layout)];
  const path = mainPath(layout);
  const ids = path.map((r) => r.id);
  if (ids[0] !== "entrance") problems.push("does not start at the entrance");
  if (ids.at(-1) !== "throne") problems.push("does not end at the boss");
  const bands = path.slice(1, -1).map((r) => bandIn(recipe, r));
  if (JSON.stringify(bands) !== JSON.stringify(recipe.mainPath)) {
    problems.push(`main path bands ${bands.join(",")}`);
  }
  if (!contains(path[0]!.bounds, layout.spawn)) problems.push("spawn outside");
  if (!layout.exitPortal || !contains(path.at(-1)!.bounds, layout.exitPortal)) {
    problems.push("portal outside the boss room");
  }
  for (let i = 1; i < path.length; i++) {
    if (sideOf(path[i - 1]!.bounds, path[i]!.bounds) === "west") {
      problems.push(`turns west into ${path[i]!.id}`);
    }
  }
  if (layout.rooms.filter((r) => r.required).length !== path.length) {
    problems.push("a required room off the main path");
  }
  const bossKinds = path
    .at(-1)!
    .waves.flat()
    .map((s) => s.kind);
  const wanted = recipe.boss.waves.flat().map((s) => s.kind);
  if (JSON.stringify(bossKinds) !== JSON.stringify(wanted)) {
    problems.push("wrong boss");
  }
  const hp = path.reduce((sum, r) => sum + pieceHp(r), 0);
  if (hp < recipe.requiredHp.min || hp > recipe.requiredHp.max) {
    problems.push(`required HP ${hp}`);
  }
  const onPath = new Set(ids);
  const side = layout.rooms.filter((r) => !onPath.has(r.id));
  if (side.length > recipe.sideRooms.max) problems.push("too many side rooms");
  for (const room of side) {
    if (room.required) problems.push(`side room ${room.id} required`);
    const band = bandIn(recipe, room);
    if (!band || !recipe.sideBands.includes(band)) {
      problems.push(`side room ${room.id} band ${band}`);
    }
    const door = layout.doors.find((d) => touches(room.bounds, d.rect));
    if (
      !door ||
      !onPath.has(door.room) ||
      ["entrance", "throne"].includes(door.room)
    ) {
      problems.push(`side room ${room.id} not off a combat room`);
    }
  }
  return problems;
}

/**
 * Flood fill from the spawn with every door open: the first open floor
 * outside all rooms and doorways (a gap in the walls), or null.
 */
export function findLeak(layout: DungeonLayout, cell = 8): string | null {
  const cols = Math.ceil(layout.world.width / cell);
  const rows = Math.ceil(layout.world.height / cell);
  const paint = (rects: readonly Rect[]) => {
    const grid = new Uint8Array(cols * rows);
    for (const r of rects) {
      const c0 = Math.max(0, Math.floor(r.x / cell));
      const r0 = Math.max(0, Math.floor(r.y / cell));
      const c1 = Math.min(cols - 1, Math.ceil((r.x + r.width) / cell) - 1);
      const r1 = Math.min(rows - 1, Math.ceil((r.y + r.height) / cell) - 1);
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
  const start =
    Math.floor(layout.spawn.y / cell) * cols +
    Math.floor(layout.spawn.x / cell);
  const seen = new Uint8Array(cols * rows);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const here = queue.pop()!;
    const c = here % cols;
    const r = Math.floor(here / cols);
    if (!allowed[here]) return `open floor at ${c * cell},${r * cell}`;
    if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
      return "reached the world edge";
    }
    for (const next of [here + 1, here - 1, here + cols, here - cols]) {
      if (seen[next] || blocked[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return null;
}

/**
 * Flood fill from the spawn with every door open (D-112): the first open
 * floor cell of any room that cannot be reached (sealed off by obstacles),
 * or null if every room's open floor is reachable.
 */
export function findSealedFloor(
  layout: DungeonLayout,
  cell = 8,
): string | null {
  const cols = Math.ceil(layout.world.width / cell);
  const rows = Math.ceil(layout.world.height / cell);
  const blocked = new Uint8Array(cols * rows);
  for (const r of layout.walls) {
    const c0 = Math.max(0, Math.floor(r.x / cell));
    const r0 = Math.max(0, Math.floor(r.y / cell));
    const c1 = Math.min(cols - 1, Math.ceil((r.x + r.width) / cell) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((r.y + r.height) / cell) - 1);
    for (let y = r0; y <= r1; y++)
      for (let x = c0; x <= c1; x++) blocked[y * cols + x] = 1;
  }
  const start =
    Math.floor(layout.spawn.y / cell) * cols +
    Math.floor(layout.spawn.x / cell);
  const seen = new Uint8Array(cols * rows);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const here = queue.pop()!;
    for (const next of [here + 1, here - 1, here + cols, here - cols]) {
      if (next < 0 || next >= cols * rows || seen[next] || blocked[next])
        continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  for (const room of layout.rooms) {
    const b = room.bounds;
    for (
      let y = Math.ceil(b.y / cell);
      y < Math.floor((b.y + b.height) / cell);
      y++
    ) {
      for (
        let x = Math.ceil(b.x / cell);
        x < Math.floor((b.x + b.width) / cell);
        x++
      ) {
        const i = y * cols + x;
        if (!blocked[i] && !seen[i])
          return `${room.id}: sealed floor at ${x * cell},${y * cell}`;
      }
    }
  }
  return null;
}
