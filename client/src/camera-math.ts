// Pure camera visibility rules, kept free of Phaser so they are unit-testable.

/** Minimum world pixels visible from the player's center in each cardinal direction (D-029). */
export const MIN_VISIBLE_WORLD_PX = 300;

export interface VisibleExtent {
  /** World pixels visible to the left (and to the right) of the view center. */
  horizontal: number;
  /** World pixels visible above (and below) the view center. */
  vertical: number;
}

/**
 * How far the camera can see from its center, in world pixels.
 *
 * Phaser camera zoom is "screen pixels per world pixel": zoom 2 makes each
 * world pixel 2 canvas pixels wide, so the same viewport shows half as much world.
 */
export function visibleExtentFromCenter(
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): VisibleExtent {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    throw new RangeError(
      `Camera zoom must be a positive finite number, got ${zoom}`,
    );
  }
  if (!(viewportWidth >= 0) || !(viewportHeight >= 0)) {
    throw new RangeError(
      `Viewport size must be non-negative, got ${viewportWidth}×${viewportHeight}`,
    );
  }
  return {
    horizontal: viewportWidth / zoom / 2,
    vertical: viewportHeight / zoom / 2,
  };
}

export function meetsVisibilityTarget(
  extent: VisibleExtent,
  minimum: number = MIN_VISIBLE_WORLD_PX,
): boolean {
  return extent.horizontal >= minimum && extent.vertical >= minimum;
}

/** Rotation speed while Q/E is held, in degrees per second (PROVISIONAL, D-040). */
export const VIEW_ROTATION_DEG_PER_SEC = 120;

export interface RotateInput {
  /** Q: turn the view left (the world appears to turn clockwise). */
  left: boolean;
  /** E: turn the view right. */
  right: boolean;
  /** Z: snap back to north-up. */
  reset: boolean;
}

/**
 * Next camera rotation in radians, normalized to [0, 2π). Positive camera
 * rotation turns the world clockwise on screen, which is what turning your
 * view to the left looks like, so Q increases the angle.
 */
export function stepViewRotation(
  rotation: number,
  input: RotateInput,
  dtSeconds: number,
  degPerSec: number = VIEW_ROTATION_DEG_PER_SEC,
): number {
  if (input.reset) return 0;
  const turn = Number(input.left) - Number(input.right);
  const dt = Number.isFinite(dtSeconds) ? Math.max(dtSeconds, 0) : 0;
  const next = rotation + turn * ((degPerSec * Math.PI) / 180) * dt;
  const full = Math.PI * 2;
  return ((next % full) + full) % full;
}
