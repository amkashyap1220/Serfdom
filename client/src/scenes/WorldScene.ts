import * as Phaser from "phaser";
import {
  aimTargets,
  isPlayerAlive,
  consumeFixedSteps,
  createSimState,
  DUMMY_ENEMY,
  MAX_FRAME_SECONDS,
  NO_INPUT,
  nextFireMode,
  PLAYER_WEAPON,
  resolveFireIntent,
  stepSim,
  TICK_SECONDS,
  worldDirectionFromInput,
  type FireMode,
  type SimEvent,
  type SimState,
  type Vec2,
} from "@serfdom/shared";
import {
  MIN_VISIBLE_WORLD_PX,
  screenToWorld,
  stepViewRotation,
} from "../camera-math";
import {
  createKeyReader,
  createPointerReader,
  type KeyState,
  type PointerInput,
} from "../input";
import {
  DUMMY_POSITIONS,
  GRID,
  PLAYER_SPRITE_SIZE,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "../test-world";
import { CombatView, makeSquareTexture } from "./CombatView";

const PLAYER_TEXTURE = "player-placeholder";
const PLAYER_HIT_TEXTURE = "player-placeholder-hit";
/** How long the player shows the hit flash. */
const PLAYER_HIT_FLASH_MS = 100;

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
  playerHit: 0xff4d4d,
  viewportCenter: 0x5bc0de,
} as const;

export interface WorldDebugState {
  sim: SimState;
  /** Position actually drawn and centered on (whole world pixels). */
  renderPosition: Vec2;
  keys: KeyState;
  pointer: PointerInput;
  /** Mouse position in world pixels, or null if unknown. */
  pointerWorld: Vec2 | null;
  /** Camera rotation in radians, [0, 2π). */
  viewRotation: number;
  fireMode: FireMode;
  /** Running totals since load, for the HUD. */
  totals: Totals;
}

interface Totals {
  shots: number;
  hits: number;
  blocked: number;
  defeats: number;
  playerHits: number;
  deaths: number;
}

const NO_KEYS: KeyState = {
  move: NO_INPUT,
  rotate: { left: false, right: false, reset: false },
  toggleFireMode: false,
  ability: false,
};

/**
 * Debug scene: test map, WASD movement with walls, player-centered camera
 * with Q/E rotation, and the Phase 3b shooting prototype against a dummy.
 *
 * All rules run in the shared simulation (stepSim); this scene only gathers
 * input, advances fixed ticks, and draws the result.
 *
 * Two cameras: the main camera draws the world layer and rotates; a second,
 * never-rotating "overlay" camera draws screen-fixed debug marks. A single
 * camera would rotate the screen overlay too.
 */
