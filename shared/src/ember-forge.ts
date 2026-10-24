import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout, EnemySpawnDef } from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  thinPiece,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
} from "./dungeon-recipe.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import { clearAt, fillRoom } from "./room-fill.ts";
import type { Rect } from "./geometry.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";

/*
 * The Ember Forge (D-130, Phase 13a): the fourth dungeon, levels 15–18,
 * opened by completing the Warrens (D-107). Forge imps (the skulker's
 * flanking) and ember casters (the bomber's lob) among lava channels that
 * burn players and that enemies walk round; fire elementals, magma golems,
 * and bellows-keepers (13b, D-132); fire jets and slag spills (13c, D-133).
 * The Forgemaster (13d, D-134) waits in the Forge heart.
 */

/**
 * `imps` imps spread over the front and middle of the room and `casters`
 * ember casters along the back, every spawn clear of the room's obstacles
 * and lava (the shared placement, `fillRoom`).
 */
function fill(
  width: number,
  height: number,
  imps: number,
  casters: number,
  blocked: readonly Rect[],
): EnemySpawnDef[] {
  return fillRoom(
    width,
    height,
    [["imp", imps]],
    [["caster", casters]],
    blocked,
  );
}

/** 13b's newcomers in a room (D-132). */
interface Newcomers {
  /** Each takes one of the imps nearest the entrance. */
  elemental?: number;
  /** Each takes the front-most imp spot clear for its 44 px, and 3 more imps go. */
  golem?: number;
  /** Each takes one of the casters farthest back. */
  bellows?: number;
}

/** Imps a magma golem replaces (D-132): it stands where four stood. */
const IMPS_PER_GOLEM = 4;

/** Swap 13b's newcomers into a filled room (D-132). Deterministic. */
function withNewcomers(
  key: string,
  wave: readonly EnemySpawnDef[],
  newcomers: Newcomers,
  blocked: readonly Rect[],
): EnemySpawnDef[] {
  let out = wave.map((sp) => ({ ...sp }));
  // Imps front to back (the entrance is on the west), casters back to front.
  const imps = () =>
    out.filter((sp) => sp.kind === "imp").sort((a, b) => a.at.x - b.at.x);
  const need = (what: string) => {
    throw new Error(`${key}: not enough room for ${what}`);
  };
  for (let k = 0; k < (newcomers.golem ?? 0); k++) {
    const spot =
      imps().find((sp) =>
        clearAt(sp.at.x, sp.at.y, ENEMY_STATS.golem.size, blocked),
      ) ?? need("a magma golem");
    spot.kind = "golem";
    // The three imps nearest it go, so it stands where four stood.
    const gone = new Set(
      imps()
        .sort(
          (a, b) =>
            Math.hypot(a.at.x - spot.at.x, a.at.y - spot.at.y) -
            Math.hypot(b.at.x - spot.at.x, b.at.y - spot.at.y),
        )
        .slice(0, IMPS_PER_GOLEM - 1),
    );
    if (gone.size < IMPS_PER_GOLEM - 1) need("a magma golem");
    out = out.filter((sp) => !gone.has(sp));
  }
  for (let k = 0; k < (newcomers.elemental ?? 0); k++) {
    (imps()[0] ?? need("a fire elemental")).kind = "elemental";
  }
  for (let k = 0; k < (newcomers.bellows ?? 0); k++) {
    const caster =
      out
        .filter((sp) => sp.kind === "caster")
        .sort((a, b) => b.at.x - a.at.x)[0] ?? need("a bellows-keeper");
    caster.kind = "bellows";
  }
  return out;
}

const room = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  [imps, casters]: [number, number],
  traps: Pick<RoomPiece, "obstacles" | "lava" | "arrows" | "rockfall"> = {},
  newcomers: Newcomers = {},
): RecipePiece => {
  const blocked = [...(traps.obstacles ?? []), ...(traps.lava ?? [])];
  const waves = [
    withNewcomers(
      key,
      fill(width, height, imps, casters, blocked),
      newcomers,
      blocked,
    ),
  ];
  return {
    piece: { key, name, width, height, waves, ...traps },
    band,
    setups: [waves],
  };
};

/** Light rooms: 8 imps and 4 casters (3,520 HP before 13b's swaps). */
const LIGHT: [number, number] = [8, 4];
/** Medium rooms: 12 imps and 7 casters (5,560 HP). */
const MEDIUM: [number, number] = [12, 7];
/** Heavy rooms: 17 imps and 9 casters (7,620 HP). */
const HEAVY: [number, number] = [17, 9];

/**
 * Fire-jet nozzles (D-133): `count` along the north wall, 128 px apart from
 * x = `first`, firing south across the room.
 */
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

/** Rooms with fire jets or slag spills: 20% fewer imps and casters, imps first (D-133). */
export const FORGE_TRAP_ROOMS: ReadonlySet<string> = new Set([
  "bellows",
  "orestore",
  "anvils",
  "chains",
  "slagpit",
  "furnace",
]);

