import {
  WALL_THICKNESS,
  wallsAroundRooms,
  type DoorDef,
  type DungeonLayout,
  type EnemySpawnDef,
  type RoomDef,
  type RuneSpot,
} from "./dungeon-layout.ts";
import { overlaps } from "./enemy-ai.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { randomInt } from "./seeded-random.ts";

/*
 * Procedural assembly from handcrafted rooms (Phase 11, D-104). A piece is
 * a room drawn with its entrance on the west side; placing it rotates it
 * so the entrance faces the room it was attached to. Rooms join directly
 * through a door in the shared wall (no corridors), and the door opens when
 * the room it was attached from is cleared, like the handcrafted Warrens.
 */

export type Side = "north" | "south" | "east" | "west";

export const OPPOSITE: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** A reusable room: floor size and waves, entrance on the west side. */
export interface RoomPiece {
  key: string;
  name: string;
  width: number;
  height: number;
  /** Spawn points relative to the floor's top-left corner. */
  waves: readonly (readonly EnemySpawnDef[])[];
  /** Boulders fall while it fights (D-110). */
  rockfall?: boolean;
  /** Its doors shut behind you until it is cleared (D-114). */
  gated?: boolean;
  /** Solid obstacles on its floor, relative like the spawns (D-112). */
  obstacles?: readonly Rect[];
  /** Sludge pools, relative like the spawns (D-113). */
  sludge?: readonly Rect[];
  /** Lava channels, relative like the spawns (D-128). */
  lava?: readonly Rect[];
  /** An arrow trap's slits and firing direction, relative (D-113); `fire`: spirit braziers (D-123). */
  arrows?: { slits: readonly Vec2[]; direction: Vec2; fire?: boolean };
  /** Cursed runes on the floor, relative, each in a column (D-123). */
  runes?: readonly RuneSpot[];
  /** Ambush holes and the wave that comes out of them (D-109). */
  holes?: readonly Vec2[];
  holeWave?: number;
}

/** Door gap, as in the handcrafted Warrens. */
export const DOOR_WIDTH = 64;
/** A door keeps at least a wall's thickness from either room's corners. */
const DOOR_MARGIN = WALL_THICKNESS;
/** Two joined rooms share at least this much wall, so a door fits. */
const MIN_SHARED = DOOR_WIDTH + 2 * DOOR_MARGIN;
/** Room positions snap to this grid (tidier numbers, same variety). */
const SNAP = 8;
/** Offsets tried along a side before giving up on it. */
const PLACEMENT_TRIES = 8;
/** Empty space around the outermost walls. */
const WORLD_MARGIN = 100;

/** Total enemy HP of a room's waves, for one player (party scaling 1×). */
export function pieceHp(piece: Pick<RoomPiece, "waves">): number {
  return piece.waves
    .flat()
    .reduce((sum, s) => sum + ENEMY_STATS[s.kind].maxHp, 0);
}

/** The piece's size and spawn points once its entrance faces `entry`. */
function orient(
  piece: RoomPiece,
  entry: Side,
): {
  width: number;
  height: number;
  waves: EnemySpawnDef[][];
  holes: Vec2[];
  obstacles: Rect[];
  sludge: Rect[];
  lava: Rect[];
  arrows: { slits: Vec2[]; direction: Vec2; fire?: boolean } | null;
  runes: RuneSpot[];
} {
  const { width: w, height: h } = piece;
  const map: Record<Side, (p: Vec2) => Vec2> = {
    west: (p) => p,
    east: (p) => ({ x: w - p.x, y: h - p.y }),
    south: (p) => ({ x: p.y, y: w - p.x }),
    north: (p) => ({ x: h - p.y, y: p.x }),
  };
  const turned = entry === "north" || entry === "south";
  return {
    width: turned ? h : w,
    height: turned ? w : h,
    waves: piece.waves.map((wave) =>
      wave.map((s) => ({ ...s, at: map[entry](s.at) })),
    ),
    holes: (piece.holes ?? []).map((h) => map[entry](h)),
    obstacles: (piece.obstacles ?? []).map(turnRect),
    sludge: (piece.sludge ?? []).map(turnRect),
    lava: (piece.lava ?? []).map(turnRect),
    arrows: piece.arrows
      ? {
          slits: piece.arrows.slits.map((p) => map[entry](p)),
          // A direction turns like the difference of two turned points.
          direction: (() => {
            const o = map[entry]({ x: 0, y: 0 });
            const d = map[entry](piece.arrows.direction);
            return { x: d.x - o.x, y: d.y - o.y };
          })(),
          ...(piece.arrows.fire ? { fire: true } : {}),
        }
      : null,
    // A rune keeps its column, so the sweep runs the same way however
    // the room is turned.
    runes: (piece.runes ?? []).map((r) => ({ ...r, at: map[entry](r.at) })),
  };
  function turnRect(r: Rect): Rect {
    // Turn two opposite corners, then take the box between them.
    const a = map[entry]({ x: r.x, y: r.y });
    const c = map[entry]({ x: r.x + r.width, y: r.y + r.height });
    return {
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      width: Math.abs(a.x - c.x),
      height: Math.abs(a.y - c.y),
    };
  }
}

