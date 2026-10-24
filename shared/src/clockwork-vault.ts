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
 * The Clockwork Vault (D-137, Phase 13g): an endgame dungeon for level-20
 * serfs, and the first with a fixed map (D-013): the same layout every run,
 * so it can be learned. Clockwork sentries with shields, cog drones, floor
 * turrets; rotating blade arms; the Automaton in the Core.
 */

/** Light rooms: 4,600 HP. */
const LIGHT: Mix = {
  front: [
    ["drone", 5],
    ["sentry", 2],
  ],
  back: [["turret", 3]],
};
/** Medium rooms: 7,260 HP. */
const MEDIUM: Mix = {
  front: [
    ["drone", 8],
    ["sentry", 3],
  ],
  back: [["turret", 5]],
};
/** Heavy rooms: 9,920 HP. */
const HEAVY: Mix = {
  front: [
    ["drone", 11],
    ["sentry", 4],
  ],
  back: [["turret", 7]],
};

const blocks = (spots: [number, number][], w = 48, h = 48) =>
  spots.map(([x, y]) => ({ x, y, width: w, height: h }));

/** Vault rooms: entrance on the west, positions relative to the floor. HP is solo. */
export const VAULT_PIECES: readonly RecipePiece[] = [
  room("gears", "Gear hall", 640, 480, "light", LIGHT, {
    blades: [{ pivot: { x: 320, y: 240 }, length: 150, degreesPerSecond: 60 }],
  }),
  room("pipes", "Pipe gallery", 640, 480, "light", LIGHT, {
    obstacles: blocks([
      [280, 120],
      [280, 312],
    ]),
  }),
  room("springs", "Spring room", 560, 560, "light", LIGHT, {
    blades: [{ pivot: { x: 280, y: 280 }, length: 160, degreesPerSecond: -70 }],
  }),
  room("pistons", "Piston hall", 720, 560, "medium", MEDIUM, {
    obstacles: blocks([
      [240, 140],
      [440, 140],
      [240, 372],
      [440, 372],
    ]),
  }),
  room("tower", "Clock tower", 720, 560, "medium", MEDIUM, {
    blades: [{ pivot: { x: 360, y: 280 }, length: 200, degreesPerSecond: 50 }],
  }),
  // Two arms turning against each other.
  room("boiler", "Boiler room", 640, 640, "medium", MEDIUM, {
    blades: [
      { pivot: { x: 200, y: 200 }, length: 120, degreesPerSecond: 90 },
      { pivot: { x: 440, y: 440 }, length: 120, degreesPerSecond: -90 },
    ],
  }),
  room("assembly", "Assembly line", 800, 480, "medium", MEDIUM, {
    obstacles: blocks(
      [
        [280, 200],
        [520, 200],
      ],
      48,
      80,
    ),
  }),
  room("floor", "Foundry floor", 720, 720, "heavy", HEAVY, {
    blades: [{ pivot: { x: 360, y: 360 }, length: 240, degreesPerSecond: 45 }],
  }),
  room("cathedral", "Gear cathedral", 800, 640, "heavy", HEAVY, {
    obstacles: blocks([
      [280, 160],
      [472, 160],
      [280, 432],
      [472, 432],
    ]),
  }),
  room("escapement", "Escapement", 800, 640, "heavy", HEAVY, {
    blades: [
      { pivot: { x: 240, y: 320 }, length: 160, degreesPerSecond: 70 },
      { pivot: { x: 560, y: 320 }, length: 160, degreesPerSecond: -70 },
    ],
  }),
  room("mainspring", "Mainspring", 720, 720, "heavy", HEAVY, {
    obstacles: blocks([
      [240, 336],
      [432, 336],
    ]),
  }),
];

/** The Core (D-137): the Automaton in the middle, open floor for its laser. */
export const VAULT_CORE: RoomPiece = {
  key: "core",
  name: "The Core",
  width: 800,
  height: 720,
  waves: [[{ kind: "automaton", at: { x: 400, y: 360 } }]],
};

export const VAULT_RECIPE: DungeonRecipe = {
  name: "Clockwork Vault",
  entrance: { ...WARRENS_ENTRANCE, name: "Vault door" },
  boss: VAULT_CORE,
  pieces: VAULT_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-137: 78,140 with the Automaton, about 8 minutes for a level-20 serf.
  requiredHp: { min: 72_000, max: 84_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  rockfallDamage: 12,
  arrowDamage: 12,
};

/** The one seed the Vault is built from: its map never changes (D-137). */
export const VAULT_SEED = 7;

/** The Clockwork Vault: the same map every run. */
export const VAULT_LAYOUT: DungeonLayout = buildFromRecipe(
  VAULT_RECIPE,
  VAULT_SEED,
);
