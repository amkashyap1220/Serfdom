import type { RoomPiece } from "./dungeon-gen.ts";
import {
  buildFromRecipe,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
  type Waves,
} from "./dungeon-recipe.ts";
import {
  wallsAroundRooms,
  type DoorDef,
  type DungeonLayout,
  type EnemySpawnDef,
  type RoomDef,
} from "./dungeon-layout.ts";
import type { EnemyKind } from "./enemy-config.ts";

/*
 * Goblin Warrens v0 (T-029, Phase 6b). PROVISIONAL layout and encounter
 * counts by Claude (design delegated by the user, D-047), aimed at a
 * ~5-minute solo clear once the boss exists (6c); tuned in 6d.
 *
 * Mostly linear west → east along y ≈ 1000, one optional side room:
 *
 *                          [den]
 *                            |
 *  [entrance]-[  tunnel  ]-[camp]-[ambush hall]-[guard]-[throne]
 *
 * Doors are 64 px gaps in the 32 px walls, centered on y = 1000 (the den's
 * on the camp's north wall). Each door opens when the room it belongs to
 * (the one before it) is cleared. The Goblin Warlord waits in the throne
 * room; when it dies the exit portal opens where it stood, and each player
 * completes by stepping into it (D-057).
 *
 * Solo HP on the way (6d tuning): tunnel 850, camp 1845, ambush 3455 (two
 * waves), guard 2670, Warlord 5000 → 13820 required; den 930 optional.
 */

const DOOR = 64;
const DOOR_Y = 1000 - DOOR / 2;

const spawns = (kind: EnemyKind, points: [number, number][]): EnemySpawnDef[] =>
  points.map(([x, y]) => ({ kind, at: { x, y } }));

const rooms: RoomDef[] = [
  {
    id: "entrance",
    name: "Entrance cave",
    bounds: { x: 100, y: 800, width: 400, height: 400 },
    waves: [],
    required: true,
  },
  {
    id: "tunnel",
    name: "Tunnel",
    bounds: { x: 532, y: 920, width: 800, height: 160 },
    waves: [
      spawns("grunt", [
        [950, 970],
        [1000, 1030],
        [1100, 1000],
        [1200, 960],
        [1250, 1040],
      ]),
    ],
    required: true,
  },
  {
    id: "camp",
    name: "Goblin camp",
    bounds: { x: 1364, y: 760, width: 640, height: 480 },
    waves: [
      [
        ...spawns("grunt", [
          [1600, 900],
          [1650, 1100],
          [1700, 1000],
          [1750, 1000],
          [1800, 850],
          [1800, 1150],
        ]),
        ...spawns("slinger", [
          [1950, 850],
          [1950, 1000],
          [1950, 1150],
        ]),
        ...spawns("brute", [[1880, 1000]]),
      ],
    ],
    required: true,
  },
  {
    id: "den",
    name: "Side den",
    bounds: { x: 1524, y: 408, width: 320, height: 320 },
    waves: [
      [
        ...spawns("grunt", [
          [1600, 500],
          [1760, 500],
          [1600, 650],
          [1760, 650],
        ]),
        ...spawns("slinger", [
          [1560, 450],
          [1810, 450],
        ]),
      ],
    ],
    required: false,
  },
  {
    id: "ambush",
    name: "Ambush hall",
    bounds: { x: 2036, y: 700, width: 720, height: 600 },
    waves: [
      [
        ...spawns("grunt", [
          [2300, 800],
          [2300, 1200],
          [2500, 750],
          [2500, 1250],
          [2650, 900],
          [2650, 1100],
        ]),
        ...spawns("slinger", [
          [2700, 800],
          [2700, 1200],
        ]),
      ],
      [
        // The second wave also comes from behind, near the entry door.
        ...spawns("grunt", [
          [2100, 760],
          [2100, 1240],
          [2400, 760],
          [2400, 1240],
          [2500, 1000],
          [2600, 1000],
          [2700, 760],
          [2700, 1240],
        ]),
        ...spawns("slinger", [
          [2720, 1000],
          [2720, 780],
          [2720, 1220],
        ]),
        ...spawns("brute", [[2650, 1000]]),
      ],
    ],
    required: true,
  },
  {
    id: "guard",
    name: "Guard room",
    bounds: { x: 2788, y: 800, width: 640, height: 400 },
    waves: [
      [
        ...spawns("grunt", [
          [3000, 900],
          [3000, 1100],
          [3050, 1000],
          [3100, 1000],
          [3150, 850],
          [3150, 1150],
        ]),
        ...spawns("slinger", [
          [3300, 900],
          [3300, 1100],
          [3380, 850],
          [3380, 950],
          [3380, 1050],
          [3380, 1150],
        ]),
        ...spawns("brute", [
          [3220, 900],
          [3220, 1100],
        ]),
      ],
    ],
    required: true,
  },
  {
    id: "throne",
    name: "Warlord's throne",
    bounds: { x: 3460, y: 700, width: 640, height: 600 },
    waves: [spawns("warlord", [[3780, 1000]])],
    required: true,
  },
];

