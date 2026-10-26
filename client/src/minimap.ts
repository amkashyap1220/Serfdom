import { rotateVec, type DungeonLayout, type Vec2 } from "@serfdom/shared";

/** The HUD minimap (D-147): 216 CSS px square, about 3,600 world px across. */
export const MINIMAP = { size: 216, scale: 0.06 } as const;

export interface MinimapInput {
  layout: DungeonLayout;
  /** Rooms this run has woken, and which of those are cleared (from the server). */
  seen: ReadonlySet<string>;
  cleared: ReadonlySet<string>;
  closedDoors: readonly string[];
  portalOpen: boolean;
  /** Where you are (the map's centre), or null before the first snapshot. */
  me: Vec2 | null;
  others: readonly Vec2[];
  /** The Q/E view rotation (radians), so "up" matches the screen. */
  rotation: number;
}

export interface MinimapShapes {
  rooms: { corners: Vec2[]; cleared: boolean }[];
  /** Closed doors of rooms already seen, as corner lists. */
  doors: Vec2[][];
  portal: Vec2 | null;
  me: Vec2 | null;
  others: Vec2[];
}

/** World point → minimap pixel: centred on `center`, turned like the camera. */
export function toMinimap(p: Vec2, center: Vec2, rotation: number): Vec2 {
  const r = rotateVec({ x: p.x - center.x, y: p.y - center.y }, rotation);
  return {
    x: MINIMAP.size / 2 + r.x * MINIMAP.scale,
    y: MINIMAP.size / 2 + r.y * MINIMAP.scale,
  };
}

/**
 * What the minimap draws (D-147), in minimap pixels. Rooms the run has not
 * woken stay hidden (fog), and so do their doors; the portal shows once it
 * is open. Pure, so it is tested without a canvas.
 */
export function minimapShapes(input: MinimapInput): MinimapShapes {
  const center = input.me ?? input.layout.spawn;
  const at = (p: Vec2) => toMinimap(p, center, input.rotation);
  const corners = (r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => [
    at({ x: r.x, y: r.y }),
    at({ x: r.x + r.width, y: r.y }),
    at({ x: r.x + r.width, y: r.y + r.height }),
    at({ x: r.x, y: r.y + r.height }),
  ];
  const closed = new Set(input.closedDoors);
  return {
    rooms: input.layout.rooms
      .filter((r) => input.seen.has(r.id))
      .map((r) => ({
        corners: corners(r.bounds),
        cleared: input.cleared.has(r.id),
      })),
    doors: input.layout.doors
      .filter((d) => closed.has(d.id) && input.seen.has(d.room))
      .map((d) => corners(d.rect)),
    portal:
      input.portalOpen && input.layout.exitPortal
        ? at(input.layout.exitPortal)
        : null,
    me: input.me ? at(input.me) : null,
    others: input.others.map(at),
  };
}

// Placeholder colours only; not the verified palette (see ASSET_MANIFEST.md).
const COLORS = {
  room: "#3a4352",
  cleared: "#262c36",
  edge: "#5a6474",
  door: "#d9534f",
  portal: "#9b7bff",
  me: "#f0c419",
  other: "#5b8def",
};

/** Draws the minimap on the HUD's canvas each frame. */
export class MinimapView {
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  /** Clears it (outside a run) or draws these shapes. */
  draw(shapes: MinimapShapes | null): void {
    const c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!shapes) return;
    const poly = (pts: Vec2[]) => {
      c.beginPath();
      pts.forEach((p, i) =>
        i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y),
      );
      c.closePath();
    };
    c.lineWidth = 1;
    for (const r of shapes.rooms) {
      poly(r.corners);
      c.fillStyle = r.cleared ? COLORS.cleared : COLORS.room;
      c.fill();
      c.strokeStyle = COLORS.edge;
      c.stroke();
    }
    c.fillStyle = COLORS.door;
    for (const d of shapes.doors) {
      poly(d);
      c.fill();
    }
    if (shapes.portal) dot(c, shapes.portal, 4, COLORS.portal);
    for (const o of shapes.others) dot(c, o, 2.5, COLORS.other);
    if (shapes.me) dot(c, shapes.me, 3, COLORS.me);
  }
}

function dot(
  c: CanvasRenderingContext2D,
  p: Vec2,
  radius: number,
  color: string,
): void {
  c.beginPath();
  c.arc(p.x, p.y, radius, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}
