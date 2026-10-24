import type { RoomPiece } from "./dungeon-gen.ts";
import {
  RUNES,
  type DungeonLayout,
  type EnemySpawnDef,
  type RuneSpot,
} from "./dungeon-layout.ts";
import {
  buildFromRecipe,
  thinPiece,
  type DungeonRecipe,
  type RecipePiece,
  type RoomBand,
  type Waves,
} from "./dungeon-recipe.ts";
import type { EnemyKind } from "./enemy-config.ts";
import { WAR_HALL } from "./goblin-stronghold.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";

/*
 * The Forgotten Crypt (D-120, Phase 12i): the third dungeon, levels 12–15,
 * opened by completing the Warrens (D-107). Undead instead of goblins:
 * skeletons that stand up again unless their bone pile is shattered, and
 * skeleton archers. Sarcophagi along some walls open when a wave starts
 * (ambush holes, D-109). 12j adds ghosts, necromancers, and grave knights
 * (D-122); 12k cursed runes and spirit braziers; 12l the Lich. Until then the Goblin
 * Warchief stands in as the boss.
 */

const at = (kind: EnemyKind, points: [number, number][]): EnemySpawnDef[] =>
  points.map(([x, y]) => ({ kind, at: { x, y } }));
const sk = (points: [number, number][]) => at("skeleton", points);
const ar = (points: [number, number][]) => at("archer", points);
/** Every combination of `xs` and `ys`: a block of spawns. */
const grid = (xs: number[], ys: number[]): [number, number][] =>
  xs.flatMap((x) => ys.map((y): [number, number] => [x, y]));

const room = (
  key: string,
  name: string,
  width: number,
  height: number,
  band: RoomBand,
  waves: Waves,
  traps: Pick<
    RoomPiece,
    "holes" | "holeWave" | "obstacles" | "gated" | "runes" | "arrows"
  > = {},
): RecipePiece => ({
  piece: { key, name, width, height, waves, ...traps },
  band,
  setups: [waves],
});

/**
 * Cursed runes over a room's floor (D-123): a grid RUNES.spacing apart,
 * columns counted from the entrance side (west), clear of the entrance and
 * of every obstacle.
 */
function runeGrid(
  width: number,
  height: number,
  obstacles: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [],
): RuneSpot[] {
  const clear = (x: number, y: number) =>
    obstacles.every(
      (o) =>
        x + RUNES.radius < o.x ||
        x - RUNES.radius > o.x + o.width ||
        y + RUNES.radius < o.y ||
        y - RUNES.radius > o.y + o.height,
    );
  const spots: RuneSpot[] = [];
  let column = 0;
  for (let x = 144; x <= width - 64; x += RUNES.spacing, column++) {
    for (let y = 64; y <= height - 64; y += RUNES.spacing) {
      if (clear(x, y)) spots.push({ at: { x, y }, column });
    }
  }
  return spots;
}

/** Spirit braziers along one wall (D-123), 80 px apart, firing `direction`. */
function braziers(
  along: "north" | "south" | "east",
  width: number,
  height: number,
): NonNullable<RoomPiece["arrows"]> {
  const xs = Array.from(
    { length: Math.floor((width - 80) / 80) },
    (_, i) => 80 + 80 * i,
  );
  const ys = Array.from(
    { length: Math.floor((height - 80) / 80) },
    (_, i) => 80 + 80 * i,
  );
  if (along === "north") {
    return {
      slits: xs.map((x) => ({ x, y: 10 })),
      direction: { x: 0, y: 1 },
      fire: true,
    };
  }
  if (along === "south") {
    return {
      slits: xs.map((x) => ({ x, y: height - 10 })),
      direction: { x: 0, y: -1 },
      fire: true,
    };
  }
  return {
    slits: ys.map((y) => ({ x: width - 10, y })),
    direction: { x: -1, y: 0 },
    fire: true,
  };
}

