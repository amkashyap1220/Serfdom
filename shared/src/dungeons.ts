import type { DungeonLayout } from "./dungeon-layout.ts";
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
 * other dungeon opens, at any level. A serf's first completion can only be
 * the Warrens, so "at least one completion" is the check. Shown to the
 * player as is.
 */
export function entryProblem(
  dungeon: DungeonId,
  serfClears: number,
): string | null {
  if (dungeon === INTRO_DUNGEON || serfClears > 0) return null;
  return `Complete the ${dungeonInfo(INTRO_DUNGEON).name} first.`;
}

export function dungeonInfo(id: DungeonId): DungeonInfo {
  const found = DUNGEONS.find((d) => d.id === id);
  if (!found) throw new RangeError(`unknown dungeon ${id}`);
  return found;
}
