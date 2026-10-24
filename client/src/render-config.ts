// Client-only rendering constants for the debug scene.

/** Source-pixel size of the player placeholder sprite (D-127, was 16 under D-022). */
export const PLAYER_SPRITE_SIZE = 32;

/**
 * The world camera's zoom (D-127): 0.5 shows 1440×1280 world px in the
 * 720×640 gameplay viewport (720 and 640 from the player each way, well
 * past D-029's 300), so the 32 px player and enemies draw at 16 CSS px.
 */
export const CAMERA_ZOOM = 0.5;

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
