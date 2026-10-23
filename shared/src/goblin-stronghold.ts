import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout, EnemySpawnDef } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  combineSetups,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
  type Waves,
} from "./dungeon-recipe.ts";
import type { EnemyKind } from "./enemy-config.ts";
import {
  WARRENS_ENTRANCE,
  WARRENS_PIECES,
  WARRENS_RULES,
  WARRENS_THRONE,
} from "./goblin-warrens.ts";

/*
 * Goblin Stronghold (D-108, Phase 12a): the goblins' fortified home past
 * the Warrens, aimed at levels 9–12, opened by completing the Warrens
 * (D-107). Ordinary goblins, no general buff: the strength is in numbers
 * (12b adds shamans that strengthen goblins near them). Every Warrens room
 * comes back with both of its setups at once, about twice the goblins;
 * three new fortified rooms join them. The Goblin Warlord stands in as the
 * boss until 12c's Warchief.
 */

const at = (kind: EnemyKind, points: [number, number][]): EnemySpawnDef[] =>
  points.map(([x, y]) => ({ kind, at: { x, y } }));
const g = (points: [number, number][]) => at("grunt", points);
const s = (points: [number, number][]) => at("slinger", points);
const b = (points: [number, number][]) => at("brute", points);

const newRoom = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  waves: Waves,
  traps: Pick<RoomPiece, "rockfall" | "holes" | "holeWave" | "obstacles"> = {},
): RecipePiece => ({
  piece: { key, name, width, height, waves, ...traps },
  band,
  setups: [waves],
});

/** A Warrens room at Stronghold strength: both its setups together. */
const reinforced = ({ piece, band, setups }: RecipePiece): RecipePiece => {
  const waves = combineSetups(piece, setups[0]!, setups[1] ?? []);
  return { piece: { ...piece, waves }, band, setups: [waves] };
};

export const STRONGHOLD_PIECES: readonly RecipePiece[] = [
  ...WARRENS_PIECES.map(reinforced),
  // 1,860: the gate's defenders.
  newRoom(
    "gatehouse",
    "Gatehouse",
    640,
    400,
    "light",
    [
      [
        ...g([
          [220, 100],
          [220, 300],
          [300, 160],
          [300, 240],
          [380, 100],
          [380, 300],
          [460, 160],
          [460, 240],
        ]),
        ...s([
          [580, 80],
          [580, 160],
          [580, 240],
          [580, 320],
        ]),
      ],
    ],
    // Two barricades across the room, a gap between them (D-112).
    {
      obstacles: [
        { x: 420, y: 80, width: 24, height: 96 },
        { x: 420, y: 224, width: 24, height: 96 },
      ],
    },
  ),
  // 3,780: a first wave, then reinforcements from the bunks at the back.
  newRoom(
    "barracks",
    "Barracks",
    720,
    560,
    "medium",
    [
      [
        ...g([
          [240, 120],
          [240, 440],
          [320, 200],
          [320, 360],
          [400, 120],
          [400, 440],
          [480, 200],
          [480, 360],
        ]),
        ...s([
          [640, 160],
          [640, 400],
        ]),
      ],
      [
        ...g([
          [560, 80],
          [560, 480],
          [620, 140],
          [620, 420],
          [660, 240],
          [660, 320],
        ]),
        ...b([
          [520, 220],
          [520, 340],
        ]),
        ...s([
          [680, 80],
          [680, 480],
        ]),
      ],
    ],
    // The reinforcements come out of the bunks: holes at the back (D-109).
    {
      holes: [
        { x: 700, y: 140 },
        { x: 700, y: 420 },
        { x: 560, y: 20 },
        { x: 560, y: 540 },
      ],
      holeWave: 1,
      // Three rows of bunks at the back (D-112).
      obstacles: [
        { x: 520, y: 120, width: 128, height: 32 },
        { x: 520, y: 264, width: 128, height: 32 },
        { x: 520, y: 408, width: 128, height: 32 },
      ],
    },
  ),
  // 3,910: brutes guarding the racks, slingers behind them.
  newRoom(
    "armory",
    "Armory",
    560,
    560,
    "medium",
    [
      [
        ...g([
          [200, 140],
          [200, 420],
          [260, 220],
          [260, 340],
          [320, 140],
          [320, 420],
          [380, 220],
          [380, 340],
        ]),
        ...b([
          [440, 180],
          [440, 380],
          [480, 280],
          [360, 280],
        ]),
        ...s([
          [510, 80],
          [510, 200],
          [510, 360],
          [510, 480],
          [440, 60],
          [440, 500],
        ]),
      ],
    ],
    // Boulders fall among the racks (D-110).
    { rockfall: true },
  ),
];

export const STRONGHOLD_RECIPE: DungeonRecipe = {
  name: "Goblin Stronghold",
  entrance: { ...WARRENS_ENTRANCE, name: "Stronghold gate" },
  boss: { ...WARRENS_THRONE, name: "War hall" },
  pieces: STRONGHOLD_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy"],
  // About 6 minutes for a level-9 serf (D-108).
  requiredHp: { min: 30_000, max: 36_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  // D-109–D-111: every slinger leads its shots; a boulder does 9.
  leadShare: 1,
  rockfallDamage: 9,
};

/** The Goblin Stronghold for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildStronghold(seed: number): DungeonLayout {
  return buildFromRecipe(STRONGHOLD_RECIPE, seed);
}
