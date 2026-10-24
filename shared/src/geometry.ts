/** A point or direction in world pixels. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in world pixels; (x, y) is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Rotates a vector by `radians`. World y grows downward, so a positive angle
 * turns clockwise as seen on screen (the same convention as Phaser).
 */
/**
 * Step `k` of a back-and-forth sweep over `n` positions: 0, 1, …, n-1,
 * n-2, …, 1, 0, 1, … (the crypt's runes, D-123; the Forgemaster's lane, D-134).
 */
export function sweepIndex(k: number, n: number): number {
  if (n <= 1) return 0;
  const period = 2 * n - 2;
  const i = k % period;
  return i < n ? i : period - i;
}

export function rotateVec(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
