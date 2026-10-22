import * as Phaser from "phaser";
import {
  consumeFixedSteps,
  MAX_FRAME_SECONDS,
  NO_INPUT,
  PLAYER_BODY,
  PLAYER_SPEED,
  stepMovement,
  TICK_SECONDS,
  type MoveInput,
  type Vec2,
} from "@serfdom/shared";
import { MIN_VISIBLE_WORLD_PX } from "../camera-math";
import { createWasdReader } from "../input";
import {
  GRID,
  PLAYER_SPRITE_SIZE,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "../test-world";

const PLAYER_TEXTURE = "player-placeholder";

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
// The void beyond the map is the game background color set in main.ts.
const COLORS = {
  floor: 0x1d2129,
  gridMinor: 0x2c3340,
  gridMajor: 0x46505f,
  wall: 0x6b5b4b,
  wallEdge: 0x9c8670,
  visibilityTarget: 0x5cb85c,
  player: 0xf0c419,
  playerMark: 0x1d2129,
  viewportCenter: 0x5bc0de,
} as const;

export interface WorldDebugState {
  /** Simulated player center (world pixels, unrounded). */
  position: Vec2;
  /** Position actually drawn and centered on (whole world pixels). */
  renderPosition: Vec2;
  input: MoveInput;
}

/** Phase 2 debug scene: test map, WASD movement with walls, player-centered camera. */
export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private readInput: () => MoveInput = () => NO_INPUT;
  private position: Vec2 = { ...PLAYER_START };
  private lastInput: MoveInput = NO_INPUT;
  private carriedSeconds = 0;

  constructor() {
    super("world");
  }

  create(): void {
    this.drawFloorAndGrid();
    this.drawWalls();
    this.createPlayerTexture();
    this.player = this.add.image(
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_TEXTURE,
    );
    this.drawScreenOverlay();
    this.readInput = createWasdReader(this);

    // D-033: no camera bounds; the camera always centers the player and
    // shows void past the map edge.
    this.cameras.main.setZoom(1);
    this.syncView();
  }

  update(_time: number, deltaMs: number): void {
    const { steps, remainder } = consumeFixedSteps(
      this.carriedSeconds,
      deltaMs / 1000,
      TICK_SECONDS,
      MAX_FRAME_SECONDS,
    );
    this.carriedSeconds = remainder;

    // Input is sampled once per rendered frame and held for its steps.
    this.lastInput = this.readInput();
    for (let i = 0; i < steps; i++) {
      this.position = stepMovement(
        this.position,
        this.lastInput,
        PLAYER_BODY,
        TEST_WALLS,
        TICK_SECONDS,
        PLAYER_SPEED,
      );
    }
    this.syncView();
  }

  getDebugState(): WorldDebugState {
    return {
      position: { ...this.position },
      renderPosition: this.renderPosition(),
      input: this.lastInput,
    };
  }

  /**
   * Draws the player and centers the camera on the same whole-pixel point.
   * Rounding both identically keeps the sprite exactly centered and crisp;
   * rounding them separately can make the player wobble by a pixel.
   */
  private syncView(): void {
    const { x, y } = this.renderPosition();
    this.player.setPosition(x, y);
    this.cameras.main.centerOn(x, y);
  }

  private renderPosition(): Vec2 {
    return { x: Math.round(this.position.x), y: Math.round(this.position.y) };
  }

  private drawFloorAndGrid(): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.floor);
    g.fillRect(0, 0, TEST_WORLD.width, TEST_WORLD.height);

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

    // Absolute world coordinates, so positions in the HUD can be matched to the map.
    const style = {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#8a94a6",
    };
    for (let x = 0; x <= TEST_WORLD.width; x += GRID.label) {
      for (let y = 0; y <= TEST_WORLD.height; y += GRID.label) {
        this.add.text(x + 2, y + 2, `${x},${y}`, style);
      }
    }
  }

  private drawWalls(): void {
    const g = this.add.graphics();
    for (const wall of TEST_WALLS) {
      g.fillStyle(COLORS.wall);
      g.fillRect(wall.x, wall.y, wall.width, wall.height);
      g.lineStyle(1, COLORS.wallEdge);
      g.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.width - 1, wall.height - 1);
    }
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
   * Debug overlay fixed to the screen (scrollFactor 0 = ignores the camera):
   * the 600×600 visibility target (D-029; at zoom 1, screen pixels = world
   * pixels) and four ticks around the viewport center. If the camera keeps
   * the player centered, the player stays between the ticks and inside the box.
   */
  private drawScreenOverlay(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const g = this.add.graphics().setScrollFactor(0);

    g.lineStyle(2, COLORS.visibilityTarget);
    g.strokeRect(
      cx - MIN_VISIBLE_WORLD_PX,
      cy - MIN_VISIBLE_WORLD_PX,
      MIN_VISIBLE_WORLD_PX * 2,
      MIN_VISIBLE_WORLD_PX * 2,
    );

    const gap = 14;
    const len = 8;
    g.lineStyle(1, COLORS.viewportCenter);
    g.lineBetween(cx - gap - len, cy, cx - gap, cy);
    g.lineBetween(cx + gap, cy, cx + gap + len, cy);
    g.lineBetween(cx, cy - gap - len, cx, cy - gap);
    g.lineBetween(cx, cy + gap, cx, cy + gap + len);
  }
}
