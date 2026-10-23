import { boxAround } from "./collision.ts";
import { overlaps } from "./enemy-ai.ts";
import { ENEMY_STATS, type EnemyKind } from "./enemy-config.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { PLAYER_BODY } from "./movement-config.ts";

/** Wall thickness used when walls are generated around rooms. */
export const WALL_THICKNESS = 32;

export interface EnemySpawnDef {
  kind: EnemyKind;
  at: Vec2;
}

/**
 * One room (Phase 6b). It wakes when a living player's center is inside
 * `bounds`: wave 0 spawns; each later wave spawns once the previous one is
 * dead; after the last wave the room is cleared. A room with no waves is
 * cleared as soon as someone enters.
 */
export interface RoomDef {
  id: string;
  name: string;
  /** Floor area (inside the walls). */
  bounds: Rect;
  waves: readonly (readonly EnemySpawnDef[])[];
  /** The run completes when every required room is cleared (T-031). */
  required: boolean;
}

/** A gap in a wall that is blocked until `room` is cleared; doors never close again. */
export interface DoorDef {
  id: string;
  rect: Rect;
  room: string;
}

/** Everything both sides need to run and draw one dungeon. */
export interface DungeonLayout {
  world: { width: number; height: number };
  /** Static walls (door gaps already cut out). */
  walls: readonly Rect[];
  /** Where every party member starts (and late joiners appear). */
  spawn: Vec2;
  rooms: readonly RoomDef[];
  doors: readonly DoorDef[];
}

/**
 * Walls of `thickness` around every room, with each door's rectangle cut
 * out. Walls shared by neighboring rooms come out identical and are kept
 * once.
 */
export function wallsAroundRooms(
  rooms: readonly RoomDef[],
  doors: readonly DoorDef[],
  thickness = WALL_THICKNESS,
): Rect[] {
  const t = thickness;
  const out = new Map<string, Rect>();
  for (const { bounds: b } of rooms) {
    const sides: Rect[] = [
      { x: b.x - t, y: b.y - t, width: b.width + 2 * t, height: t },
      { x: b.x - t, y: b.y + b.height, width: b.width + 2 * t, height: t },
      { x: b.x - t, y: b.y, width: t, height: b.height },
      { x: b.x + b.width, y: b.y, width: t, height: b.height },
    ];
    for (const side of sides) {
      let pieces = [side];
      for (const door of doors) {
        pieces = pieces.flatMap((p) => cutAlongLength(p, door.rect));
      }
      for (const p of pieces)
        out.set(`${p.x},${p.y},${p.width},${p.height}`, p);
    }
  }
  return [...out.values()];
}

/** Removes the part of a long thin wall that `hole` covers, along its long axis. */
function cutAlongLength(wall: Rect, hole: Rect): Rect[] {
  if (!overlaps(wall, hole)) return [wall];
  const pieces: Rect[] = [];
  if (wall.width >= wall.height) {
    const left = hole.x - wall.x;
    const right = wall.x + wall.width - (hole.x + hole.width);
    if (left > 0) pieces.push({ ...wall, width: left });
    if (right > 0)
      pieces.push({ ...wall, x: hole.x + hole.width, width: right });
  } else {
    const top = hole.y - wall.y;
    const bottom = wall.y + wall.height - (hole.y + hole.height);
    if (top > 0) pieces.push({ ...wall, height: top });
    if (bottom > 0)
      pieces.push({ ...wall, y: hole.y + hole.height, height: bottom });
  }
  return pieces;
}

export function contains(r: Rect, p: Vec2): boolean {
  return p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
}

/** The room whose floor contains `p`, if any. */
export function roomAt(layout: DungeonLayout, p: Vec2): RoomDef | undefined {
  return layout.rooms.find((r) => contains(r.bounds, p));
}

/** True when `a` and `b` share an edge segment or overlap (closed rectangles). */
function touches(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/**
 * Structural checks (GDD §10: connectivity, reachable objectives). Returns
 * a list of problems; empty means valid.
 */
export function validateLayout(layout: DungeonLayout): string[] {
  const problems: string[] = [];
  const ids = new Set(layout.rooms.map((r) => r.id));
  if (ids.size !== layout.rooms.length) problems.push("duplicate room ids");

  const start = roomAt(layout, layout.spawn);
  if (!start) problems.push("spawn is not inside a room");
  const spawnBox = boxAround(layout.spawn, PLAYER_BODY.width);
  if (layout.walls.some((w) => overlaps(w, spawnBox))) {
    problems.push("spawn overlaps a wall");
  }

  for (const room of layout.rooms) {
    room.waves.forEach((wave, i) => {
      for (const s of wave) {
        const box = boxAround(s.at, ENEMY_STATS[s.kind].size);
        const inside =
          box.x >= room.bounds.x &&
          box.y >= room.bounds.y &&
          box.x + box.width <= room.bounds.x + room.bounds.width &&
          box.y + box.height <= room.bounds.y + room.bounds.height;
        if (!inside) {
          problems.push(
            `${room.id} wave ${i}: ${s.kind} at ${s.at.x},${s.at.y} is outside the room`,
          );
        } else if (layout.walls.some((w) => overlaps(w, box))) {
          problems.push(
            `${room.id} wave ${i}: ${s.kind} at ${s.at.x},${s.at.y} overlaps a wall`,
          );
        }
      }
    });
  }

  // Each door must join exactly two rooms, one of which opens it.
  const links: { a: string; b: string; opener: string }[] = [];
  for (const door of layout.doors) {
    const joined = layout.rooms.filter((r) => touches(r.bounds, door.rect));
    if (joined.length !== 2) {
      problems.push(`door ${door.id} joins ${joined.length} rooms, not 2`);
      continue;
    }
    const [a, b] = joined as [RoomDef, RoomDef];
    if (door.room !== a.id && door.room !== b.id) {
      problems.push(
        `door ${door.id} is opened by ${door.room}, which it does not touch`,
      );
    }
    links.push({ a: a.id, b: b.id, opener: door.room });
  }

  // Valid encounter order: starting in the spawn room, and assuming every
  // room reached can be cleared, opening doors must eventually reach every
  // room (no door whose opener is only reachable through that door).
  if (start) {
    const seen = new Set([start.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { a, b, opener } of links) {
        if (!seen.has(opener)) continue;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          if (seen.has(from) && !seen.has(to)) {
            seen.add(to);
            grew = true;
          }
        }
      }
    }
    for (const room of layout.rooms) {
      if (!seen.has(room.id)) problems.push(`room ${room.id} is unreachable`);
    }
  }
  if (!layout.rooms.some((r) => r.required)) {
    problems.push("no required room: the run could never complete");
  }
  return problems;
}
