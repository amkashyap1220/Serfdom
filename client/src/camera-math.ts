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