interface Placed {
  room: RoomDef;
  /** Sides that already have a door. */
  used: Set<Side>;
  parent: number | null;
}

/**
 * A room's trap fields, present only when it has them (rockfall damage is
 * set per dungeon once the map is built, D-110).
 */
function traps(
  rockfall: boolean,
  holes: Vec2[],
  holeWave: number | undefined,
  damage = 0,
): Pick<RoomDef, "rockfall" | "holes" | "holeWave"> {
  return {
    ...(rockfall ? { rockfall: { damage } } : {}),
    ...(holes.length > 0 ? { holes } : {}),
    ...(holeWave !== undefined ? { holeWave } : {}),
  };
}

const grow = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  width: r.width + 2 * by,
  height: r.height + 2 * by,
});

/**
 * Builds a dungeon room by room. Rooms that are not joined by a door keep
 * their walls apart, so a door can never cut into a third room's wall.
 */
export class RoomAssembly {
  private readonly placed: Placed[] = [];
  private readonly doors: DoorDef[] = [];
  private readonly random: () => number;

  constructor(start: RoomPiece, id: string, random: () => number) {
    this.random = random;
    const o = orient(start, "west");
    this.placed.push({
      room: {
        id,
        name: start.name,
        bounds: { x: 0, y: 0, width: o.width, height: o.height },
        waves: o.waves,
        required: true,
      },
      used: new Set(),
      parent: null,
    });
  }

  get count(): number {
    return this.placed.length;
  }

  /** Sides of room `index` that have no door yet. */
  freeSides(index: number): Side[] {
    const used = this.placed[index]!.used;
    return (["north", "south", "east", "west"] as const).filter(
      (s) => !used.has(s),
    );
  }

  /**
   * Places `piece` on `side` of room `parentIndex`, joined by a door that
   * opens when the parent is cleared. Returns the new room's index, or null
   * if it does not fit there.
   */
  attach(
    parentIndex: number,
    side: Side,
    piece: RoomPiece,
    id: string,
    required: boolean,
  ): number | null {
    const parent = this.placed[parentIndex]!;
    if (parent.used.has(side)) return null;
    const p = parent.room.bounds;
    const o = orient(piece, OPPOSITE[side]);
    const t = WALL_THICKNESS;
    const horizontal = side === "east" || side === "west";
    // Slide the new room along the parent's side, keeping MIN_SHARED.
    const [from, to] = horizontal
      ? [p.y - o.height + MIN_SHARED, p.y + p.height - MIN_SHARED]
      : [p.x - o.width + MIN_SHARED, p.x + p.width - MIN_SHARED];
    const lo = Math.ceil(from / SNAP);
    const hi = Math.floor(to / SNAP);
    if (lo > hi) return null;
    for (let i = 0; i < PLACEMENT_TRIES; i++) {
      const along = randomInt(this.random, lo, hi) * SNAP;
      const corner: Vec2 = {
        east: { x: p.x + p.width + t, y: along },
        west: { x: p.x - t - o.width, y: along },
        south: { x: along, y: p.y + p.height + t },
        north: { x: along, y: p.y - t - o.height },
      }[side];
      const bounds: Rect = { ...corner, width: o.width, height: o.height };
      const clash = this.placed.some(
        (q, qi) =>
          qi !== parentIndex &&
          overlaps(grow(q.room.bounds, t), grow(bounds, t)),
      );
      if (clash) continue;

      // The door sits on the shared stretch of wall, clear of corners.
      const [aStart, aEnd, bStart, bEnd] = horizontal
        ? [p.y, p.y + p.height, bounds.y, bounds.y + bounds.height]
        : [p.x, p.x + p.width, bounds.x, bounds.x + bounds.width];
      const shared = [Math.max(aStart, bStart), Math.min(aEnd, bEnd)] as const;
      const half = DOOR_WIDTH / 2;
      const center = randomInt(
        this.random,
        shared[0] + DOOR_MARGIN + half,
        shared[1] - DOOR_MARGIN - half,
      );
      const rect: Rect = {
        east: {
          x: p.x + p.width,
          y: center - half,
          width: t,
          height: DOOR_WIDTH,
        },
        west: { x: p.x - t, y: center - half, width: t, height: DOOR_WIDTH },
        south: {
          x: center - half,
          y: p.y + p.height,
          width: DOOR_WIDTH,
          height: t,
        },
        north: { x: center - half, y: p.y - t, width: DOOR_WIDTH, height: t },
      }[side];

      const shift = (v: Vec2): Vec2 => ({
        x: bounds.x + v.x,
        y: bounds.y + v.y,
      });
      const waves = o.waves.map((wave) =>
        wave.map((s) => ({ ...s, at: shift(s.at) })),
      );
      this.placed.push({
        room: {
          id,
          name: piece.name,
          bounds,
          waves,
          required,
          ...traps(piece.rockfall === true, o.holes.map(shift), piece.holeWave),
          ...(piece.gated ? { gated: true } : {}),
          ...(o.obstacles.length > 0
            ? { obstacles: o.obstacles.map((r) => ({ ...r, ...shift(r) })) }
            : {}),
          ...(o.sludge.length > 0
            ? { sludge: o.sludge.map((r) => ({ ...r, ...shift(r) })) }
            : {}),
          ...(o.lava.length > 0
            ? { lava: o.lava.map((r) => ({ ...r, ...shift(r) })) }
            : {}),
          ...(o.arrows
            ? {
                arrows: {
                  slits: o.arrows.slits.map(shift),
                  direction: o.arrows.direction,
                  damage: 0,
                  ...(o.arrows.fire ? { fire: true } : {}),
                },
              }
            : {}),
          ...(o.runes.length > 0
            ? { runes: o.runes.map((r) => ({ ...r, at: shift(r.at) })) }
            : {}),
        },
        used: new Set([OPPOSITE[side]]),
        parent: parentIndex,
      });
      parent.used.add(side);
      this.doors.push({
        id: `${parent.room.id}-${id}`,
        rect,
        room: parent.room.id,
      });
      return this.placed.length - 1;
    }
    return null;
  }

