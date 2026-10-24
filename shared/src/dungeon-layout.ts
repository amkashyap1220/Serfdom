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
  /** A slinger that aims where you will be, not where you are (D-109). */
  leads?: boolean;
}

/**
 * Rockfall rooms (D-110): while one fights, a boulder falls every
 * `everySeconds`: most anywhere on its floor, `nearShare` of them within
 * `nearRadius` of a player in the room. Each shows its shadow for
 * `warnSeconds`, then lands, hitting everyone within `radius`.
 */
/** Sludge slows players standing in it (D-113); goblins are used to it. */
export const SLUDGE = { speedFactor: 0.6 } as const;

/**
 * Arrow traps (D-113): the slits glow for `warnSeconds`, then all fire at
 * once except `gap` neighbouring slits; again every `everySeconds`.
 */
export const ARROWS = {
  everySeconds: 3.5,
  warnSeconds: 0.8,
  gap: 3,
  speed: 260,
  size: 6,
} as const;

/**
 * Spirit braziers (D-123): arrow traps' timing and look for fire. Every
 * `everySeconds` alternate braziers glow for `warnSeconds`, then each
 * sends a slow fireball straight across the room.
 */
export const BRAZIERS = {
  everySeconds: 3,
  warnSeconds: 0.8,
  speed: 140,
  size: 10,
} as const;

/**
 * Cursed runes (D-123): while the room fights, one column of runes at a
 * time glows for `warnSeconds`, then bursts for `damage` on anyone within
 * `radius`; the next column starts `everySeconds` later, sweeping west to
 * east and back.
 */
export const RUNES = {
  radius: 32,
  spacing: 96,
  warnSeconds: 1,
  everySeconds: 1.2,
  damage: 12,
} as const;

/** One cursed rune: where, and which column of the sweep it is in. */
export interface RuneSpot {
  at: Vec2;
  column: number;
}

/**
 * Lava channels (D-130): a player whose hurtbox touches one burns for
 * `damage` every `tickSeconds`; enemies treat lava as wall and walk round.
 */
export const LAVA = { tickSeconds: 0.5, damage: 4 } as const;

/** Every lava channel in the dungeon (D-130). */
export function lavaPools(layout: DungeonLayout): Rect[] {
  return layout.rooms.flatMap((r) => [...(r.lava ?? [])]);
}

/** Every sludge pool in the dungeon (players' movement checks these). */
export function sludgePools(layout: DungeonLayout): Rect[] {
  return layout.rooms.flatMap((r) => [...(r.sludge ?? [])]);
}

/** Obstacles keep at least this far from a room's walls, so no doorway is blocked (D-112). */
export const OBSTACLE_MARGIN = 64;

export const ROCKFALL = {
  /** D-111: was 0.7 s. */
  everySeconds: 1.05,
  nearShare: 0.25,
  nearRadius: 120,
  warnSeconds: 1.2,
  radius: 28,
} as const;

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
  /**
   * On the main path (T-031). Since D-114 only the boss room, the one holding
   * the exit portal, must be cleared to complete; others can be rushed past.
   */
  required: boolean;
  /** Locks you in while it fights: all its doors shut until cleared (D-114). */
  gated?: boolean;
  /** A rockfall room and the damage of one boulder (D-110). */
  rockfall?: { damage: number };
  /**
   * Obstacles on its floor (D-112): solid like walls (they are also in the
   * layout's walls), blocking movement and every shot.
   */
  obstacles?: readonly Rect[];
  /** Sludge pools (D-113): players standing in one move at SLUDGE.speedFactor. */
  sludge?: readonly Rect[];
  /** Lava channels (D-130): burn players, block enemies. */
  lava?: readonly Rect[];
  /**
   * An arrow trap (D-113): slits just inside one wall, all firing across the
   * room in `direction` but for a gap, every ARROWS.everySeconds while it
   * fights.
   */
  arrows?: {
    slits: readonly Vec2[];
    direction: Vec2;
    damage: number;
    /** Spirit braziers (D-123): slow fireballs, alternate braziers in turn. */
    fire?: boolean;
  };
  /** Cursed runes (D-123): columns glow and burst in a sweep while it fights. */
  runes?: readonly RuneSpot[];
  /**
   * Ambush holes (D-109): floor points just inside its walls. Wave
   * `holeWave` does not appear at once: its goblins come out of the holes,
   * a few at a time.
   */
  holes?: readonly Vec2[];
  holeWave?: number;
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
  /**
   * Opens once every required room is cleared; each player completes the
   * run by stepping into it (D-057). Null: the run completes for everyone
   * the moment the required rooms are cleared (test fixtures).
   */
  exitPortal: Vec2 | null;
}

