import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout, EnemySpawnDef } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
} from "./dungeon-recipe.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import { CRYPT_SANCTUM } from "./forgotten-crypt.ts";
import type { Rect } from "./geometry.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";

/*
 * The Ember Forge (D-130, Phase 13a): the fourth dungeon, levels 15–18,
 * opened by completing the Warrens (D-107). Forge imps (the skulker's
 * flanking) and ember casters (the bomber's lob) among lava channels that
 * burn players and that enemies walk round. 13b adds fire elementals,
 * magma golems, and bellows-keepers; 13c fire jets and slag spills; 13d
 * the Forgemaster. Until then the Lich stands in as the boss.
 */

/** Spawn boxes keep this far clear of obstacles and lava. */
const CLEAR = 8;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Every grid point of a range, a step apart. */
const steps = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.floor((to - from) / step) + 1 },
    (_, i) => from + i * step,
  );

/**
 * \`imps\` imps spread over the front and middle of the room and \`casters\`
 * ember casters along the back, every spawn clear of the room's obstacles
 * and lava. Deterministic; throws if the room has no room for them.
 */
function fill(
  width: number,
  height: number,
  imps: number,
  casters: number,
  blocked: readonly Rect[],
): EnemySpawnDef[] {
  const half = ENEMY_STATS.imp.size / 2 + CLEAR;
  const free = (x: number, y: number) =>
    blocked.every(
      (r) =>
        !overlaps(r, {
          x: x - half,
          y: y - half,
          width: 2 * half,
          height: 2 * half,
        }),
    );
  const pick = (spots: [number, number][], n: number, what: string) => {
    if (spots.length < n) {
      throw new Error(`no room for ${n} ${what} in a ${width}×${height} room`);
    }
    // Evenly through the free spots, so they spread over the room.
    return Array.from(
      { length: n },
      (_, k) => spots[Math.floor(((k + 0.5) * spots.length) / n)]!,
    );
  };
  const ys = steps(72, height - 72, 56);
  const front = steps(176, width - 200, 56).flatMap((x) =>
    ys.filter((y) => free(x, y)).map((y): [number, number] => [x, y]),
  );
  const back = [width - 80, width - 140].flatMap((x) =>
    ys.filter((y) => free(x, y)).map((y): [number, number] => [x, y]),
  );
  return [
    ...pick(front, imps, "imps").map(([x, y]) => ({
      kind: "imp" as const,
      at: { x, y },
    })),
    ...pick(back, casters, "casters").map(([x, y]) => ({
      kind: "caster" as const,
      at: { x, y },
    })),
  ];
}

const room = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  [imps, casters]: [number, number],
  traps: Pick<RoomPiece, "obstacles" | "lava"> = {},
): RecipePiece => {
  const waves = [
    fill(width, height, imps, casters, [
      ...(traps.obstacles ?? []),
      ...(traps.lava ?? []),
    ]),
  ];
  return {
    piece: { key, name, width, height, waves, ...traps },
    band,
    setups: [waves],
  };
};

/** Light rooms: 8 imps and 4 casters (3,520 HP). */
const LIGHT: [number, number] = [8, 4];
/** Medium rooms: 12 imps and 7 casters (5,560 HP). */
const MEDIUM: [number, number] = [12, 7];
/** Heavy rooms: 17 imps and 9 casters (7,620 HP). */
const HEAVY: [number, number] = [17, 9];

/** Forge rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const FORGE_PIECES: readonly RecipePiece[] = [
  room("ashroom", "Ash antechamber", 640, 480, "light", LIGHT),
  room("bellows", "Bellows room", 640, 480, "light", LIGHT, {
    obstacles: [
      { x: 280, y: 96, width: 64, height: 48 },
      { x: 280, y: 336, width: 64, height: 48 },
    ],
  }),
  room("orestore", "Ore store", 560, 560, "light", LIGHT, {
    obstacles: [
      { x: 240, y: 120, width: 48, height: 48 },
      { x: 240, y: 392, width: 48, height: 48 },
      { x: 384, y: 256, width: 48, height: 48 },
    ],
  }),
  // A lava channel across the middle, open at both ends.
  room("smelter", "Smelter", 720, 560, "medium", MEDIUM, {
    lava: [{ x: 200, y: 248, width: 320, height: 64 }],
  }),
  room("anvils", "Anvil hall", 720, 560, "medium", MEDIUM, {
    obstacles: [
      { x: 240, y: 140, width: 64, height: 40 },
      { x: 440, y: 140, width: 64, height: 40 },
      { x: 240, y: 380, width: 64, height: 40 },
      { x: 440, y: 380, width: 64, height: 40 },
    ],
  }),
  // Two staggered channels: the way through zigzags between them.
  room("quench", "Quench room", 640, 640, "medium", MEDIUM, {
    lava: [
      { x: 240, y: 64, width: 48, height: 236 },
      { x: 400, y: 340, width: 48, height: 236 },
    ],
  }),
  room("chains", "Chain gallery", 800, 480, "medium", MEDIUM, {
    obstacles: [256, 448, 640].flatMap((x) => [
      { x, y: 128, width: 32, height: 32 },
      { x, y: 320, width: 32, height: 32 },
    ]),
  }),
  // A cross of lava; the corners are the ways round.
  room("slagpit", "Slag pit", 720, 720, "heavy", HEAVY, {
    lava: [
      { x: 160, y: 328, width: 400, height: 64 },
      { x: 328, y: 160, width: 64, height: 400 },
    ],
  }),
  // Four bars of lava round the middle, gaps at the corners.
  room("crucible", "Crucible hall", 800, 640, "heavy", HEAVY, {
    lava: [
      { x: 280, y: 160, width: 240, height: 48 },
      { x: 280, y: 432, width: 240, height: 48 },
      { x: 200, y: 240, width: 48, height: 160 },
      { x: 552, y: 240, width: 48, height: 160 },
    ],
  }),
  room("furnace", "Great furnace", 800, 640, "heavy", HEAVY, {
    obstacles: [{ x: 400, y: 240, width: 160, height: 160 }],
  }),
  room("foundry", "Foundry", 720, 720, "heavy", HEAVY, {
    lava: [
      { x: 160, y: 200, width: 280, height: 48 },
      { x: 280, y: 472, width: 280, height: 48 },
    ],
    obstacles: [
      { x: 560, y: 120, width: 48, height: 48 },
      { x: 160, y: 600, width: 48, height: 48 },
    ],
  }),
];

/** The forge's boss room. Until the Forgemaster (13d) the Lich stands in. */
export const FORGE_HEART: RoomPiece = {
  ...CRYPT_SANCTUM,
  key: "forgeheart",
  name: "Forge heart",
};

export const FORGE_RECIPE: DungeonRecipe = {
  name: "Ember Forge",
  entrance: { ...WARRENS_ENTRANCE, name: "Forge gate" },
  boss: FORGE_HEART,
  pieces: FORGE_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-130: 52,000–62,000 with the Forgemaster (14,000); 3,000 less while
  // the Lich (11,000) stands in. About 7.5 minutes for a level-15 serf.
  requiredHp: { min: 49_000, max: 59_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  rockfallDamage: 10,
  arrowDamage: 12,
};

/** The Ember Forge for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildForge(seed: number): DungeonLayout {
  return buildFromRecipe(FORGE_RECIPE, seed);
}
