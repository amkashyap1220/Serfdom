import type { DungeonLayout } from "./dungeon-layout.ts";
import { buildForge } from "./ember-forge.ts";
import { buildTemple } from "./sunken-temple.ts";
import { buildHollow } from "./frost-hollow.ts";
import { VAULT_LAYOUT } from "./clockwork-vault.ts";
import { buildGauntlet } from "./abyssal-gauntlet.ts";
import { buildCrypt } from "./forgotten-crypt.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens, GOBLIN_WARRENS } from "./goblin-warrens.ts";
import {
  DUMMY_POSITIONS,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "./test-world.ts";

/** Most players in one dungeon run (D-012, changed from 4 to 10 by the user on 2026-10-22). */
export const MAX_PARTY_SIZE = 10;

export interface DungeonInfo {
  id: string;
  name: string;
  /** One line for the dungeon select menu. */
  blurb: string;
  /** Shown in the dungeon select menu. Unlisted dungeons are test fixtures. */
  listed: boolean;
  /** The fixed layout: seed 0, and the whole dungeon if not generated. */
  layout: DungeonLayout;
  /** Builds the layout for a run's seed (D-104); absent for fixed dungeons. */
  generate?: (seed: number) => DungeonLayout;
  /** Only serfs of at least this level may enter (the endgame dungeons: 20, D-136). */
  minLevel?: number;
}

/**
 * The Phases 1–5 debug map with its dummy, as a one-room dungeon: clearing
 * the dummy completes it. Kept as a deterministic fixture for server tests;
 * not in the menu.
 */
const TRAINING: DungeonLayout = {
  world: TEST_WORLD,
  walls: TEST_WALLS,
  spawn: PLAYER_START,
  rooms: [
    {
      id: "yard",
      name: "Training yard",
      bounds: {
        x: 32,
        y: 32,
        width: TEST_WORLD.width - 64,
        height: TEST_WORLD.height - 64,
      },
      waves: [DUMMY_POSITIONS.map((at) => ({ kind: "dummy" as const, at }))],
      required: true,
    },
  ],
  doors: [],
  exitPortal: null,
};

/** The dungeons a player can queue for (D-048). */
export const DUNGEONS = [
  {
    id: "goblin-warrens",
    name: "Goblin Warrens",
    blurb: "Levels 1–9 · 3–5 min · the Goblin Warlord awaits",
    listed: true,
    layout: GOBLIN_WARRENS,
    generate: buildWarrens,
  },
  {
    // D-108: opens once the serf has completed the Warrens (D-107).
    id: "goblin-stronghold",
    name: "Goblin Stronghold",
    blurb: "Levels 9–12 · 5–7 min · opens after the Warrens",
    listed: true,
    layout: buildStronghold(0),
    generate: buildStronghold,
  },
  {
    // D-120: the third dungeon; opens on the same rule (D-107).
    id: "forgotten-crypt",
    name: "Forgotten Crypt",
    blurb: "Levels 12–15 · 6–8 min · opens after the Warrens",
    listed: true,
    layout: buildCrypt(0),
    generate: buildCrypt,
  },
  {
    // D-130: the fourth dungeon; opens on the same rule (D-107).
    id: "ember-forge",
    name: "Ember Forge",
    blurb: "Levels 15–18 · 7–8 min · opens after the Warrens",
    listed: true,
    layout: buildForge(0),
    generate: buildForge,
  },
  {
    // D-135: the fifth dungeon, the last of the 1–20 ladder (D-126).
    id: "sunken-temple",
    name: "Sunken Temple",
    blurb: "Levels 18–20 · 8 min · opens after the Warrens",
    listed: true,
    layout: buildTemple(0),
    generate: buildTemple,
  },
  {
    // D-136: the first endgame dungeon, for level-20 serfs (D-126).
    id: "frost-hollow",
    name: "Frost Hollow",
    blurb: "Level 20 · 8 min · endgame",
    listed: true,
    layout: buildHollow(0),
    generate: buildHollow,
    minLevel: 20,
  },
  {
    // D-137: an endgame dungeon with a fixed map (D-013): no generate.
    id: "clockwork-vault",
    name: "Clockwork Vault",
    blurb: "Level 20 · 8 min · endgame · the same map every run",
    listed: true,
    layout: VAULT_LAYOUT,
    minLevel: 20,
  },
  {
    // D-138: an endgame dungeon in a special format: one arena, 8 waves.
    id: "abyssal-gauntlet",
    name: "Abyssal Gauntlet",
    blurb: "Level 20 · 8 waves · endgame",
    listed: true,
    layout: buildGauntlet(0),
    generate: buildGauntlet,
    minLevel: 20,
  },
  {
    id: "training",
    name: "Training Yard",
    blurb: "Test fixture: the debug map and its dummy",
    listed: false,
    layout: TRAINING,
  },
] as const satisfies readonly DungeonInfo[];

export type DungeonId = (typeof DUNGEONS)[number]["id"];

export const LISTED_DUNGEONS: readonly (typeof DUNGEONS)[number][] =
  DUNGEONS.filter((d) => d.listed);

export function isDungeonId(v: unknown): v is DungeonId {
  return DUNGEONS.some((d) => d.id === v);
}

/**
 * The layout of one run: the server picks the seed and sends it with
 * runStarted, and every client builds the same map from it (T-050).
 */
export function layoutFor(id: DungeonId, seed: number): DungeonLayout {
  const info: DungeonInfo = dungeonInfo(id);
  return info.generate ? info.generate(seed) : info.layout;
}

/** The first dungeon: always open to every serf (D-018, D-107). */
export const INTRO_DUNGEON: DungeonId = "goblin-warrens";

/**
 * Why this serf may not enter `dungeon`, or null if it may (D-107): the
 * Goblin Warrens is always open, and once a serf has completed it every
 * other dungeon opens, at any level, except the endgame dungeons, which
 * also need level 20 (D-136). A serf's first completion can only be the
 * Warrens, so "at least one completion" is the check. Shown to the player
 * as is.
 */
export function entryProblem(
  dungeon: DungeonId,
  serfClears: number,
  serfLevel = 1,
): string | null {
  if (dungeon === INTRO_DUNGEON) return null;
  if (serfClears <= 0) {
    return `Complete the ${dungeonInfo(INTRO_DUNGEON).name} first.`;
  }
  const min = dungeonInfo(dungeon).minLevel ?? 1;
  return serfLevel >= min ? null : `Reach level ${min} first.`;
}

export function dungeonInfo(id: DungeonId): DungeonInfo {
  const found = DUNGEONS.find((d) => d.id === id);
  if (!found) throw new RangeError(`unknown dungeon ${id}`);
  return found;
}