  /**
   * The finished layout, moved so the outermost walls sit WORLD_MARGIN
   * from the world's edge. Players start at the centre of the first room;
   * the exit portal is at the centre of room `portalRoom`.
   */
  finish(portalRoom: number): DungeonLayout {
    const all = this.placed.map((q) => q.room.bounds);
    const minX = Math.min(...all.map((b) => b.x));
    const minY = Math.min(...all.map((b) => b.y));
    const maxX = Math.max(...all.map((b) => b.x + b.width));
    const maxY = Math.max(...all.map((b) => b.y + b.height));
    const dx = WORLD_MARGIN + WALL_THICKNESS - minX;
    const dy = WORLD_MARGIN + WALL_THICKNESS - minY;
    const move = (v: Vec2): Vec2 => ({ x: v.x + dx, y: v.y + dy });
    const moveRect = (r: Rect): Rect => ({ ...r, ...move(r) });
    const center = (r: Rect): Vec2 => ({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    });

    const rooms: RoomDef[] = this.placed.map(({ room }) => ({
      ...room,
      bounds: moveRect(room.bounds),
      waves: room.waves.map((wave) =>
        wave.map((s) => ({ ...s, at: move(s.at) })),
      ),
      ...traps(
        room.rockfall !== undefined,
        (room.holes ?? []).map(move),
        room.holeWave,
        room.rockfall?.damage,
      ),
      ...(room.obstacles ? { obstacles: room.obstacles.map(moveRect) } : {}),
      ...(room.sludge ? { sludge: room.sludge.map(moveRect) } : {}),
      ...(room.lava ? { lava: room.lava.map(moveRect) } : {}),
      ...(room.arrows
        ? { arrows: { ...room.arrows, slits: room.arrows.slits.map(move) } }
        : {}),
      ...(room.runes
        ? { runes: room.runes.map((r) => ({ ...r, at: move(r.at) })) }
        : {}),
    }));
    const doors = this.doors.map((d) => ({ ...d, rect: moveRect(d.rect) }));
    return {
      world: {
        width: maxX + dx + WALL_THICKNESS + WORLD_MARGIN,
        height: maxY + dy + WALL_THICKNESS + WORLD_MARGIN,
      },
      // Obstacles are solid like walls (D-112).
      walls: [
        ...wallsAroundRooms(rooms, doors),
        ...rooms.flatMap((r) => r.obstacles ?? []),
      ],
      spawn: center(rooms[0]!.bounds),
      rooms,
      doors,
      exitPortal: center(rooms[portalRoom]!.bounds),
    };
  }
}
