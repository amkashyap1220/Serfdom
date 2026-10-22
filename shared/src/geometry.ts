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
export function rotateVec(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
