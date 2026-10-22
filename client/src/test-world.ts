import type { Rect } from "@serfdom/shared";

// PROVISIONAL debug world for Phases 1–2. These values exist only to make
// layout, movement, collision, and camera behavior testable; not game design.

/** Size of the debug world in world pixels. Outside it is void (D-033). */
export const TEST_WORLD = { width: 2000, height: 2000 } as const;

/** Where the placeholder player starts (world pixels, body center). */
export const PLAYER_START = { x: 1000, y: 1000 } as const;

/** Source-pixel size of the player placeholder sprite (D-022). */
export const PLAYER_SPRITE_SIZE = 16;

/** Debug grid: thin line every minor step, brighter every major, coordinate label every `label`. */
export const GRID = { minor: 50, major: 100, label: 200 } as const;

const BORDER = 32;

/** Blocking walls. Each one exists to exercise a specific collision case. */
export const TEST_WALLS: readonly Rect[] = [
  // Border walls just inside the world edge, so the player can walk right up
  // to the edge and see the void beyond it.
  { x: 0, y: 0, width: TEST_WORLD.width, height: BORDER },
  {
    x: 0,
    y: TEST_WORLD.height - BORDER,
    width: TEST_WORLD.width,
    height: BORDER,
  },
  { x: 0, y: 0, width: BORDER, height: TEST_WORLD.height },
  {
    x: TEST_WORLD.width - BORDER,
    y: 0,
    width: BORDER,
    height: TEST_WORLD.height,
  },

  // Square block up-right of the start: walk into each face; slide along it.
  { x: 1100, y: 900, width: 64, height: 64 },

  // L-shaped inside corner down-left of the start: push diagonally into it.
  { x: 868, y: 1000, width: 32, height: 150 },
  { x: 700, y: 1150, width: 200, height: 32 },

  // Gap 24 px wide (wider than the 16 px body): passable.
  { x: 1000, y: 1250, width: 200, height: 32 },
  { x: 1224, y: 1250, width: 200, height: 32 },

  // Gap 12 px wide (narrower than the body): must block.
  { x: 1000, y: 1400, width: 200, height: 32 },
  { x: 1212, y: 1400, width: 200, height: 32 },
];

/**
 * Target dummies (Phase 3b). (1300, 1100) is ~316 px from the start, just
 * outside the 300 px auto-aim range, so nothing fires until you walk closer.
 * Standing at about (1090, 890), top-left of the square block, the dummy is
 * in range but the block lies on the line of fire: shots must be blocked.
 */
export const DUMMY_POSITIONS: readonly { x: number; y: number }[] = [
  { x: 1300, y: 1100 },
];
