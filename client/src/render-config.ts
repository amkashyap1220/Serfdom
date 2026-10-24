// Client-only rendering constants for the debug scene.

/** Source-pixel size of the player placeholder sprite (D-127, was 16 under D-022). */
export const PLAYER_SPRITE_SIZE = 32;

/**
 * The world camera's zoom (D-131; was 0.5 under D-127): 1 draws every 32
 * px sprite at 32 CSS px, one art pixel per screen pixel, so pixel art
 * stays crisp. The 960×800 gameplay viewport shows 480 world px left and
 * right of the player and 400 up and down, past D-029's 300.
 */
export const CAMERA_ZOOM = 1;

/**
 * A size meant in CSS pixels (line widths, text), in world pixels at the
 * camera's zoom, so outlines and labels stay as thick and as readable as
 * at zoom 1.
 */
export function px(cssPixels: number): number {
  return cssPixels / CAMERA_ZOOM;
}

/** Debug grid: thin line every minor step, brighter every major, coordinate label every `label`. */
export const GRID = { minor: 50, major: 100, label: 200 } as const;