/** Forge rooms: entrance on the west, positions relative to the floor. HP is solo. */
const ROOMS: readonly RecipePiece[] = [
  room(
    "ashroom",
    "Ash antechamber",
    640,
    480,
    "light",
    LIGHT,
    {},
    {
      elemental: 2,
    },
  ),
  room(
    "bellows",
    "Bellows room",
    640,
    480,
    "light",
    LIGHT,
    {
      obstacles: [
        { x: 280, y: 96, width: 64, height: 48 },
        { x: 280, y: 336, width: 64, height: 48 },
      ],
      // The second jet's beam stops at the first bellows block.
      arrows: jets(184, 4),
    },
    { bellows: 1 },
  ),
  room("orestore", "Ore store", 560, 560, "light", LIGHT, {
    obstacles: [
      { x: 240, y: 120, width: 48, height: 48 },
      { x: 240, y: 392, width: 48, height: 48 },
      { x: 384, y: 256, width: 48, height: 48 },
    ],
    rockfall: "slag",
  }),
  // A lava channel across the middle, open at both ends.
  room(
    "smelter",
    "Smelter",
    720,
    560,
    "medium",
    MEDIUM,
    {
      lava: [{ x: 200, y: 248, width: 320, height: 64 }],
    },
    { elemental: 2 },
  ),
  room(
    "anvils",
    "Anvil hall",
    720,
    560,
    "medium",
    MEDIUM,
    {
      obstacles: [
        { x: 240, y: 140, width: 64, height: 40 },
        { x: 440, y: 140, width: 64, height: 40 },
        { x: 240, y: 380, width: 64, height: 40 },
        { x: 440, y: 380, width: 64, height: 40 },
      ],
      rockfall: "slag",
    },
    { golem: 1 },
  ),
  // Two staggered channels: the way through zigzags between them.
  room(
    "quench",
    "Quench room",
    640,
    640,
    "medium",
    MEDIUM,
    {
      lava: [
        { x: 240, y: 64, width: 48, height: 236 },
        { x: 400, y: 340, width: 48, height: 236 },
      ],
    },
    { bellows: 1 },
  ),
  room(
    "chains",
    "Chain gallery",
    800,
    480,
    "medium",
    MEDIUM,
    {
      obstacles: [256, 448, 640].flatMap((x) => [
        { x, y: 128, width: 32, height: 32 },
        { x, y: 320, width: 32, height: 32 },
      ]),
      // The second and fifth jets line up with pillars, which stop them.
      arrows: jets(144, 5),
    },
    { elemental: 3 },
  ),
  // A cross of lava; the corners are the ways round.
  room(
    "slagpit",
    "Slag pit",
    720,
    720,
    "heavy",
    HEAVY,
    {
      lava: [
        { x: 160, y: 328, width: 400, height: 64 },
        { x: 328, y: 160, width: 64, height: 400 },
      ],
      rockfall: "slag",
    },
    { golem: 1 },
  ),
  // Four bars of lava round the middle, gaps at the corners.
  room(
    "crucible",
    "Crucible hall",
    800,
    640,
    "heavy",
    HEAVY,
    {
      lava: [
        { x: 280, y: 160, width: 240, height: 48 },
        { x: 280, y: 432, width: 240, height: 48 },
        { x: 200, y: 240, width: 48, height: 160 },
        { x: 552, y: 240, width: 48, height: 160 },
      ],
    },
    { elemental: 2, golem: 1 },
  ),
  room(
    "furnace",
    "Great furnace",
    800,
    640,
    "heavy",
    HEAVY,
    {
      obstacles: [{ x: 400, y: 240, width: 160, height: 160 }],
      // The furnace itself stops the third and fourth jets.
      arrows: jets(160, 5),
    },
    { golem: 2, bellows: 1 },
  ),
  room(
    "foundry",
    "Foundry",
    720,
    720,
    "heavy",
    HEAVY,
    {
      lava: [
        { x: 160, y: 200, width: 280, height: 48 },
        { x: 280, y: 472, width: 280, height: 48 },
      ],
      obstacles: [
        { x: 560, y: 120, width: 48, height: 48 },
        { x: 160, y: 600, width: 48, height: 48 },
      ],
    },
    { golem: 1, bellows: 1 },
  ),
];

export const FORGE_PIECES: readonly RecipePiece[] = ROOMS.map((entry) =>
  FORGE_TRAP_ROOMS.has(entry.piece.key)
    ? thinPiece(entry, 0.2, ["imp", "caster"])
    : entry,
);

/**
 * The Forge heart (D-134): the Forgemaster in the middle (the portal opens
 * where it dies), a forge door in the north and south walls for its golems,
 * and no pillars, so its floor plates and safe lane stay easy to read.
 */
export const FORGE_HEART: RoomPiece = {
  key: "forgeheart",
  name: "Forge heart",
  width: 720,
  height: 640,
  waves: [[{ kind: "forgemaster", at: { x: 360, y: 320 } }]],
  holes: [
    { x: 360, y: 20 },
    { x: 360, y: 620 },
  ],
};

export const FORGE_RECIPE: DungeonRecipe = {
  name: "Ember Forge",
  entrance: { ...WARRENS_ENTRANCE, name: "Forge gate" },
  boss: FORGE_HEART,
  pieces: FORGE_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-130: 52,000–62,000 with the Forgemaster (14,000), about 7.5
  // minutes for a level-15 serf. Main paths: 54,030–57,170 (D-133, D-134).
  requiredHp: { min: 52_000, max: 62_000 },
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
