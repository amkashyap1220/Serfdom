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
 * Dragon's Roost (D-140, Phase 13j): the tenth dungeon and the last
 * endgame one for now, for level-20 serfs; the only one that drops T10. A
 * volcanic peak with the hardest mix of everything so far: forge imps,
 * storm hawks, gargoyles, sentries, golems, spearmen, storm adepts, and
 * fire drakes, among lava, slag, fire jets, wind, and lightning. The Elder
 * Dragon waits at the summit.
 */

/** Light rooms: 5,120 HP. */
const LIGHT: Mix = {
  front: [
    ["imp", 4],
    ["hawk", 3],
    ["gargoyle", 1],
  ],
  back: [
    ["drake", 2],
    ["adept", 2],
  ],
};
/** Medium rooms: 8,200 HP. */
const MEDIUM: Mix = {
  front: [
    ["imp", 5],
    ["hawk", 4],
    ["sentry", 2],
    ["spearman", 2],
  ],
  back: [
    ["drake", 3],
    ["adept", 2],
  ],
};
/** Heavy rooms: 11,200 HP. */
const HEAVY: Mix = {
  front: [
    ["imp", 6],
    ["hawk", 5],
    ["golem", 2],
    ["sentry", 2],
  ],
  back: [
    ["drake", 3],
    ["adept", 2],
  ],
};

/** Fire-jet nozzles along the north wall, 128 px apart, firing south (as in the forge). */
const jets = (
  first: number,
  count: number,
): NonNullable<RoomPiece["arrows"]> => ({
  slits: Array.from({ length: count }, (_, i) => ({
    x: first + 128 * i,
    y: 10,
  })),
  direction: { x: 0, y: 1 },
  jet: true,
});
const block = (x: number, y: number, w = 48, h = 48) => ({
  x,
  y,
  width: w,
  height: h,
});

/** Roost rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const ROOST_PIECES: readonly RecipePiece[] = [
  room("slope", "Ash slope", 640, 480, "light", LIGHT, {
    lava: [{ x: 240, y: 200, width: 200, height: 64 }],
  }),
  room("embercave", "Ember cave", 640, 480, "light", LIGHT, {
    rockfall: "slag",
  }),
  room("ledge", "Wind ledge", 560, 560, "light", LIGHT, {
    winds: [
      {
        rect: { x: 120, y: 120, width: 320, height: 320 },
        dir: { x: 0, y: 1 },
      },
    ],
  }),
  room("magma", "Magma hall", 720, 560, "medium", MEDIUM, {
    lava: [{ x: 240, y: 232, width: 240, height: 64 }],
    arrows: jets(152, 5),
  }),
  room("scorched", "Scorched gallery", 720, 560, "medium", MEDIUM, {
    rockfall: "lightning",
  }),
  room("bones", "Bone field", 640, 640, "medium", MEDIUM, { rockfall: "slag" }),
  room("vent", "Furnace vent", 800, 480, "medium", MEDIUM, {
    arrows: jets(144, 5),
    obstacles: [block(272, 128, 32, 32), block(528, 320, 32, 32)],
  }),
  room("lavalake", "Lava lake", 720, 720, "heavy", HEAVY, {
    lava: [
      { x: 160, y: 328, width: 400, height: 64 },
      { x: 328, y: 160, width: 64, height: 400 },
    ],
  }),
  room("hoard", "Dragon's hoard", 800, 640, "heavy", HEAVY, {
    obstacles: [
      block(280, 160),
      block(472, 160),
      block(280, 432),
      block(472, 432),
    ],
  }),
  // A bridge over lava, the wind blowing you off it.
  room("bridge", "Burning bridge", 800, 640, "heavy", HEAVY, {
    lava: [
      { x: 160, y: 64, width: 480, height: 120 },
      { x: 160, y: 456, width: 480, height: 120 },
    ],
    winds: [
      {
        rect: { x: 160, y: 200, width: 480, height: 240 },
        dir: { x: 0, y: -1 },
      },
    ],
  }),
  room("caldera", "Caldera", 720, 720, "heavy", HEAVY, {
    rockfall: "slag",
    lava: [{ x: 296, y: 296, width: 128, height: 128 }],
  }),
];

/** The Roost summit (D-140): open ground for the Elder Dragon to land and take off. */
export const ROOST_SUMMIT: RoomPiece = {
  key: "summit",
  name: "Roost summit",
  width: 840,
  height: 760,
  waves: [[{ kind: "dragon", at: { x: 420, y: 380 } }]],
};

export const ROOST_RECIPE: DungeonRecipe = {
  name: "Dragon's Roost",
  entrance: { ...WARRENS_ENTRANCE, name: "Roost path" },
  boss: ROOST_SUMMIT,
  pieces: ROOST_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-140: every main path is 89,320, about 9 minutes for a level-20 serf.
  requiredHp: { min: 85_000, max: 93_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  rockfallDamage: 14,
  arrowDamage: 14,
};

/** Dragon's Roost for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildRoost(seed: number): DungeonLayout {
  return buildFromRecipe(ROOST_RECIPE, seed);
}
