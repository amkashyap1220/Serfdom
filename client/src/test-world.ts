// PROVISIONAL Phase 1 debug world. These values exist only to make the
// layout and camera testable; they are not game design.

/** Size of the debug world in world pixels. */
export const TEST_WORLD = { width: 2000, height: 2000 } as const;

/** Where the placeholder player stands (world pixels). */
export const PLAYER_START = { x: 1000, y: 1000 } as const;

/** Source-pixel size of the player placeholder sprite (D-022). */
export const PLAYER_SPRITE_SIZE = 16;

/** Debug grid: thin line every minor step, labelled line every major step (world pixels). */
export const GRID = { minor: 50, major: 100 } as const;