/** Crypt rooms before 12j's undead: skeletons and archers only (D-120). */
const BASE_PIECES: readonly RecipePiece[] = [
  // Light (2,300–2,420).
  // 2,360: a short stair down, archers at the bottom.
  room("stair", "Crypt stair", 560, 400, "light", [
    [
      ...sk(grid([220, 300, 380], [120, 280])),
      ...ar(grid([500], [80, 160, 240, 320])),
    ],
  ]),
  // 2,420: two pillars of stacked bones.
  room(
    "gallery",
    "Bone gallery",
    640,
    400,
    "light",
    [
      [
        ...sk([
          [220, 200],
          [380, 100],
          [380, 200],
          [380, 300],
          [440, 200],
          [500, 100],
          [500, 300],
        ]),
        ...ar(grid([580], [120, 200, 280])),
      ],
    ],
    {
      obstacles: [
        { x: 280, y: 88, width: 48, height: 48 },
        { x: 280, y: 264, width: 48, height: 48 },
      ],
    },
  ),
  // 2,300: archers lined up behind a few skeletons.
  room("mourners", "Mourners' hall", 560, 480, "light", [
    [
      ...sk([
        [240, 140],
        [240, 340],
        [320, 240],
        [400, 140],
        [400, 340],
      ]),
      ...ar([
        [500, 80],
        [500, 180],
        [500, 300],
        [500, 400],
        [440, 240],
      ]),
    ],
  ]),

  // Medium (3,600–3,920).
  // 3,920: the doors seal and the sarcophagi open for a second wave.
  room(
    "ossuary",
    "Ossuary",
    640,
    560,
    "medium",
    [
      [
        ...sk(grid([240, 320, 400, 480], [180, 380])),
        ...ar(grid([580], [100, 220, 340, 460])),
      ],
      sk(grid([520, 560], [200, 360])),
    ],
    {
      holes: [
        { x: 400, y: 20 },
        { x: 600, y: 20 },
        { x: 400, y: 540 },
        { x: 600, y: 540 },
      ],
      holeWave: 1,
      gated: true,
    },
  ),
  // 3,600: a long corridor lined with burial slabs.
  room(
    "catacomb",
    "Catacomb",
    720,
    400,
    "medium",
    [
      [
        ...sk([
          [250, 200],
          [320, 80],
          [320, 200],
          [320, 320],
          [460, 100],
          [460, 200],
          [460, 300],
          [540, 80],
          [540, 200],
          [540, 320],
        ]),
        ...ar([
          [600, 200],
          [660, 80],
          [660, 160],
          [660, 240],
          [660, 320],
        ]),
      ],
    ],
    {
      obstacles: [
        { x: 240, y: 120, width: 160, height: 32 },
        { x: 240, y: 248, width: 160, height: 32 },
      ],
      // D-123: fireballs down the corridor from the far wall.
      arrows: braziers("east", 720, 400),
    },
  ),
  // 3,800: two stone tables near the door.
  room(
    "embalming",
    "Embalming room",
    560,
    560,
    "medium",
    [
      [
        ...sk(grid([320, 400], [100, 200, 280, 360, 460])),
        ...ar([
          [440, 280],
          [500, 80],
          [500, 180],
          [500, 280],
          [500, 380],
          [500, 480],
        ]),
      ],
    ],
    {
      obstacles: [
        { x: 200, y: 140, width: 64, height: 32 },
        { x: 200, y: 388, width: 64, height: 32 },
      ],
      // D-123: runes sweep the floor.
      runes: runeGrid(560, 560, [
        { x: 200, y: 140, width: 64, height: 32 },
        { x: 200, y: 388, width: 64, height: 32 },
      ]),
    },
  ),
  // 3,680: pews to the north and south, archers at the altar.
  room(
    "chapel",
    "Chapel",
    640,
    560,
    "medium",
    [
      [
        ...sk([
          [240, 280],
          [320, 280],
          [400, 280],
          [480, 280],
          [300, 200],
          [300, 360],
          [460, 200],
          [460, 360],
        ]),
        ...ar([
          [520, 80],
          [520, 380],
          [520, 480],
          [580, 80],
          [580, 180],
          [580, 280],
          [580, 380],
          [580, 480],
        ]),
      ],
    ],
    {
      obstacles: [
        { x: 240, y: 120, width: 96, height: 24 },
        { x: 400, y: 120, width: 96, height: 24 },
        { x: 240, y: 416, width: 96, height: 24 },
        { x: 400, y: 416, width: 96, height: 24 },
      ],
      // D-123: runes between the pews.
      runes: runeGrid(640, 560, [
        { x: 240, y: 120, width: 96, height: 24 },
        { x: 400, y: 120, width: 96, height: 24 },
        { x: 240, y: 416, width: 96, height: 24 },
        { x: 400, y: 416, width: 96, height: 24 },
      ]),
    },
  ),

  // Heavy (5,700–5,960).
  // 5,880: a crowd, then the sarcophagi along the walls open.
  room(
    "vault",
    "Burial vault",
    720,
    560,
    "heavy",
    [
      [
        ...sk(grid([260, 340, 420, 500], [140, 280, 420])),
        ...ar([
          [580, 280],
          [640, 80],
          [640, 180],
          [640, 280],
          [640, 380],
          [640, 480],
        ]),
      ],
      sk(grid([560, 600, 640], [200, 360])),
    ],
    {
      holes: [
        { x: 300, y: 20 },
        { x: 500, y: 20 },
        { x: 300, y: 540 },
        { x: 500, y: 540 },
        { x: 700, y: 280 },
      ],
      holeWave: 1,
      // D-123: braziers along the north wall, between the sarcophagi.
      arrows: braziers("north", 720, 560),
    },
  ),
  // 5,760: an open pit full of the dead, runes across its floor (D-123).
  room(
    "charnel",
    "Charnel pit",
    640,
    640,
    "heavy",
    [
      [
        ...sk(grid([240, 320, 400, 480], [120, 240, 400, 520])),
        ...ar([
          [520, 80],
          [520, 560],
          [580, 80],
          [580, 180],
          [580, 280],
          [580, 360],
          [580, 460],
          [580, 560],
        ]),
      ],
    ],
    { runes: runeGrid(640, 640) },
  ),
  // 5,960: four pillars, and a second wave from the back.
  room(
    "deadhall",
    "Hall of the dead",
    800,
    560,
    "heavy",
    [
      [
        ...sk([
          [200, 280],
          [320, 200],
          [320, 360],
          [360, 100],
          [360, 280],
          [360, 460],
          [400, 280],
          [440, 180],
          [440, 380],
        ]),
        ...ar([
          [640, 280],
          [700, 100],
          [700, 220],
          [700, 340],
          [700, 460],
        ]),
      ],
      [
        ...sk([
          [460, 280],
          [600, 280],
          [620, 100],
          [620, 460],
          [660, 200],
          [660, 360],
          [740, 280],
        ]),
        ...ar([
          [740, 180],
          [740, 380],
          [760, 80],
          [760, 480],
        ]),
      ],
    ],
    {
      obstacles: [
        { x: 240, y: 136, width: 48, height: 48 },
        { x: 240, y: 376, width: 48, height: 48 },
        { x: 520, y: 136, width: 48, height: 48 },
        { x: 520, y: 376, width: 48, height: 48 },
      ],
    },
  ),
  // 5,700: the old kings' tombs, guarded.
  room(
    "kings",
    "Tomb of kings",
    720,
    640,
    "heavy",
    [
      [
        ...sk(grid([360, 560, 620], [100, 240, 320, 400, 540])),
        ...ar([
          [300, 320],
          [500, 320],
          ...grid([680], [80, 160, 240, 320, 400, 480, 560]),
        ]),
      ],
    ],
    {
      obstacles: [
        { x: 240, y: 160, width: 64, height: 32 },
        { x: 440, y: 160, width: 64, height: 32 },
        { x: 240, y: 448, width: 64, height: 32 },
        { x: 440, y: 448, width: 64, height: 32 },
      ],
      // D-123: braziers along the south wall; the tombs give cover.
      arrows: braziers("south", 720, 640),
    },
  ),
];

