import { segmentHitTime } from "./collision.ts";
import type { Rect, Vec2 } from "./geometry.ts";

/*
 * Goblins find their way round walls, doorways, and obstacles (D-112,
 * D-114): a grid over the dungeon, and for each target a distance field
 * (breadth-first from the target's cell). An enemy walks downhill on it,
 * skipping ahead to the farthest step it can reach in a straight line.
 * Server only: the client does not move enemies.
 */

/** Grid cell size, world px. */
export const NAV_CELL = 16;
/** Cells this close to a wall count as blocked, so bodies fit (about a brute's half). */
export const NAV_CLEARANCE = 8;
/** How many downhill steps ahead an enemy may aim. */
const LOOKAHEAD = 6;
/** Distance fields kept at once (one per target cell); old ones are dropped. */
const MAX_FIELDS = 32;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export class Navigator {
  private readonly walls: readonly Rect[];
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly fields = new Map<number, Int32Array>();

  /** `walls`: everything that blocks movement now (closed doors included). */
  constructor(walls: readonly Rect[]) {
    this.walls = walls;
    const xs = walls.flatMap((w) => [w.x, w.x + w.width]);
    const ys = walls.flatMap((w) => [w.y, w.y + w.height]);
    this.x0 =
      Math.floor((xs.length ? Math.min(...xs) : 0) / NAV_CELL) * NAV_CELL;
    this.y0 =
      Math.floor((ys.length ? Math.min(...ys) : 0) / NAV_CELL) * NAV_CELL;
    this.cols =
      Math.ceil(((xs.length ? Math.max(...xs) : 0) - this.x0) / NAV_CELL) + 1;
    this.rows =
      Math.ceil(((ys.length ? Math.max(...ys) : 0) - this.y0) / NAV_CELL) + 1;
    this.blocked = new Uint8Array(this.cols * this.rows);
    // A cell is blocked when its centre is inside a wall grown by the clearance.
    for (const w of walls) {
      const c0 = Math.ceil((w.x - NAV_CLEARANCE - this.x0) / NAV_CELL - 0.5);
      const c1 = Math.floor(
        (w.x + w.width + NAV_CLEARANCE - this.x0) / NAV_CELL - 0.5,
      );
      const r0 = Math.ceil((w.y - NAV_CLEARANCE - this.y0) / NAV_CELL - 0.5);
      const r1 = Math.floor(
        (w.y + w.height + NAV_CLEARANCE - this.y0) / NAV_CELL - 0.5,
      );
      for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
          this.blocked[r * this.cols + c] = 1;
        }
      }
    }
  }

  /**
   * Where an enemy at `from` should head to reach `to`: a point along the
   * shortest way round everything in between, as far ahead as it can walk
   * straight; null if `to` cannot be reached (or is off the grid).
   */
  next(from: Vec2, to: Vec2, half: number): Vec2 | null {
    const target = this.cellOf(to);
    const start = this.cellOf(from);
    if (target < 0 || start < 0) return null;
    const dist = this.field(target);
    // Pressed against a wall, its own cell may be blocked: use the best
    // reachable neighbour as the first step.
    let cur = dist[start]! >= 0 ? start : this.bestNeighbour(dist, start);
    if (cur < 0) return null;
    const path = [cur];
    for (let i = 0; i < LOOKAHEAD && dist[cur]! > 0; i++) {
      const step = this.bestNeighbour(dist, cur);
      if (step < 0 || dist[step]! >= dist[cur]!) break;
      cur = step;
      path.push(cur);
    }
    // The farthest step it can walk to straight; at least the first.
    for (let i = path.length - 1; i > 0; i--) {
      const p = this.centre(path[i]!);
      if (!this.walls.some((w) => segmentHitTime(from, p, half, w) !== null)) {
        return p;
      }
    }
    return this.centre(path[Math.min(1, path.length - 1)]!);
  }

  private field(target: number): Int32Array {
    let dist = this.fields.get(target);
    if (dist) return dist;
    dist = new Int32Array(this.cols * this.rows).fill(-1);
    dist[target] = 0;
    const queue = new Int32Array(this.cols * this.rows);
    let head = 0;
    let tail = 0;
    queue[tail++] = target;
    while (head < tail) {
      const here = queue[head++]!;
      const c = here % this.cols;
      const r = (here - c) / this.cols;
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const n = nr * this.cols + nc;
        if (dist[n]! >= 0 || this.blocked[n]) continue;
        // No cutting a wall's corner diagonally.
        if (dc !== 0 && dr !== 0) {
          if (
            this.blocked[r * this.cols + nc] ||
            this.blocked[nr * this.cols + c]
          )
            continue;
        }
        dist[n] = dist[here]! + 1;
        queue[tail++] = n;
      }
    }
    if (this.fields.size >= MAX_FIELDS) this.fields.clear();
    this.fields.set(target, dist);
    return dist;
  }

  /** The neighbour of `cell` closest to the target, or -1. */
  private bestNeighbour(dist: Int32Array, cell: number): number {
    const c = cell % this.cols;
    const r = (cell - c) / this.cols;
    let best = -1;
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const n = nr * this.cols + nc;
      if (dist[n]! < 0) continue;
      if (best < 0 || dist[n]! < dist[best]!) best = n;
    }
    return best;
  }

  private cellOf(p: Vec2): number {
    const c = Math.floor((p.x - this.x0) / NAV_CELL);
    const r = Math.floor((p.y - this.y0) / NAV_CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private centre(cell: number): Vec2 {
    const c = cell % this.cols;
    const r = (cell - c) / this.cols;
    return {
      x: this.x0 + (c + 0.5) * NAV_CELL,
      y: this.y0 + (r + 0.5) * NAV_CELL,
    };
  }
}
