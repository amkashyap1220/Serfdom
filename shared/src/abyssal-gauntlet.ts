import type { RoomPiece } from "./dungeon-gen.ts";
import type { DungeonLayout, RuneSpot } from "./dungeon-layout.ts";
import { buildFromRecipe, type DungeonRecipe } from "./dungeon-recipe.ts";
import type { EnemyKind } from "./enemy-config.ts";
import { WARRENS_ENTRANCE, WARRENS_RULES } from "./goblin-warrens.ts";
import { fillRoom } from "./room-fill.ts";

/*
 * The Abyssal Gauntlet (D-138, Phase 13h): an endgame dungeon for level-20
 * serfs in a special format (D-013): no rooms to cross, one arena and eight
 * waves of the earlier dungeons' enemies, each coming when the last is
 * beaten or after 45 s. The arena's traps switch on as the waves go:
 * spirit braziers from wave 2, cursed runes from wave 4, slag spills from
 * wave 6. The eighth wave is the Warden of the Abyss.
 */

const ARENA = { width: 1120, height: 960 } as const;

type Group = [EnemyKind, number][];

/** One wave: those in front, and those along the back. */
const wave = (front: Group, back: Group = []) =>
  fillRoom(ARENA.width, ARENA.height, front, back, []);

/** The eight waves (69,100 HP in all, the Warden's 18,000 included). */
export const GAUNTLET_WAVES = [
  // 5,280: the forge.
  wave([["imp", 12]], [["caster", 6]]),
  // 5,200: the temple.
  wave(
    [
      ["acolyte", 8],
      ["spearman", 4],
    ],
    [["caller", 6]],
  ),
  // 6,540: the hollow.
  wave(
    [
      ["iceimp", 6],
      ["yeti", 3],
    ],
    [["frostarcher", 4]],
  ),
  // 7,960: the vault.
  wave([
    ["drone", 8],
    ["sentry", 6],
  ]),
  // 7,800: the forge's newcomers.
  wave(
    [
      ["elemental", 6],
      ["golem", 3],
    ],
    [["bellows", 4]],
  ),
  // 7,920: the crypt and the hollow.
  wave([
    ["wraith", 6],
    ["knight", 4],
  ]),
  // 10,400: the hardest mix.
  wave(
    [
      ["yeti", 4],
      ["sentry", 4],
    ],
    [["eelpriest", 6]],
  ),
  [
    {
      kind: "warden" as const,
      at: { x: ARENA.width / 2, y: ARENA.height / 2 },
    },
  ],
];

/** Spirit braziers along the north wall, firing south (from wave 2). */
const BRAZIER_XS = [120, 280, 440, 600, 760, 920];
/** Cursed runes over the middle, in five columns (from wave 4). */
const RUNES: RuneSpot[] = [240, 400, 560, 720, 880].flatMap((x, column) =>
  [240, 400, 560, 720].map((y) => ({ at: { x, y }, column })),
);

/** The Abyss arena (D-138): the whole fight. */
export const GAUNTLET_ARENA: RoomPiece = {
  key: "abyss",
  name: "Abyss arena",
  width: ARENA.width,
  height: ARENA.height,
  waves: GAUNTLET_WAVES,
  arrows: {
    slits: BRAZIER_XS.map((x) => ({ x, y: 10 })),
    direction: { x: 0, y: 1 },
    fire: true,
  },
  runes: RUNES,
  rockfall: "slag",
  trapsFromWave: { arrows: 1, runes: 3, rockfall: 5 },
  waveSeconds: 45,
};

export const GAUNTLET_RECIPE: DungeonRecipe = {
  name: "Abyssal Gauntlet",
  entrance: { ...WARRENS_ENTRANCE, name: "Gauntlet gate" },
  boss: GAUNTLET_ARENA,
  // No rooms to cross: the gate opens straight on the arena.
  pieces: [],
  mainPath: [],
  // D-138: 69,100, about 8 minutes for a level-20 serf.
  requiredHp: { min: 66_000, max: 74_000 },
  sideRooms: { min: 0, max: 0 },
  sideBands: [],
  turnWeights: WARRENS_RULES.turnWeights,
  leadShare: 1,
  rockfallDamage: 12,
  arrowDamage: 12,
};

/** The Abyssal Gauntlet for `seed` (seed 0 is seed 1's map, kept fixed). */
export function buildGauntlet(seed: number): DungeonLayout {
  return buildFromRecipe(GAUNTLET_RECIPE, seed);
}