/**
 * The undead swapped into each room's first wave (D-122): grave knights
 * and ghosts take the skeletons nearest the entrance (they come at you),
 * necromancers the archers farthest back (they hang back).
 */
const NEW_UNDEAD: Readonly<
  Record<string, Partial<Record<"ghost" | "necromancer" | "knight", number>>>
> = {
  catacomb: { ghost: 2 },
  chapel: { ghost: 2 },
  ossuary: { necromancer: 1 },
  embalming: { knight: 1 },
  vault: { necromancer: 1 },
  charnel: { necromancer: 2, knight: 1 },
  deadhall: { ghost: 3, knight: 1 },
  kings: { necromancer: 1, knight: 2 },
};

function withNewUndead(entry: RecipePiece): RecipePiece {
  const swaps = NEW_UNDEAD[entry.piece.key];
  if (!swaps) return entry;
  const swapWave = (wave: readonly EnemySpawnDef[]): EnemySpawnDef[] => {
    const out = wave.map((sp) => ({ ...sp }));
    // By distance from the entrance side (x; the entrance is on the west).
    const of = (kind: EnemyKind) =>
      out
        .map((sp, i) => ({ sp, i }))
        .filter(({ sp }) => sp.kind === kind)
        .sort((a, b) => a.sp.at.x - b.sp.at.x);
    const take = (
      pool: { i: number }[],
      from: EnemyKind,
      kind: EnemyKind,
      n: number,
    ) => {
      for (let k = 0; k < n; k++) {
        const found = pool.find(({ i }) => out[i]!.kind === from);
        if (!found)
          throw new Error(
            `${entry.piece.key}: not enough ${from}s for ${kind}`,
          );
        out[found.i] = { ...out[found.i]!, kind };
      }
    };
    take(of("skeleton"), "skeleton", "knight", swaps.knight ?? 0);
    take(of("skeleton"), "skeleton", "ghost", swaps.ghost ?? 0);
    take(
      of("archer").reverse(),
      "archer",
      "necromancer",
      swaps.necromancer ?? 0,
    );
    return out;
  };
  const setups = entry.setups.map((waves) =>
    waves.map((wave, w) => (w === 0 ? swapWave(wave) : [...wave])),
  );
  return { ...entry, piece: { ...entry.piece, waves: setups[0]! }, setups };
}

