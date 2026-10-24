// Client-only rendering constants for the debug scene.

/** Source-pixel size of the player placeholder sprite (D-127, was 16 under D-022). */
export const PLAYER_SPRITE_SIZE = 32;

/** Debug grid: thin line every minor step, brighter every major, coordinate label every `label`. */
export const GRID = { minor: 50, major: 100, label: 200 } as const;
