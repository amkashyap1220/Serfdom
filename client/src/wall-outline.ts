import type { Rect } from "@serfdom/shared";

/** One straight piece of outline, in world pixels. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The outline of the union of `walls`: only the edges where wall meets
 * floor or void. Wall pieces overlap at corners and where rooms share a
 * wall; outlining each piece on its own drew lines through solid wall.
 * Each segment runs along the wall's own edge pixel (+0.5 for crisp 1 px
 * lines).
 */
export function wallOutline(walls: readonly Rect[]): Segment[] {
  const out: Segment[] = [];
  for (const r of walls) {
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    // Each edge: its span along the edge, and which other walls cover the
    // 1-pixel strip just outside it.
    const edges = [
      {
        horizontal: true,
        at: r.y + 0.5,
        from: r.x,
        to: right,
        outside: { x: r.x, y: r.y - 1, width: r.width, height: 1 },
      },
      {
        horizontal: true,
        at: bottom - 0.5,
        from: r.x,
        to: right,
        outside: { x: r.x, y: bottom, width: r.width, height: 1 },
      },
      {
        horizontal: false,
        at: r.x + 0.5,
        from: r.y,
        to: bottom,
        outside: { x: r.x - 1, y: r.y, width: 1, height: r.height },
      },
      {
        horizontal: false,
        at: right - 0.5,
        from: r.y,
        to: bottom,
        outside: { x: right, y: r.y, width: 1, height: r.height },
      },
    ];
    for (const edge of edges) {
      const covered = walls
        .filter((w) => w !== r && overlaps(w, edge.outside))
        .map((w): readonly [number, number] =>
          edge.horizontal ? [w.x, w.x + w.width] : [w.y, w.y + w.height],
        );
      for (const [a, b] of uncovered(edge.from, edge.to, covered)) {
        out.push(
          edge.horizontal
            ? { x1: a, y1: edge.at, x2: b, y2: edge.at }
            : { x1: edge.at, y1: a, x2: edge.at, y2: b },
        );
      }
    }
  }
  return out;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The parts of [from, to] not inside any of `covered`. */
function uncovered(
  from: number,
  to: number,
  covered: readonly (readonly [number, number])[],
): [number, number][] {
  const sorted = [...covered].sort((p, q) => p[0] - q[0]);
  const parts: [number, number][] = [];
  let at = from;
  for (const [a, b] of sorted) {
    if (b <= at) continue;
    if (a >= to) break;
    if (a > at) parts.push([at, a]);
    at = Math.max(at, b);
    if (at >= to) break;
  }
  if (at < to) parts.push([at, to]);
  return parts;
}
