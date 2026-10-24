import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
} from "./dungeon-recipe.ts";
import type { EnemyKind } from "./enemy-config.ts";
import type { Rect } from "./geometry.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";
import { fillRoom } from "./room-fill.ts";

/*
 * The Sunken Temple (D-135, Phase 13e): the fifth dungeon, levels 18–20,
 * the last of the first five (D-126); opened by completing the Warrens
 * (D-107). Drowned acolytes (the grunt's walk), tide callers (the
 * slinger's throws), fishfolk spearmen (the brute's charge), and
 * eel-priests that pull you; tide pools that turn deep and slow you on the
 * run's tide cycle. The Tide Priest waits in the Drowned sanctum.
 */

/** A band's enemies: those in front, and those along the back. */
interface Mix {
  front: [EnemyKind, number][];
  back: [EnemyKind, number][];
}

/** Light rooms: 4,280 HP. */
const LIGHT: Mix = {
  front: [
    ["acolyte", 8],
    ["spearman", 2],
  ],
  back: [
    ["caller", 4],
    ["eelpriest", 1],
  ],
};
/** Medium rooms: 6,360 HP. */
const MEDIUM: Mix = {
  front: [
    ["acolyte", 11],
    ["spearman", 3],
  ],
  back: [
    ["caller", 6],
    ["eelpriest", 2],
  ],
};
/** Heavy rooms: 8,860 HP. */
const HEAVY: Mix = {
  front: [
    ["acolyte", 14],
    ["spearman", 5],
  ],
  back: [
    ["caller", 8],
    ["eelpriest", 3],
  ],
};

const room = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  mix: Mix,
  terrain: Pick<RoomPiece, "obstacles" | "tides"> = {},
): RecipePiece => {
  const blocked: Rect[] = [...(terrain.obstacles ?? [])];
  const waves = [fillRoom(width, height, mix.front, mix.back, blocked)];
  return {
    piece: { key, name, width, height, waves, ...terrain },
    band,
    setups: [waves],
  };
};

/** Temple rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const TEMPLE_PIECES: readonly RecipePiece[] = [
  room("narthex", "Flooded narthex", 640, 480, "light", LIGHT, {
    tides: [{ x: 200, y: 160, width: 240, height: 160 }],
  }),
  room("shrine", "Shell shrine", 640, 480, "light", LIGHT, {
    obstacles: [
      { x: 300, y: 120, width: 48, height: 48 },
      { x: 300, y: 312, width: 48, height: 48 },
    ],
  }),
  // A band of water across the hall: you wade it to go on.
  room("votive", "Votive hall", 560, 560, "light", LIGHT, {
    tides: [{ x: 0, y: 232, width: 560, height: 96 }],
  }),
  room("pools", "Tide pools", 720, 560, "medium", MEDIUM, {
    tides: [
      { x: 160, y: 80, width: 160, height: 120 },
      { x: 380, y: 220, width: 160, height: 120 },
      { x: 160, y: 360, width: 160, height: 120 },
    ],
  }),
  room("nave", "Coral nave", 720, 560, "medium", MEDIUM, {
    obstacles: [
      { x: 240, y: 140, width: 40, height: 40 },
      { x: 440, y: 140, width: 40, height: 40 },
      { x: 240, y: 380, width: 40, height: 40 },
      { x: 440, y: 380, width: 40, height: 40 },
    ],
  }),
  // A ring of water round a dry middle.
  room("cloister", "Drowned cloister", 640, 640, "medium", MEDIUM, {
    tides: [
      { x: 96, y: 96, width: 448, height: 64 },
      { x: 96, y: 480, width: 448, height: 64 },
      { x: 96, y: 160, width: 64, height: 320 },
      { x: 480, y: 160, width: 64, height: 320 },
    ],
  }),
  room("bells", "Bell gallery", 800, 480, "medium", MEDIUM, {
    obstacles: [
      { x: 280, y: 200, width: 48, height: 80 },
      { x: 520, y: 200, width: 48, height: 80 },
    ],
  }),
  room("cistern", "Great cistern", 800, 640, "heavy", HEAVY, {
    tides: [{ x: 160, y: 120, width: 480, height: 400 }],
  }),
  room("reef", "Reef chapel", 720, 720, "heavy", HEAVY, {
    obstacles: [
      { x: 200, y: 200, width: 64, height: 64 },
      { x: 456, y: 456, width: 64, height: 64 },
    ],
    tides: [{ x: 300, y: 0, width: 120, height: 720 }],
  }),
  room("stair", "Abyss stair", 720, 720, "heavy", HEAVY, {
    tides: [
      { x: 120, y: 120, width: 200, height: 200 },
      { x: 400, y: 400, width: 200, height: 200 },
    ],
  }),
  room("kelp", "Kelp crypt", 800, 640, "heavy", HEAVY, {
    obstacles: [
      { x: 300, y: 160, width: 48, height: 48 },
      { x: 452, y: 160, width: 48, height: 48 },
      { x: 300, y: 432, width: 48, height: 48 },
      { x: 452, y: 432, width: 48, height: 48 },
    ],
  }),
];

/**
 * The Drowned sanctum (D-135): the Tide Priest in the middle (the portal
 * opens where it dies), open floor for its surges and whirlpools.
 */
export const TEMPLE_SANCTUM: RoomPiece = {
  key: "sanctum",
  name: "Drowned sanctum",
  width: 760,
  height: 640,
  waves: [[{ kind: "tidepriest", at: { x: 380, y: 320 } }]],
};

export const TEMPLE_RECIPE: DungeonRecipe = {
  name: "Sunken Temple",
  entrance: { ...WARRENS_ENTRANCE, name: "Temple steps" },
  boss: TEMPLE_SANCTUM,
  pieces: TEMPLE_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-135: about 8 minutes for a level-18 serf; every main path is 65,940.
  requiredHp: { min: 62_000, max: 72_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  // No boulders or arrow traps here; the recipe still names their damage.
  rockfallDamage: 12,
  arrowDamage: 12,
};

/** The Sunken Temple for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildTemple(seed: number): DungeonLayout {
  return buildFromRecipe(TEMPLE_RECIPE, seed);
}
