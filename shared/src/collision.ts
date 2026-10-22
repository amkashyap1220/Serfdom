import type { Rect, Vec2 } from "./geometry.ts";

/**
 * Fraction t in [0, 1] along the segment from → to at which a box of
 * half-size `half` centered on the moving point first touches `rect`, or
 * null if it never does. Returns 0 if it already overlaps at the start.
 *
 * Technique: grow the rectangle by the moving box's half-size on every side
 * ("Minkowski sum"), then intersect the center's path with the grown
 * rectangle using the slab method (clip t to the x range, then the y range).
 * Testing the whole path, not just the end point, means fast projectiles
 * cannot skip over thin targets.
 */
export function segmentHitTime(
  from: Vec2,
  to: Vec2,
  half: number,
  rect: Rect,
): number | null {
  const minX = rect.x - half;
  const maxX = rect.x + rect.width + half;
  const minY = rect.y - half;
  const maxY = rect.y + rect.height + half;

  let tEnter = 0;
  let tExit = 1;
  for (const [start, delta, lo, hi] of [
    [from.x, to.x - from.x, minX, maxX],
    [from.y, to.y - from.y, minY, maxY],
  ] as const) {
    if (delta === 0) {
      // Moving parallel to this slab: inside it for the whole step, or never.
      // Strict comparisons: grazing an edge exactly is not a hit.
      if (!(start > lo && start < hi)) return null;
      continue;
    }
    let t0 = (lo - start) / delta;
    let t1 = (hi - start) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
    if (tEnter >= tExit) return null;
  }
  return tEnter;
}

/** Axis-aligned square box centered on `center`. */
export function boxAround(center: Vec2, size: number): Rect {
  return {
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
  };
}
