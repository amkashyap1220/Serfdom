import type { DungeonLayout } from "./dungeon-layout.ts";
import { GOBLIN_WARRENS } from "./goblin-warrens.ts";
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
  layout: DungeonLayout;
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
};

/** The dungeons a player can queue for (D-048). */
export const DUNGEONS = [
  {
    id: "goblin-warrens",
    name: "Goblin Warrens",
    blurb: "Levels 1–9 · 3–5 min · boss arrives in Phase 6c",
    listed: true,
    layout: GOBLIN_WARRENS,
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

export function dungeonInfo(id: DungeonId): DungeonInfo {
  const found = DUNGEONS.find((d) => d.id === id);
  if (!found) throw new RangeError(`unknown dungeon ${id}`);
  return found;
}
