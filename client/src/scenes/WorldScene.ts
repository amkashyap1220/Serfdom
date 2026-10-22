import * as Phaser from "phaser";
import { MIN_VISIBLE_WORLD_PX } from "../camera-math";
import {
  GRID,
  PLAYER_SPRITE_SIZE,
  PLAYER_START,
  TEST_WORLD,
} from "../test-world";

const PLAYER_TEXTURE = "player-placeholder";

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const COLORS = {
  gridMinor: 0x2c3340,
  gridMajor: 0x46505f,
  worldBounds: 0xd9534f,
  visibilityTarget: 0x5cb85c,
  player: 0xf0c419,
  playerMark: 0x1d2129,
  viewportCenter: 0x5bc0de,
} as const;

/** Phase 1 debug scene: grid, placeholder player, and a camera centered on it. */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super("world");
  }

  create(): void {
    this.drawGrid();
    this.drawVisibilityTarget();
    this.createPlayerTexture();
    this.add.image(PLAYER_START.x, PLAYER_START.y, PLAYER_TEXTURE);
    this.drawViewportCenterTicks();

    // No camera bounds yet: map-edge clamping is an open decision (Phase 2).
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(PLAYER_START.x, PLAYER_START.y);
  }

  private drawGrid(): void {
    const g = this.add.graphics();
    for (let x = 0; x <= TEST_WORLD.width; x += GRID.minor) {
      g.lineStyle(
        1,
        x % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(x, 0, x, TEST_WORLD.height);
    }
    for (let y = 0; y <= TEST_WORLD.height; y += GRID.minor) {
      g.lineStyle(
        1,
        y % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(0, y, TEST_WORLD.width, y);
    }
    g.lineStyle(2, COLORS.worldBounds);
    g.strokeRect(0, 0, TEST_WORLD.width, TEST_WORLD.height);

    // Label major lines along the axes through the player, as offsets from the
    // player, so the visible distance can be read straight off the screen.
    const style = {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#8a94a6",
    };
    for (let x = 0; x <= TEST_WORLD.width; x += GRID.major) {
      this.add.text(
        x + 2,
        PLAYER_START.y + 2,
        formatOffset(x - PLAYER_START.x),
        style,
      );
    }
    for (let y = 0; y <= TEST_WORLD.height; y += GRID.major) {
      if (y === PLAYER_START.y) continue; // Already labelled by the horizontal pass.
      this.add.text(
        PLAYER_START.x + 2,
        y + 2,
        formatOffset(y - PLAYER_START.y),
        style,
      );
    }
  }

  /** Outline of the 600×600 world-pixel area that must always be visible (D-029). */
  private drawVisibilityTarget(): void {
    const size = MIN_VISIBLE_WORLD_PX * 2;
    const g = this.add.graphics();
    g.lineStyle(2, COLORS.visibilityTarget);
    g.strokeRect(
      PLAYER_START.x - MIN_VISIBLE_WORLD_PX,
      PLAYER_START.y - MIN_VISIBLE_WORLD_PX,
      size,
      size,
    );
  }

  /** Builds the 16×16 source-pixel placeholder with a 2×2 mark at its exact center. */
  private createPlayerTexture(): void {
    const s = PLAYER_SPRITE_SIZE;
    const g = this.make.graphics({}, false);
    g.fillStyle(COLORS.player);
    g.fillRect(0, 0, s, s);
    g.fillStyle(COLORS.playerMark);
    g.fillRect(s / 2 - 1, s / 2 - 1, 2, 2);
    g.generateTexture(PLAYER_TEXTURE, s, s);
    g.destroy();
  }

  /**
   * Four short ticks fixed to the screen around the viewport's center
   * (scrollFactor 0 = they ignore camera movement). If the camera centers the
   * player within the gameplay viewport, the player sits exactly between them.
   */
  private drawViewportCenterTicks(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const gap = 14;
    const len = 8;
    const g = this.add.graphics().setScrollFactor(0);
    g.lineStyle(1, COLORS.viewportCenter);
    g.lineBetween(cx - gap - len, cy, cx - gap, cy);
    g.lineBetween(cx + gap, cy, cx + gap + len, cy);
    g.lineBetween(cx, cy - gap - len, cx, cy - gap);
    g.lineBetween(cx, cy + gap, cx, cy + gap + len);
  }
}

function formatOffset(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
