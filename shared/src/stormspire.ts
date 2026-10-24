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
 * Stormspire (D-139, Phase 13i): an endgame dungeon for level-20 serfs, a
 * tower climbed floor by floor (its rooms mostly stack northwards). Storm
 * hawks that dive, storm adepts, gargoyles; lightning that strikes where
 * you stand; wind that gusts you towards the walls. The Storm Caller waits
 * at the top.
 */

/** Light rooms: 4,660 HP. */
const LIGHT: Mix = {
  front: [
    ["hawk", 4],
    ["gargoyle", 2],
  ],
  back: [["adept", 5]],
};
/** Medium rooms: 7,140 HP. */
const MEDIUM: Mix = {
  front: [
    ["hawk", 6],
    ["gargoyle", 3],
  ],
  back: [["adept", 8]],
};
/** Heavy rooms: 9,920 HP. */
const HEAVY: Mix = {
  front: [
    ["hawk", 8],
    ["gargoyle", 5],
  ],
  back: [["adept", 9]],
};

const pillars = (spots: [number, number][], size = 48) =>
  spots.map(([x, y]) => ({ x, y, width: size, height: size }));
const north = { x: 0, y: -1 };
const south = { x: 0, y: 1 };

/** Spire rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const SPIRE_PIECES: readonly RecipePiece[] = [
  room("stairfoot", "Stair foot", 640, 480, "light", LIGHT, {
    rockfall: "lightning",
  }),
  // A gust across the middle pushes you south.
  room("gallery", "Wind gallery", 640, 480, "light", LIGHT, {
    winds: [{ rect: { x: 120, y: 120, width: 400, height: 240 }, dir: south }],
  }),
  room("loft", "Bell loft", 560, 560, "light", LIGHT, {
    obstacles: pillars([
      [240, 140],
      [240, 372],
    ]),
  }),
  room("spiral", "Spiral stair", 720, 560, "medium", MEDIUM, {
    rockfall: "lightning",
  }),
  // Two gusts pulling you apart, to the north and south walls.
  room("gusts", "Gust hall", 720, 560, "medium", MEDIUM, {
    winds: [
      { rect: { x: 100, y: 60, width: 520, height: 180 }, dir: north },
      { rect: { x: 100, y: 320, width: 520, height: 180 }, dir: south },
    ],
  }),
  room("nest", "Rook nest", 640, 640, "medium", MEDIUM, {
    obstacles: pillars([
      [200, 200],
      [392, 200],
      [200, 392],
      [392, 392],
    ]),
  }),
  room("landing", "Storm landing", 800, 480, "medium", MEDIUM, {
    rockfall: "lightning",
  }),
  room("thunder", "Thunder hall", 720, 720, "heavy", HEAVY, {
    rockfall: "lightning",
    obstacles: pillars([
      [240, 336],
      [432, 336],
    ]),
  }),
  room("windward", "Windward walk", 800, 640, "heavy", HEAVY, {
    winds: [{ rect: { x: 0, y: 160, width: 800, height: 320 }, dir: north }],
  }),
  room("copper", "Copper chamber", 800, 640, "heavy", HEAVY, {
    obstacles: pillars([
      [280, 160],
      [472, 160],
      [280, 432],
      [472, 432],
    ]),
  }),
  room("eye", "Eye of the storm", 720, 720, "heavy", HEAVY, {
    rockfall: "lightning",
  }),
];

/** The Spire top (D-139): the Storm Caller at its centre, where its pylons rise round it. */
export const SPIRE_TOP: RoomPiece = {
  key: "top",
  name: "Spire top",
  width: 760,
  height: 760,
  waves: [[{ kind: "stormcaller", at: { x: 380, y: 380 } }]],
};

export const SPIRE_RECIPE: DungeonRecipe = {
  name: "Stormspire",
  entrance: { ...WARRENS_ENTRANCE, name: "Spire gate" },
  boss: SPIRE_TOP,
  pieces: SPIRE_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-139: every main path is 73,840, about 8 minutes for a level-20 serf.
  requiredHp: { min: 70_000, max: 78_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  // A climb: the path mostly turns north.
  turnWeights: { east: 1, north: 4, south: 0.2 },
  leadShare: 1,
  rockfallDamage: 14,
  arrowDamage: 12,
};

/** Stormspire for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildSpire(seed: number): DungeonLayout {
  return buildFromRecipe(SPIRE_RECIPE, seed);
}