export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private world!: Phaser.GameObjects.Layer;
  private combat!: CombatView;
  private readKeys: () => KeyState = () => NO_KEYS;
  private readPointer: () => PointerInput = () => ({
    screen: null,
    leftDown: false,
  });
  private sim: SimState = createSimState(PLAYER_START, DUMMY_POSITIONS);
  private lastKeys: KeyState = NO_KEYS;
  private lastPointer: PointerInput = { screen: null, leftDown: false };
  private lastPointerWorld: Vec2 | null = null;
  private viewRotation = 0;
  private fireMode: FireMode = "autoAim";
  private carriedSeconds = 0;
  private readonly totals: Totals = {
    shots: 0,
    hits: 0,
    blocked: 0,
    defeats: 0,
    playerHits: 0,
    deaths: 0,
  };
  private playerFlashUntil = 0;
  private deathText!: Phaser.GameObjects.Text;

  constructor() {
    super("world");
  }

  create(): void {
    this.world = this.add.layer();
    this.drawFloorAndGrid();
    this.drawWalls();
    this.combat = new CombatView(this, this.world, DUMMY_ENEMY.size);
    makeSquareTexture(
      this,
      PLAYER_TEXTURE,
      PLAYER_SPRITE_SIZE,
      COLORS.player,
      COLORS.playerMark,
    );
    this.player = this.add.image(
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_TEXTURE,
    );
    makeSquareTexture(
      this,
      PLAYER_HIT_TEXTURE,
      PLAYER_SPRITE_SIZE,
      COLORS.playerHit,
      COLORS.playerMark,
    );
    this.world.add(this.player);
    const overlay = this.drawScreenOverlay();
    this.deathText = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.readKeys = createKeyReader(this);
    this.readPointer = createPointerReader(this);

    // D-033: no camera bounds; the camera always centers the player and
    // shows void past the map edge.
    this.cameras.main.setZoom(1).ignore([overlay, this.deathText]);
    this.cameras
      .add(0, 0, this.scale.width, this.scale.height, false, "overlay")
      .ignore(this.world);
    this.syncView([], 0);
  }

  update(time: number, deltaMs: number): void {
    const { steps, remainder } = consumeFixedSteps(
      this.carriedSeconds,
      deltaMs / 1000,
      TICK_SECONDS,
      MAX_FRAME_SECONDS,
    );
    this.carriedSeconds = remainder;

    // Input is sampled once per rendered frame and held for its steps.
    this.lastKeys = this.readKeys();
    this.lastPointer = this.readPointer();
    if (this.lastKeys.toggleFireMode) {
      this.fireMode = nextFireMode(this.fireMode);
    }
    // The mouse is converted with the view as it is on screen right now
    // (before this frame's movement), which is what the player is aiming at.
    this.lastPointerWorld = this.lastPointer.screen
      ? screenToWorld(
          this.lastPointer.screen,
          this.scale,
          this.renderPosition(),
          this.viewRotation,
          this.cameras.main.zoom,
        )
      : null;

    // View rotation is presentation only (never sent to a server), so it
    // follows real frame time rather than simulation ticks.
    this.viewRotation = stepViewRotation(
      this.viewRotation,
      this.lastKeys.rotate,
      deltaMs / 1000,
    );
    const move = worldDirectionFromInput(this.lastKeys.move, this.viewRotation);

    const events: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      // Re-resolved every tick: auto aim follows the closest living enemy.
      const fire = resolveFireIntent(
        this.fireMode,
        { world: this.lastPointerWorld, down: this.lastPointer.leftDown },
        this.sim.player.position,
        aimTargets(this.sim),
        PLAYER_WEAPON.range,
      );
      const result = stepSim(
        this.sim,
        { move, fire },
        TEST_WALLS,
        TICK_SECONDS,
      );
      this.sim = result.state;
      events.push(...result.events);
    }
    this.countEvents(events);
    this.syncView(events, time);
  }

  getDebugState(): WorldDebugState {
    return {
      sim: this.sim,
      renderPosition: this.renderPosition(),
      keys: this.lastKeys,
      pointer: this.lastPointer,
      pointerWorld: this.lastPointerWorld,
      viewRotation: this.viewRotation,
      fireMode: this.fireMode,
      totals: { ...this.totals },
    };
  }

  private countEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "shot") this.totals.shots++;
      else if (e.type === "hit") this.totals.hits++;
      else if (e.type === "blocked") this.totals.blocked++;
      else if (e.type === "defeated") this.totals.defeats++;
      else if (e.type === "playerHit") this.totals.playerHits++;
      else if (e.type === "playerDied") this.totals.deaths++;
    }
  }

  /**
   * Draws the player and centers the camera on the same whole-pixel point.
   * Rounding both identically keeps the sprite exactly centered and crisp;
   * rounding them separately can make the player wobble by a pixel.
   *
   * The camera rotates around the viewport center (= the player). The player
   * sprite is counter-rotated so it stays upright and pixel-aligned on screen
   * (PROVISIONAL: characters upright, world rotates).
   */
  private syncView(events: readonly SimEvent[], nowMs: number): void {
    const { x, y } = this.renderPosition();
    if (events.some((e) => e.type === "playerHit")) {
      this.playerFlashUntil = nowMs + PLAYER_HIT_FLASH_MS;
    }
    const alive = isPlayerAlive(this.sim.player);
    this.player
      .setPosition(x, y)
      .setRotation(-this.viewRotation)
      .setVisible(alive)
      .setTexture(
        nowMs < this.playerFlashUntil ? PLAYER_HIT_TEXTURE : PLAYER_TEXTURE,
      );
    // PROTOTYPE ONLY: not the final permadeath rules.
    this.deathText
      .setVisible(!alive)
      .setText(
        `You died — prototype respawn in ${this.sim.player.respawnIn.toFixed(1)}s`,
      );
    this.cameras.main.centerOn(x, y).setRotation(this.viewRotation);
    this.combat.sync(this.sim, events, this.viewRotation, nowMs);
  }

  private renderPosition(): Vec2 {
    const p = this.sim.player.position;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  private drawFloorAndGrid(): void {
    const g = this.add.graphics();
    this.world.add(g);
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
        this.world.add(this.add.text(x + 2, y + 2, `${x},${y}`, style));
      }
    }
  }

  private drawWalls(): void {
    const g = this.add.graphics();
    this.world.add(g);
    for (const wall of TEST_WALLS) {
      g.fillStyle(COLORS.wall);
      g.fillRect(wall.x, wall.y, wall.width, wall.height);
      g.lineStyle(1, COLORS.wallEdge);
      g.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.width - 1, wall.height - 1);
    }
  }

  /**
   * Debug overlay fixed to the screen (drawn by the non-rotating overlay camera):
   * the 600×600 visibility target (D-029; at zoom 1, screen pixels = world
   * pixels) and four ticks around the viewport center. If the camera keeps
   * the player centered, the player stays between the ticks and inside the box.
   */
  private drawScreenOverlay(): Phaser.GameObjects.Graphics {
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
    return g;
  }
}