/** Crypt rooms with runes or braziers (D-123): they need fewer undead. */
export const CRYPT_MECHANIC_ROOMS: ReadonlySet<string> = new Set([
  "chapel",
  "embalming",
  "charnel",
  "catacomb",
  "vault",
  "kings",
]);

/**
 * Crypt rooms: entrance on the west, positions relative to the floor. HP is
 * solo. 12j's undead in (D-122), then rooms with runes or braziers lose 20%
 * of their skeletons and archers (D-123).
 */
export const CRYPT_PIECES: readonly RecipePiece[] = BASE_PIECES.map(
  withNewUndead,
).map((entry) =>
  CRYPT_MECHANIC_ROOMS.has(entry.piece.key)
    ? thinPiece(entry, 0.2, ["skeleton", "archer"])
    : entry,
);

/**
 * The crypt's boss room. Until the Lich (12l) the Goblin Warchief stands in,
 * in a copy of its War hall (pillars and holes included).
 */
export const CRYPT_SANCTUM: RoomPiece = {
  ...WAR_HALL,
  key: "sanctum",
  name: "Sanctum",
};

export const CRYPT_RECIPE: DungeonRecipe = {
  name: "Forgotten Crypt",
  entrance: { ...WARRENS_ENTRANCE, name: "Crypt gate" },
  boss: CRYPT_SANCTUM,
  pieces: CRYPT_PIECES,
  mainPath: ["light", "medium", "medium", "medium", "heavy", "heavy", "heavy"],
  // D-120: 40,000–48,000 with the Lich (11,000); 3,000 less while the
  // Warchief (8,000) stands in. About 7 minutes for a level-12 serf.
  requiredHp: { min: 37_000, max: 45_000 },
  sideRooms: WARRENS_RULES.sideRooms,
  sideBands: WARRENS_RULES.sideBands,
  turnWeights: WARRENS_RULES.turnWeights,
  // No slingers here (archers always lead), no boulders; D-123: a
  // brazier's fireball does 10.
  leadShare: 1,
  rockfallDamage: 9,
  arrowDamage: 10,
};

/** The Forgotten Crypt for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildCrypt(seed: number): DungeonLayout {
  return buildFromRecipe(CRYPT_RECIPE, seed);
}
