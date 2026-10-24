import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout, EnemySpawnDef } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  combineSetups,
  thinPiece,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
  type Waves,
} from "./dungeon-recipe.ts";
import type { EnemyKind } from "./enemy-config.ts";
import {
  WARRENS_ENTRANCE,
  MECHANIC_ROOMS,
  WARRENS_BASE_PIECES,
  WARRENS_RULES,
  WARRENS_THRONE,
} from "./goblin-warrens.ts";

/*
 * Goblin Stronghold (D-108, Phase 12a): the goblins' fortified home past
 * the Warrens, aimed at levels 9–12, opened by completing the Warrens
 * (D-107). Ordinary goblins, no general buff: the strength is in numbers
 * (12b adds shamans that strengthen goblins near them). Every Warrens room
 * comes back with both of its setups at once, about twice the goblins;
 * three new fortified rooms join them. Its boss is the Goblin Warchief
 * in the War hall (D-117).
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
  traps: Pick<
    RoomPiece,
    | "rockfall"
    | "holes"
    | "holeWave"
    | "obstacles"
    | "sludge"
    | "arrows"
    | "gated"
  > = {},
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

const BASE_PIECES: readonly RecipePiece[] = [
  ...WARRENS_BASE_PIECES.map(reinforced),
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
    // Two barricades across the room, a gap between them (D-112); arrow
    // slits along one side wall fire across your path (D-113).
    {
      arrows: {
        slits: Array.from({ length: 15 }, (_, i) => ({
          x: 40 + 40 * i,
          y: 10,
        })),
        direction: { x: 0, y: 1 },
      },
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
        // In the aisles between the bunks (D-127: 32 px slingers).
        ...s([
          [680, 208],
          [680, 352],
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
      // Its doors shut behind you until it is cleared (D-114).
      gated: true,
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

/**
 * Grunts swapped for the Stronghold's new goblins (D-115), in wave 0 of
 * each room: skulkers take the grunts nearest the entrance (they come at
 * you), bombers and shamans the ones farthest back (they hang back).
 */
const NEW_GOBLINS: Readonly<
  Record<string, Partial<Record<"skulker" | "bomber" | "shaman", number>>>
> = {
  gatehouse: { skulker: 2 },
  kitchen: { bomber: 1, skulker: 2 },
  warcamp: { bomber: 2, shaman: 1 },
  barracks: { shaman: 1 },
  pit: { shaman: 1 },
  armory: { skulker: 2 },
};

function withNewGoblins(entry: RecipePiece): RecipePiece {
  const swaps = NEW_GOBLINS[entry.piece.key];
  if (!swaps) return entry;
  const swapWave = (wave: readonly EnemySpawnDef[]): EnemySpawnDef[] => {
    const out = wave.map((s) => ({ ...s }));
    // Grunts by distance from the entrance side (x, entrance on the west).
    const grunts = out
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === "grunt")
      .sort((a, b) => a.s.at.x - b.s.at.x);
    const front = [...grunts];
    const back = [...grunts].reverse();
    const take = (pool: typeof grunts, kind: EnemyKind, n: number) => {
      for (let k = 0; k < n; k++) {
        const g = pool.find(({ i }) => out[i]!.kind === "grunt");
        if (!g)
          throw new Error(`${entry.piece.key}: not enough grunts for ${kind}`);
        out[g.i] = { ...out[g.i]!, kind };
      }
    };
    take(front, "skulker", swaps.skulker ?? 0);
    take(back, "bomber", swaps.bomber ?? 0);
    take(back, "shaman", swaps.shaman ?? 0);
    return out;
  };
  const setups = entry.setups.map((waves) =>
    waves.map((wave, w) => (w === 0 ? swapWave(wave) : [...wave])),
  );
  return { ...entry, piece: { ...entry.piece, waves: setups[0]! }, setups };
}

/**
 * The Stronghold's pool: new goblins in, then fewer of the rest (D-116):
 * rooms with a mechanic lose 30% of their grunts and slingers, others 20%.
 */
/** The Stronghold's rooms at full strength, new goblins included (tests compare against these). */
export const STRONGHOLD_FULL_PIECES: readonly RecipePiece[] =
  BASE_PIECES.map(withNewGoblins);

export const STRONGHOLD_PIECES: readonly RecipePiece[] =
  STRONGHOLD_FULL_PIECES.map((entry) =>
    thinPiece(entry, MECHANIC_ROOMS.has(entry.piece.key) ? 0.3 : 0.2),
  );

/**
 * The War hall (D-117): the Warchief in the middle (where the portal
 * opens), four pillars to break its charge on, and four holes its war cry
 * calls skulkers out of.
 */
export const WAR_HALL: RoomPiece = {
  ...WARRENS_THRONE,
  key: "warhall",
  name: "War hall",
  waves: [at("warchief", [[320, 300]])],
  obstacles: [
    { x: 136, y: 126, width: 48, height: 48 },
    { x: 456, y: 126, width: 48, height: 48 },
    { x: 136, y: 426, width: 48, height: 48 },
    { x: 456, y: 426, width: 48, height: 48 },
  ],
  holes: [
    { x: 200, y: 20 },
    { x: 440, y: 20 },
    { x: 200, y: 580 },
    { x: 440, y: 580 },
  ],
};

export const STRONGHOLD_RECIPE: DungeonRecipe = {
  name: "Goblin Stronghold",
  entrance: { ...WARRENS_ENTRANCE, name: "Stronghold gate" },
  boss: WAR_HALL,
  pieces: STRONGHOLD_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy"],
  // About 6 minutes for a level-9 serf (D-108); D-116: was 30,000–36,000
  // before rooms were thinned; D-117: +3,000 for the Warchief.
  requiredHp: { min: 28_000, max: 34_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  // D-109–D-111: every slinger leads its shots; a boulder does 9.
  leadShare: 1,
  rockfallDamage: 9,
  // D-113: a trap arrow does 6.
  arrowDamage: 6,
};

/** The Goblin Stronghold for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildStronghold(seed: number): DungeonLayout {
  return buildFromRecipe(STRONGHOLD_RECIPE, seed);
}
