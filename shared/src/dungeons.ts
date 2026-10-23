import type { Rect, Vec2 } from "./geometry.ts";
import {
  DUMMY_POSITIONS,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "./test-world.ts";

/** Most players in one dungeon run (D-012, changed from 4 to 10 by the user on 2026-10-22). */
export const MAX_PARTY_SIZE = 10;

/** Everything both sides need to run and draw one dungeon. */
export interface DungeonLayout {
  world: { width: number; height: number };
  walls: readonly Rect[];
  /** Where every party member starts. */
  spawn: Vec2;
  enemySpawns: readonly Vec2[];
}

export interface DungeonInfo {
  id: string;
  name: string;
  /** One line for the dungeon select menu. */
  blurb: string;
  layout: DungeonLayout;
}

/**
 * The dungeons a player can queue for (D-048). Phase 6a: Goblin Warrens is
 * a stand-in that reuses the debug map and dummy, so the menu → queue → run
 * → results loop can be tested before the real map exists (6b). Clearing
 * every enemy completes it.
 */
export const DUNGEONS = [
  {
    id: "goblin-warrens",
    name: "Goblin Warrens",
    blurb: "Levels 1–9 · 3–5 min · stand-in map (Phase 6a)",
    layout: {
      world: TEST_WORLD,
      walls: TEST_WALLS,
      spawn: PLAYER_START,
      enemySpawns: DUMMY_POSITIONS,
    },
  },
] as const satisfies readonly DungeonInfo[];

export type DungeonId = (typeof DUNGEONS)[number]["id"];

export function isDungeonId(v: unknown): v is DungeonId {
  return DUNGEONS.some((d) => d.id === v);
}

export function dungeonInfo(id: DungeonId): DungeonInfo {
  const found = DUNGEONS.find((d) => d.id === id);
  if (!found) throw new RangeError(`unknown dungeon ${id}`);
  return found;
}
