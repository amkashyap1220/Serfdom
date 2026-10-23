import * as Phaser from "phaser";
import type { DungeonLayout, Rect } from "@serfdom/shared";
import { GRID } from "../render-config";

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
  label: "#8a94a6",
} as const;

/**
 * Draws a dungeon layout (Phase 6b): each room's floor with the debug grid
 * clipped to it, its name and world coordinates in the corner, the walls,
 * and the doors that are still closed. Rebuilt only when the dungeon
 * changes; doors redraw when the set of closed doors changes.
 */
export class MapView {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private readonly doors: Phaser.GameObjects.Graphics;
  private layout: DungeonLayout | null = null;
  private doorKey = "";

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
    this.doors = scene.add.graphics();
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
    for (const wall of layout.walls) {
      g.fillStyle(COLORS.wall);
      g.fillRect(wall.x, wall.y, wall.width, wall.height);
      g.lineStyle(1, COLORS.wallEdge);
      g.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.width - 1, wall.height - 1);
    }
    // Doors sit above the floor and walls.
    this.layer.add(this.doors);
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
