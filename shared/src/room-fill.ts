import type { RoomPiece } from "./dungeon-gen.ts";
import type { EnemySpawnDef } from "./dungeon-layout.ts";
import type { RecipePiece, RoomBand } from "./dungeon-recipe.ts";
import { ENEMY_STATS, type EnemyKind } from "./enemy-config.ts";
import type { Rect } from "./geometry.ts";

/*
 * Placing a generated room's enemies (D-130, reused by every dungeon after
 * the forge): `front` kinds spread over the front and middle of the room,
 * `back` kinds along its far side, every spawn box clear of the room's
 * obstacles, lava, and other blocked floor. The entrance is on the west.
 */

/** Spawn boxes keep this far clear of blocked floor. */
export const SPAWN_CLEAR = 8;

/** Grid step between candidate spawns. */
const STEP = 56;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Is a spawn box of `size` at (x, y) clear of every blocked rect? */
export function clearAt(
  x: number,
  y: number,
  size: number,
  blocked: readonly Rect[],
): boolean {
  const half = size / 2 + SPAWN_CLEAR;
  return blocked.every(
    (r) =>
      !overlaps(r, {
        x: x - half,
        y: y - half,
        width: 2 * half,
        height: 2 * half,
      }),
  );
}

/** Every grid point of a range, a step apart. */
const steps = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.floor((to - from) / step) + 1 },
    (_, i) => from + i * step,
  );

/**
 * The kinds in the order they take the picked spots: each kind spread
 * evenly through the list, so (say) two spearmen among eight acolytes are
 * not side by side. With one kind this is simply that kind.
 */
function interleave(
  groups: readonly (readonly [EnemyKind, number])[],
): EnemyKind[] {
  return groups
    .flatMap(([kind, n], g) =>
      Array.from({ length: n }, (_, k) => ({ kind, at: (k + 0.5) / n, g })),
    )
    .sort((a, b) => a.at - b.at || a.g - b.g)
    .map((m) => m.kind);
}

/**
 * The room's one wave. Deterministic; throws if the room has no room for
 * them. With `front: [["imp", n]]` and `back: [["caster", m]]` this is the
 * forge's original placement.
 */
export function fillRoom(
  width: number,
  height: number,
  front: readonly (readonly [EnemyKind, number])[],
  back: readonly (readonly [EnemyKind, number])[],
  blocked: readonly Rect[],
): EnemySpawnDef[] {
  const size = Math.max(
    ENEMY_STATS.imp.size,
    ...[...front, ...back].map(([k]) => ENEMY_STATS[k].size),
  );
  const free = (x: number, y: number) => clearAt(x, y, size, blocked);
  const pick = (spots: [number, number][], kinds: EnemyKind[]) => {
    const n = kinds.length;
    if (spots.length < n) {
      throw new Error(`no room for ${n} enemies in a ${width}×${height} room`);
    }
    // Evenly through the free spots, so they spread over the room.
    return kinds.map((kind, k) => {
      const [x, y] = spots[Math.floor(((k + 0.5) * spots.length) / n)]!;
      return { kind, at: { x, y } };
    });
  };
  const ys = steps(72, height - 72, STEP);
  const frontSpots = steps(176, width - 200, STEP).flatMap((x) =>
    ys.filter((y) => free(x, y)).map((y): [number, number] => [x, y]),
  );
  const backSpots = [width - 80, width - 140].flatMap((x) =>
    ys.filter((y) => free(x, y)).map((y): [number, number] => [x, y]),
  );
  return [
    ...pick(frontSpots, interleave(front)),
    ...pick(backSpots, interleave(back)),
  ];
}

/** A band's enemies (D-135): those in front, and those along the back. */
export interface Mix {
  front: [EnemyKind, number][];
  back: [EnemyKind, number][];
}

/** A room's terrain and traps, relative like the spawns. */
export type Terrain = Omit<
  RoomPiece,
  "key" | "name" | "width" | "height" | "waves"
>;

/**
 * A generated room filled with one band's mix (the Sunken Temple and the
 * endgame dungeons): spawns kept clear of its obstacles and lava.
 */
export function mixedRoom(
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  mix: Mix,
  terrain: Terrain = {},
): RecipePiece {
  const blocked: Rect[] = [
    ...(terrain.obstacles ?? []),
    ...(terrain.lava ?? []),
  ];
  const waves = [fillRoom(width, height, mix.front, mix.back, blocked)];
  return {
    piece: { key, name, width, height, waves, ...terrain },
    band,
    setups: [waves],
  };
}