/** An east-west door in the wall just east of x = `wallX`. */
const eastDoor = (id: string, wallX: number, room: string): DoorDef => ({
  id,
  rect: { x: wallX, y: DOOR_Y, width: 32, height: DOOR },
  room,
});

const doors: DoorDef[] = [
  eastDoor("entrance-tunnel", 500, "entrance"),
  eastDoor("tunnel-camp", 1332, "tunnel"),
  {
    id: "camp-den",
    rect: { x: 1684 - DOOR / 2, y: 728, width: DOOR, height: 32 },
    room: "camp",
  },
  eastDoor("camp-ambush", 2004, "camp"),
  eastDoor("ambush-guard", 2756, "ambush"),
  eastDoor("guard-throne", 3428, "guard"),
];

export const GOBLIN_WARRENS: DungeonLayout = {
  world: { width: 4200, height: 1400 },
  walls: wallsAroundRooms(rooms, doors),
  spawn: { x: 300, y: 1000 },
  rooms,
  doors,
  exitPortal: { x: 3780, y: 1000 },
};

/*
 * Procedural Warrens (D-104, Phase 11a). Every run builds its own Warrens
 * from the rooms above, used as pieces, under these rules:
 * - Entrance first, the Warlord's throne last (portal where the Warlord
 *   stands); each door opens when the room before it is cleared.
 * - Main path: 4 combat rooms ramping light → medium → medium → heavy, with
 *   12,500–15,000 solo HP required, Warlord included (3–5 min, D-047).
 * - The path runs east, north, or south; it never turns back west.
 * - 0–2 optional side rooms (light or medium) branch off combat rooms.
 * - 11b (D-105): 11 combat pieces, each with two enemy setups.
 * Seed 0 is the handcrafted layout above, kept as a fixed fixture.
 */

export type { RoomBand };
/** One combat room of the Warrens pool (a recipe piece, D-105). */
export type WarrensPiece = RecipePiece;

export const WARRENS_RULES = {
  mainPath: ["light", "medium", "medium", "heavy"] as readonly RoomBand[],
  requiredHp: { min: 12_500, max: 15_000 },
  sideRooms: { min: 0, max: 2 },
  sideBands: ["light", "medium"] as readonly RoomBand[],
  /** Main-path turns: east twice as likely as north or south. */
  turnWeights: { east: 2, north: 1, south: 1 },
} as const;

const asPiece = (id: string, name?: string): RoomPiece => {
  const room = rooms.find((r) => r.id === id);
  if (!room) throw new RangeError(`no Warrens room ${id}`);
  const { x, y, width, height } = room.bounds;
  return {
    key: id,
    name: name ?? room.name,
    width,
    height,
    waves: room.waves.map((wave) =>
      wave.map((s) => ({ kind: s.kind, at: { x: s.at.x - x, y: s.at.y - y } })),
    ),
  };
};

/** The Warrens' first and last rooms, also used by the Stronghold. */
export const WARRENS_ENTRANCE = asPiece("entrance");
export const WARRENS_THRONE = asPiece("throne");

/** A new piece (11b): entrance on the west, positions relative to the floor. */
const newPiece = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  setups: Waves[],
): WarrensPiece => ({
  piece: { key, name, width, height, waves: setups[0]! },
  band,
  setups,
});

/** A handcrafted room as a piece, plus its alternative setups. */
const oldPiece = (
  id: string,
  band: RoomBand,
  alternatives: Waves[],
  name?: string,
): WarrensPiece => {
  const piece = asPiece(id, name);
  return { piece, band, setups: [piece.waves, ...alternatives] };
};

/** Adds traps to a pool entry (the room's shape and setups unchanged). */
const withTraps = (
  entry: RecipePiece,
  traps: Pick<RoomPiece, "rockfall" | "holes" | "holeWave">,
  setups: Waves[] = [...entry.setups],
): RecipePiece => ({
  ...entry,
  piece: { ...entry.piece, ...traps, waves: setups[0]! },
  setups,
});