/** A player completes when their center is this close to the portal's center. */
export const PORTAL_RADIUS = 24;

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
      // A hole wave comes out beside its holes; its listed spots are unused.
      if (i === room.holeWave) return;
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
        } else if ((room.lava ?? []).some((l) => overlaps(l, box))) {
          problems.push(
            `${room.id} wave ${i}: ${s.kind} at ${s.at.x},${s.at.y} starts in lava`,
          );
        }
      }
    });
  }

  for (const room of layout.rooms) {
    for (const o of room.obstacles ?? []) {
      const b = room.bounds;
      const m = OBSTACLE_MARGIN;
      if (
        o.x < b.x + m ||
        o.y < b.y + m ||
        o.x + o.width > b.x + b.width - m ||
        o.y + o.height > b.y + b.height - m
      ) {
        problems.push(
          `${room.id}: obstacle at ${o.x},${o.y} is too close to a wall`,
        );
      }
      if (
        !layout.walls.some(
          (w) =>
            w.x === o.x &&
            w.y === o.y &&
            w.width === o.width &&
            w.height === o.height,
        )
      ) {
        problems.push(
          `${room.id}: obstacle at ${o.x},${o.y} is not solid (missing from the walls)`,
        );
      }
      // Goblins come out side by side beside a hole: keep that clear.
      for (const hole of room.holes ?? []) {
        if (overlaps(o, boxAround(hole, 64))) {
          problems.push(
            `${room.id}: an obstacle blocks the hole at ${hole.x},${hole.y}`,
          );
        }
      }
    }
    const b = room.bounds;
    const within = (r: Rect) =>
      r.x >= b.x &&
      r.y >= b.y &&
      r.x + r.width <= b.x + b.width &&
      r.y + r.height <= b.y + b.height;
    for (const pool of room.sludge ?? []) {
      if (!within(pool)) problems.push(`${room.id}: sludge outside the room`);
    }
    // Lava keeps clear of the walls (so doorways stay open), like obstacles.
    for (const l of room.lava ?? []) {
      const m = OBSTACLE_MARGIN;
      if (
        l.x < b.x + m ||
        l.y < b.y + m ||
        l.x + l.width > b.x + b.width - m ||
        l.y + l.height > b.y + b.height - m
      ) {
        problems.push(
          `${room.id}: lava at ${l.x},${l.y} is too close to a wall`,
        );
      }
    }
    if (room.arrows) {
      const { slits, direction } = room.arrows;
      if (Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-9) {
        problems.push(`${room.id}: arrow direction is not a unit vector`);
      }
      if (room.arrows.fire ? slits.length < 2 : slits.length <= ARROWS.gap) {
        problems.push(
          `${room.id}: an arrow trap needs more slits than its gap`,
        );
      }
      for (const s of slits) {
        const edge = Math.min(
          s.x - b.x,
          s.y - b.y,
          b.x + b.width - s.x,
          b.y + b.height - s.y,
        );
        if (!contains(b, s) || edge > 20) {
          problems.push(
            `${room.id}: arrow slit at ${s.x},${s.y} is not just inside a wall`,
          );
        }
      }
    }
    for (const r of room.runes ?? []) {
      if (!contains(b, r.at) || !Number.isInteger(r.column) || r.column < 0) {
        problems.push(
          `${room.id}: rune at ${r.at.x},${r.at.y} is not on its floor`,
        );
      }
    }
    if (room.holeWave !== undefined) {
      if (!room.holes || room.holes.length === 0) {
        problems.push(`${room.id}: a hole wave but no holes`);
      }
      if (room.holeWave >= room.waves.length) {
        problems.push(`${room.id}: hole wave ${room.holeWave} does not exist`);
      }
    }
    for (const hole of room.holes ?? []) {
      const b = room.bounds;
      const edge = Math.min(
        hole.x - b.x,
        hole.y - b.y,
        b.x + b.width - hole.x,
        b.y + b.height - hole.y,
      );
      if (!contains(b, hole) || edge > 40) {
        problems.push(
          `${room.id}: hole at ${hole.x},${hole.y} is not just inside a wall`,
        );
      }
    }
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
  if (layout.exitPortal) {
    if (!roomAt(layout, layout.exitPortal)) {
      problems.push("exit portal is not inside a room");
    }
    const box = boxAround(layout.exitPortal, PORTAL_RADIUS * 2);
    if (layout.walls.some((w) => overlaps(w, box))) {
      problems.push("exit portal overlaps a wall");
    }
  }
  if (!layout.rooms.some((r) => r.required)) {
    problems.push("no required room: the run could never complete");
  }
  return problems;
}
