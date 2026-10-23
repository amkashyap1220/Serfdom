import * as Phaser from "phaser";
import {
  PORTAL_RADIUS,
  WALL_THICKNESS,
  type DungeonLayout,
  type Rect,
} from "@serfdom/shared";
import { GRID } from "../render-config";
import { wallOutline } from "../wall-outline";

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
// The void beyond the rooms is the game background color set in main.ts.
const COLORS = {
  floor: 0x1d2129,
  gridMinor: 0x2c3340,
  gridMajor: 0x46505f,
  wall: 0x6b5b4b,
  wallEdge: 0x9c8670,
  door: 0x8e3b2b,
  doorEdge: 0xd9774a,
  portal: 0x9b7bff,
  portalCore: 0xe8dcff,
  hole: 0x0d0b09,
  obstacle: 0x8a8378,
  obstacleEdge: 0xb8b0a2,
  label: "#8a94a6",
} as const;

/**
 * Draws a dungeon layout (Phase 6b): each room's floor with the debug grid
 * clipped to it, its name and world coordinates in the corner, the walls,
 * and the doors that are still closed. Rebuilt only when the dungeon
 * changes; doors redraw when the set of closed doors changes.
 */
/** A 36 px gap in the wall beside a hole point (D-109). */
function holeRect(b: Rect, hole: { x: number; y: number }): Rect {
  const t = WALL_THICKNESS;
  const half = 18;
  const left = hole.x - b.x;
  const right = b.x + b.width - hole.x;
  const top = hole.y - b.y;
  const bottom = b.y + b.height - hole.y;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left)
    return { x: b.x - t, y: hole.y - half, width: t, height: 2 * half };
  if (nearest === right)
    return { x: b.x + b.width, y: hole.y - half, width: t, height: 2 * half };
  if (nearest === top)
    return { x: hole.x - half, y: b.y - t, width: 2 * half, height: t };
  return { x: hole.x - half, y: b.y + b.height, width: 2 * half, height: t };
}

const overlapsRect = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

export class MapView {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private readonly doors: Phaser.GameObjects.Graphics;
  private readonly portal: Phaser.GameObjects.Graphics;
  private layout: DungeonLayout | null = null;
  private doorKey = "";

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
    this.doors = scene.add.graphics();
    this.portal = scene.add.graphics();
  }

  show(layout: DungeonLayout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.doorKey = "";

    const g = this.scene.add.graphics();
    this.objects.push(g);
    this.layer.add(g);
    for (const room of layout.rooms) this.drawRoom(g, room.bounds, room.name);
    // Door gaps are floor once open (closed doors are drawn over them).
    g.fillStyle(COLORS.floor);
    for (const door of layout.doors) {
      g.fillRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);
    }
    g.fillStyle(COLORS.wall);
    for (const wall of layout.walls) {
      g.fillRect(wall.x, wall.y, wall.width, wall.height);
    }
    // Only the outline of all walls together: pieces overlap at corners
    // and shared walls, and outlining each one drew seams through them.
    g.lineStyle(1, COLORS.wallEdge);
    for (const s of wallOutline(layout.walls)) {
      g.lineBetween(s.x1, s.y1, s.x2, s.y2);
    }
    // Obstacles (D-112): solid like walls, drawn as lighter stone.
    for (const room of layout.rooms) {
      for (const o of room.obstacles ?? []) {
        g.fillStyle(COLORS.obstacle);
        g.fillRect(o.x, o.y, o.width, o.height);
        g.lineStyle(1, COLORS.obstacleEdge);
        g.strokeRect(o.x + 0.5, o.y + 0.5, o.width - 1, o.height - 1);
      }
    }
    // Ambush holes (D-109): dark gaps in the wall nearest each hole.
    g.fillStyle(COLORS.hole);
    for (const room of layout.rooms) {
      for (const hole of room.holes ?? []) {
        const r = holeRect(room.bounds, hole);
        // A hole beside a doorway is not drawn: it would look like a
        // blocked passage. Its goblins still come out there.
        if (layout.doors.some((d) => overlapsRect(d.rect, r))) continue;
        g.fillRect(r.x, r.y, r.width, r.height);
      }
    }
    // Doors and the portal sit above the floor and walls. Each new layout
    // adds its floor on top of the layer, so lift them back above it.
    this.layer.add([this.doors, this.portal]);
    this.layer.bringToTop(this.doors);
    this.layer.bringToTop(this.portal);
  }

  /** Draws the exit portal (D-057) while it is open, gently pulsing. */
  syncPortal(open: boolean, nowMs: number): void {
    const g = this.portal.clear();
    const at = this.layout?.exitPortal;
    if (!open || !at) return;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 180);
    g.fillStyle(COLORS.portal, 0.35 + 0.25 * pulse);
    g.fillCircle(at.x, at.y, PORTAL_RADIUS + 6 * pulse);
    g.lineStyle(2, COLORS.portalCore, 0.9);
    g.strokeCircle(at.x, at.y, PORTAL_RADIUS);
    g.fillStyle(COLORS.portalCore, 0.8);
    g.fillCircle(at.x, at.y, 6 + 3 * pulse);
  }

  /** Draws the doors in `closed` (ids); open doors are just gaps. */
  syncDoors(closed: readonly string[]): void {
    const key = closed.join(",");
    if (key === this.doorKey || !this.layout) return;
    this.doorKey = key;
    const g = this.doors.clear();
    for (const door of this.layout.doors) {
      if (!closed.includes(door.id)) continue;
      const r = door.rect;
      g.fillStyle(COLORS.door);
      g.fillRect(r.x, r.y, r.width, r.height);
      g.lineStyle(1, COLORS.doorEdge);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);
    }
  }

  private drawRoom(
    g: Phaser.GameObjects.Graphics,
    b: Rect,
    name: string,
  ): void {
    g.fillStyle(COLORS.floor);
    g.fillRect(b.x, b.y, b.width, b.height);
    // Grid lines on absolute world coordinates, so positions in the HUD can
    // be matched to the map.
    const firstX = Math.ceil(b.x / GRID.minor) * GRID.minor;
    for (let x = firstX; x <= b.x + b.width; x += GRID.minor) {
      g.lineStyle(
        1,
        x % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(x, b.y, x, b.y + b.height);
    }
    const firstY = Math.ceil(b.y / GRID.minor) * GRID.minor;
    for (let y = firstY; y <= b.y + b.height; y += GRID.minor) {
      g.lineStyle(
        1,
        y % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(b.x, y, b.x + b.width, y);
    }
    const label = this.scene.add.text(
      b.x + 4,
      b.y + 4,
      `${name}  (${b.x},${b.y})`,
      { fontFamily: "monospace", fontSize: "10px", color: COLORS.label },
    );
    this.objects.push(label);
    this.layer.add(label);
  }
}
