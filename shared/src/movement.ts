import { rotateVec, type Rect, type Size, type Vec2 } from "./geometry.ts";

/** Which movement keys are held (D-031: WASD, 8-way). */
export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_INPUT: Readonly<MoveInput> = {
  up: false,
  down: false,
  left: false,
  right: false,
};

/**
 * Unit-length movement direction for the held keys, or (0, 0).
 * Opposite keys cancel. Diagonals are normalized so they are not √2 faster.
 * World y grows downward, so "up" is negative y.
 */
export function directionFromInput(input: MoveInput): Vec2 {
  const x = Number(input.right) - Number(input.left);
  const y = Number(input.down) - Number(input.up);
  if (x !== 0 && y !== 0) {
    return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  }
  return { x, y };
}

/**
 * World-space movement direction for keys pressed relative to the screen
 * (D-040). `viewRotation` is the camera rotation in radians; the camera shows
 * a world vector v on screen as rotateVec(v, viewRotation), so "up the screen"
 * in the world is the screen direction rotated back by -viewRotation.
 */
export function worldDirectionFromInput(
  input: MoveInput,
  viewRotation: number,
): Vec2 {
  const screen = directionFromInput(input);
  if (screen.x === 0 && screen.y === 0) return screen;
  return rotateVec(screen, -viewRotation);
}

/** Longest allowed direction vector; the slack absorbs float rounding from rotation. */
const MAX_DIRECTION_LENGTH = 1 + 1e-9;

/**
 * Advances a body by one simulation step (D-032: instant movement, no
 * acceleration) and stops it at walls.
 *
 * `direction` is a unit vector or (0, 0). Anything longer is rejected: a
 * longer vector would mean moving faster than `speed`, which the server
 * must never accept from a client.
 *
 * `position` is the body's center. Movement is resolved one axis at a time
 * (x, then y), so pushing diagonally into a wall slides along it instead of
 * stopping dead. Collision is swept: a wall anywhere between the start and
 * end of the step blocks, so a large step cannot tunnel through a thin wall.
 * Touching a wall edge is not overlapping it.
 */
export function stepMovement(
  position: Vec2,
  direction: Vec2,
  body: Size,
  walls: readonly Rect[],
  dtSeconds: number,
  speed: number,
): Vec2 {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new RangeError(
      `position must be finite, got (${position.x}, ${position.y})`,
    );
  }
  if (!(dtSeconds >= 0) || !Number.isFinite(dtSeconds)) {
    throw new RangeError(`dtSeconds must be finite and >= 0, got ${dtSeconds}`);
  }
  if (!(speed >= 0) || !Number.isFinite(speed)) {
    throw new RangeError(`speed must be finite and >= 0, got ${speed}`);
  }
  if (!(Math.hypot(direction.x, direction.y) <= MAX_DIRECTION_LENGTH)) {
    throw new RangeError(
      `direction must be finite with length <= 1, got (${direction.x}, ${direction.y})`,
    );
  }

  const distance = speed * dtSeconds;
  const halfW = body.width / 2;
  const halfH = body.height / 2;

  // X pass: only walls overlapping the body's current vertical span can block.
  const xBlockers = walls
    .filter((w) =>
      overlapsOpen(position.y - halfH, position.y + halfH, w.y, w.y + w.height),
    )
    .map((w): Span => [w.x, w.x + w.width]);
  const x = sweepAxis(position.x, direction.x * distance, halfW, xBlockers);

  // Y pass uses the already-moved x, which is what produces wall sliding.
  const yBlockers = walls
    .filter((w) => overlapsOpen(x - halfW, x + halfW, w.x, w.x + w.width))
    .map((w): Span => [w.y, w.y + w.height]);
  const y = sweepAxis(position.y, direction.y * distance, halfH, yBlockers);

  return { x, y };
}

/** [start, end] of a wall along one axis. */
type Span = readonly [number, number];

/**
 * Moves `center` by `delta` along one axis and returns the new center,
 * stopping flush against the nearest blocking span in the direction of travel.
 * Spans the body already overlaps are ignored, so a body that somehow starts
 * inside a wall can still move out of it.
 */
function sweepAxis(
  center: number,
  delta: number,
  half: number,
  blockers: readonly Span[],
): number {
  let target = center + delta;
  if (delta > 0) {
    const leadingEdge = center + half;
    for (const [start] of blockers) {
      if (start >= leadingEdge && start < target + half) {
        target = Math.min(target, start - half);
      }
    }
  } else if (delta < 0) {
    const leadingEdge = center - half;
    for (const [, end] of blockers) {
      if (end <= leadingEdge && end > target - half) {
        target = Math.max(target, end + half);
      }
    }
  }
  return target;
}

/** True if open intervals (a0, a1) and (b0, b1) overlap; shared edges do not count. */
function overlapsOpen(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}
