import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  type DungeonRecipe,
  type RecipePiece,
} from "./dungeon-recipe.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";
import { mixedRoom as room, type Mix } from "./room-fill.ts";

/*
 * Frost Hollow (D-136, Phase 13f): the first endgame dungeon, for level-20
 * serfs. Ice caves: ice wraiths that leave frost, yetis, frost archers,
 * ice imps; icicles that fall and leave frost; frost slows you. The Frost
 * Wyrm waits in its lair.
 */

/** Light rooms: 4,700 HP. */
const LIGHT: Mix = {
  front: [
    ["iceimp", 4],
    ["wraith", 2],
    ["yeti", 1],
  ],
  back: [["frostarcher", 4]],
};
/** Medium rooms: 7,260 HP. */
const MEDIUM: Mix = {
  front: [
    ["iceimp", 5],
    ["wraith", 3],
    ["yeti", 2],
  ],
  back: [["frostarcher", 6]],
};
/** Heavy rooms: 9,860 HP. */
const HEAVY: Mix = {
  front: [
    ["iceimp", 7],
    ["wraith", 4],
    ["yeti", 3],
  ],
  back: [["frostarcher", 7]],
};

const pillars = (xs: number[], ys: number[], size = 48) =>
  xs.flatMap((x) => ys.map((y) => ({ x, y, width: size, height: size })));

/** Hollow rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const HOLLOW_PIECES: readonly RecipePiece[] = [
  room("icefall", "Icefall", 640, 480, "light", LIGHT, { rockfall: "icicle" }),
  room("drift", "Snow drift", 640, 480, "light", LIGHT, {
    obstacles: pillars([300], [120, 312]),
  }),
  room("crystal", "Crystal cave", 560, 560, "light", LIGHT, {
    obstacles: pillars([240, 384], [140, 372]),
  }),
  room("glacier", "Glacier hall", 720, 560, "medium", MEDIUM, {
    rockfall: "icicle",
  }),
  room("lake", "Frozen lake", 720, 560, "medium", MEDIUM, {
    obstacles: pillars([336], [256], 48),
  }),
  room("maze", "Ice maze", 640, 640, "medium", MEDIUM, {
    obstacles: pillars([200, 392], [200, 392]),
  }),
  room("tunnel", "Wind tunnel", 800, 480, "medium", MEDIUM, {
    rockfall: "icicle",
  }),
  room("den", "Yeti den", 720, 720, "heavy", HEAVY, {
    obstacles: pillars([240, 432], [336]),
  }),
  room("chasm", "Icicle chasm", 800, 640, "heavy", HEAVY, {
    rockfall: "icicle",
  }),
  room("cathedral", "Frost cathedral", 800, 640, "heavy", HEAVY, {
    obstacles: pillars([280, 472], [160, 432]),
  }),
  room("deepfreeze", "Deep freeze", 720, 720, "heavy", HEAVY, {
    rockfall: "icicle",
  }),
];

/** The Wyrm's lair (D-136): the Frost Wyrm in the middle, open ice round it. */
export const HOLLOW_LAIR: RoomPiece = {
  key: "lair",
  name: "Wyrm's lair",
  width: 800,
  height: 720,
  waves: [[{ kind: "wyrm", at: { x: 400, y: 360 } }]],
};

export const HOLLOW_RECIPE: DungeonRecipe = {
  name: "Frost Hollow",
  entrance: { ...WARRENS_ENTRANCE, name: "Hollow mouth" },
  boss: HOLLOW_LAIR,
  pieces: HOLLOW_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-136: every main path is 76,060, about 8 minutes for a level-20 serf.
  requiredHp: { min: 72_000, max: 82_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  rockfallDamage: 12,
  arrowDamage: 12,
};

/** Frost Hollow for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildHollow(seed: number): DungeonLayout {
  return buildFromRecipe(HOLLOW_RECIPE, seed);
}