const g = (points: [number, number][]) => spawns("grunt", points);
const s = (points: [number, number][]) => spawns("slinger", points);
const b = (points: [number, number][]) => spawns("brute", points);

/**
 * The combat pool (D-105, approved 2026-10-23). Bands: light ~700–1,000,
 * medium ~1,800–2,800, heavy ~3,100–3,500 solo HP, so every main path
 * lands inside the HP band. The Goblin den moved to light; the Guard room
 * stays medium.
 */
const AMBUSH_HOLES = [
  { x: 200, y: 20 },
  { x: 520, y: 20 },
  { x: 200, y: 580 },
  { x: 520, y: 580 },
];

/** A hole wave: its goblins come out of `holes` in turn (positions are the holes). */
const fromHoles = (
  holes: readonly { x: number; y: number }[],
  kinds: EnemyKind[],
): EnemySpawnDef[] =>
  kinds.map((kind, i) => ({ kind, at: { ...holes[i % holes.length]! } }));

const repeat = (kind: EnemyKind, n: number): EnemyKind[] => Array(n).fill(kind);

function ambushHall(): RecipePiece {
  const first = asPiece("ambush").waves[0]!;
  const setups: Waves[] = [
    [
      first,
      fromHoles(AMBUSH_HOLES, [
        ...repeat("brute", 3),
        ...repeat("grunt", 3),
        ...repeat("slinger", 2),
      ]),
    ],
    [
      [
        ...g([
          [300, 120],
          [300, 480],
          [480, 200],
          [480, 400],
        ]),
        ...s([
          [660, 100],
          [660, 240],
          [660, 360],
          [660, 500],
        ]),
      ],
      fromHoles(AMBUSH_HOLES, [
        ...repeat("brute", 3),
        ...repeat("grunt", 4),
        "slinger",
      ]),
    ],
  ];
  return {
    piece: {
      ...asPiece("ambush"),
      holes: AMBUSH_HOLES,
      holeWave: 1,
      waves: setups[0]!,
    },
    band: "heavy",
    setups,
  };
}

