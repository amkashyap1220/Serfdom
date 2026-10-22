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