export const WARRENS_PIECES: readonly WarrensPiece[] = [
  // Light.
  // Boulders fall in the tunnel while it fights (D-110).
  withTraps(
    oldPiece("tunnel", "light", [
      [
        [
          ...g([
            [460, 50],
            [520, 110],
            [580, 80],
          ]),
          ...s([
            [740, 40],
            [760, 80],
            [740, 120],
          ]),
        ],
      ],
    ]),
    { rockfall: true },
  ),
  oldPiece(
    "den",
    "light",
    [
      [
        g([
          [120, 80],
          [220, 80],
          [160, 160],
          [260, 160],
          [120, 240],
          [220, 240],
        ]),
      ],
    ],
    "Goblin den",
  ),
  newPiece("passage", "Collapsed passage", 640, 240, "light", [
    [
      [
        ...g([
          [300, 80],
          [340, 120],
          [300, 160],
        ]),
        ...s([
          [590, 70],
          [590, 170],
        ]),
      ],
    ],
    [
      [
        ...g([
          [360, 90],
          [360, 150],
        ]),
        ...s([
          [580, 50],
          [600, 120],
          [580, 190],
        ]),
      ],
    ],
  ]),
  newPiece("grotto", "Fungus grotto", 480, 480, "light", [
    [
      [
        ...g([
          [200, 120],
          [200, 360],
          [320, 200],
          [320, 280],
        ]),
        ...s([
          [420, 80],
          [420, 400],
        ]),
      ],
    ],
    [
      [
        ...g([
          [240, 240],
          [300, 160],
          [300, 320],
        ]),
        ...s([
          [420, 100],
          [420, 240],
          [420, 380],
        ]),
      ],
    ],
  ]),
  // Medium.
  oldPiece("camp", "medium", [
    [
      [
        ...g([
          [240, 140],
          [240, 340],
          [320, 240],
          [400, 160],
          [400, 320],
        ]),
        ...s([
          [590, 80],
          [590, 200],
          [590, 280],
          [590, 400],
        ]),
        ...b([[500, 240]]),
      ],
    ],
  ]),
  // Boulders fall in the guard room while it fights (D-110).
  withTraps(
    oldPiece("guard", "medium", [
      [
        [
          ...g([
            [240, 120],
            [240, 280],
            [320, 200],
            [380, 200],
          ]),
          ...s([
            [590, 60],
            [590, 140],
            [590, 260],
            [590, 340],
            [530, 100],
            [530, 300],
          ]),
          ...b([
            [440, 100],
            [440, 300],
            [480, 200],
          ]),
        ],
      ],
    ]),
    {
      rockfall: true,
    },
  ),
  newPiece("kitchen", "Goblin kitchen", 560, 480, "medium", [
    [
      [
        ...g([
          [220, 120],
          [220, 360],
          [280, 200],
          [280, 280],
          [340, 140],
          [340, 340],
          [400, 240],
        ]),
        ...s([
          [500, 100],
          [500, 380],
        ]),
        ...b([[460, 240]]),
      ],
    ],
    [
      [
        ...g([
          [240, 160],
          [240, 320],
          [320, 240],
          [380, 140],
          [380, 340],
        ]),
        ...s([
          [510, 120],
          [510, 360],
        ]),
        ...b([
          [460, 180],
          [460, 300],
        ]),
      ],
    ],
  ]),
  newPiece("gallery", "Slinger gallery", 720, 360, "medium", [
    [
      [
        ...s([
          [630, 60],
          [630, 120],
          [630, 180],
          [630, 240],
          [630, 300],
          [680, 60],
          [680, 120],
          [680, 180],
          [680, 240],
          [680, 300],
        ]),
        ...g([
          [420, 100],
          [420, 260],
          [480, 140],
          [480, 220],
        ]),
      ],
    ],
    [
      [
        ...s([
          [630, 60],
          [630, 140],
          [630, 220],
          [630, 300],
          [680, 60],
          [680, 140],
          [680, 220],
          [680, 300],
        ]),
        ...g([
          [420, 120],
          [420, 240],
          [500, 180],
        ]),
        ...b([[560, 180]]),
      ],
    ],
  ]),
  // Heavy.
  // The second wave pours out of holes in the walls (D-109); HP stays close
  // to the handcrafted room (3,380 and 3,335 for its two setups).
  ambushHall(),
  newPiece("pit", "Brute pit", 640, 640, "heavy", [
    [
      [
        ...b([
          [400, 220],
          [400, 420],
        ]),
        ...g([
          [260, 160],
          [260, 480],
          [320, 320],
          [480, 160],
          [480, 480],
          [540, 320],
        ]),
      ],
      [
        ...b([
          [560, 200],
          [560, 440],
        ]),
        ...s([
          [600, 80],
          [600, 560],
          [460, 80],
          [460, 560],
        ]),
      ],
    ],
    [
      [
        ...b([
          [360, 200],
          [360, 440],
          [480, 320],
        ]),
        ...g([
          [260, 320],
          [420, 120],
          [420, 520],
          [560, 320],
        ]),
      ],
      [
        ...b([[540, 320]]),
        ...s([
          [600, 100],
          [600, 540],
          [480, 80],
          [480, 560],
          [360, 100],
          [360, 540],
        ]),
      ],
    ],
  ]),
  newPiece("warcamp", "War camp", 880, 560, "heavy", [
    [
      [
        ...g([
          [300, 120],
          [300, 440],
          [380, 200],
          [380, 360],
          [460, 120],
          [460, 440],
          [540, 200],
          [540, 360],
          [620, 280],
          [380, 280],
        ]),
        ...s([
          [800, 100],
          [800, 220],
          [800, 340],
          [800, 460],
        ]),
        ...b([
          [700, 200],
          [700, 360],
        ]),
      ],
    ],
    [
      [
        ...g([
          [300, 140],
          [300, 420],
          [400, 220],
          [400, 340],
          [500, 140],
          [500, 420],
          [600, 220],
          [600, 340],
        ]),
        ...s([
          [800, 160],
          [800, 400],
        ]),
      ],
      [
        ...b([
          [760, 200],
          [760, 360],
        ]),
        ...s([
          [840, 80],
          [840, 480],
          [680, 80],
          [680, 480],
        ]),
        ...g([
          [560, 280],
          [660, 280],
        ]),
      ],
    ],
  ]),
];

export const WARRENS_RECIPE: DungeonRecipe = {
  name: "Goblin Warrens",
  entrance: WARRENS_ENTRANCE,
  boss: WARRENS_THRONE,
  pieces: WARRENS_PIECES,
  ...WARRENS_RULES,
  // D-109–D-111: one slinger in three leads its shots; a boulder does 5.
  leadShare: 1 / 3,
  rockfallDamage: 5,
  fixed: GOBLIN_WARRENS,
};

/** The Goblin Warrens for `seed`: the same seed always builds the same map. */
export function buildWarrens(seed: number): DungeonLayout {
  return buildFromRecipe(WARRENS_RECIPE, seed);
}
