import * as Phaser from "phaser";
import {
  consumeFixedSteps,
  DUMMY_ENEMY,
  dungeonInfo,
  MAX_FRAME_SECONDS,
  NO_INPUT,
  nextFireMode,
  PLAYER_WEAPON,
  resolveFireIntent,
  TICK_SECONDS,
  worldDirectionFromInput,
  type AimTarget,
  type FireMode,
  type Vec2,
} from "@serfdom/shared";
import {
  MIN_VISIBLE_WORLD_PX,
  screenToWorld,
  stepViewRotation,
} from "../camera-math";
import type { CombatViewModel } from "../combat-view-model";
import {
  createKeyReader,
  createPointerReader,
  type KeyState,
  type PointerInput,
} from "../input";
import { NetSync } from "../net-sync";
import { GRID, PLAYER_SPRITE_SIZE } from "../render-config";
import { CombatView, makeSquareTexture } from "./CombatView";
import { RemotePlayersView } from "./RemotePlayersView";

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

/**
 * The map being drawn and collided against. Phase 6a has one dungeon, so
 * one map; 6b gives each dungeon its own.
 */
const MAP = dungeonInfo("goblin-warrens").layout;

/** What the scene knows about the player this browser controls. */
export interface LocalView {
  position: Vec2;
  hp: number;
  maxHp: number;
}

export interface WorldDebugState {
  online: boolean;
  local: LocalView;
  net: NetSync;
  /** What is being drawn right now (from the offline sim or the server). */
  view: CombatViewModel;
  remotesVisible: number;
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
  playerHits: number;
}

const NO_KEYS: KeyState = {
  move: NO_INPUT,
  rotate: { left: false, right: false, reset: false },
  toggleFireMode: false,
  ability: false,
  exitDungeon: false,
};

/**
 * The dungeon scene: map, WASD movement with walls, player-centered camera
 * with Q/E rotation, and combat.
 *
 * The server runs everything consequential (D-043). While in a run this
 * scene sends intents through NetSync, predicts its own movement and shots,
 * and draws enemies, HP, and other projectiles from snapshots. Outside a run
 * (menu, queue, results: DOM screens drawn over it, screens.ts) it just
 * shows the empty map. Phase 6a removed the offline mode: with menus and
 * server-decided outcomes the game needs the server.
 *
 * Two cameras: the main camera draws the world layer and rotates; a second,
 * never-rotating "overlay" camera draws screen-fixed debug marks. A single
 * camera would rotate the screen overlay too.
 */
export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private world!: Phaser.GameObjects.Layer;
  private combat!: CombatView;
  private remotes!: RemotePlayersView;
  readonly net = new NetSync(MAP.walls);
  private readKeys: () => KeyState = () => NO_KEYS;
  private readPointer: () => PointerInput = () => ({
    screen: null,
    leftDown: false,
  });
  private lastKeys: KeyState = NO_KEYS;
  private lastPointer: PointerInput = { screen: null, leftDown: false };
  private lastPointerWorld: Vec2 | null = null;
  private viewRotation = 0;
  private fireMode: FireMode = "autoAim";
  private carriedSeconds = 0;
  private readonly totals: Totals = { shots: 0, playerHits: 0 };
  private playerFlashUntil = 0;
  private lastLocalHp = 0;
  private lastView: CombatViewModel = { enemies: [], projectiles: [] };

  constructor() {
    super("world");
  }

  create(): void {
    this.world = this.add.layer();
    this.drawFloorAndGrid();
    this.drawWalls();
    this.combat = new CombatView(this, this.world, DUMMY_ENEMY.size);
    this.remotes = new RemotePlayersView(this, this.world, PLAYER_SPRITE_SIZE);
    makeSquareTexture(
      this,
      PLAYER_TEXTURE,
      PLAYER_SPRITE_SIZE,
      COLORS.player,
      COLORS.playerMark,
    );
    makeSquareTexture(
      this,
      PLAYER_HIT_TEXTURE,
      PLAYER_SPRITE_SIZE,
      COLORS.playerHit,
      COLORS.playerMark,
    );
    this.player = this.add.image(MAP.spawn.x, MAP.spawn.y, PLAYER_TEXTURE);
    this.world.add(this.player);
    const overlay = this.drawScreenOverlay();
    this.readKeys = createKeyReader(this);
    this.readPointer = createPointerReader(this);

    // D-033: no camera bounds; the camera always centers the player and
    // shows void past the map edge.
    this.cameras.main.setZoom(1).ignore(overlay);
    this.cameras
      .add(0, 0, this.scale.width, this.scale.height, false, "overlay")
      .ignore(this.world);
    this.lastLocalHp = this.localView().hp;
    this.syncView(0);
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

    if (this.net.online) {
      for (let i = 0; i < steps; i++) this.onlineTick(move);
    }
    if (this.lastKeys.exitDungeon) this.net.exitDungeon();
    this.syncView(time);
  }

  getDebugState(): WorldDebugState {
    return {
      online: this.net.online,
      local: this.localView(),
      net: this.net,
      view: this.lastView,
      remotesVisible: this.remotes.count,
      renderPosition: this.renderPosition(),
      keys: this.lastKeys,
      pointer: this.lastPointer,
      pointerWorld: this.lastPointerWorld,
      viewRotation: this.viewRotation,
      fireMode: this.fireMode,
      totals: { ...this.totals },
    };
  }

  /**
   * One tick online: predict our own movement and shots and send the
   * intent; the server decides everything consequential (D-043).
   */
  private onlineTick(move: Vec2): void {
    const self = this.net.selfState;
    if (!self || self.hp > 0) {
      const targets: AimTarget[] = this.net.enemies
        .filter((e) => e.hp > 0)
        .map((e) => ({ id: e.id, position: { x: e.x, y: e.y } }));
      const fire = this.resolveFire(this.net.position, targets);
      const fired = this.net.tick({ move, fire });
      if (fired) this.totals.shots++;
    }
    this.net.stepLocalShots();
  }

  /** Re-resolved every tick: auto aim follows the closest living enemy. */
  private resolveFire(from: Vec2, targets: readonly AimTarget[]) {
    return resolveFireIntent(
      this.fireMode,
      { world: this.lastPointerWorld, down: this.lastPointer.leftDown },
      from,
      targets,
      PLAYER_WEAPON.range,
    );
  }

  /** Our position (predicted) and HP (from the server); outside a run, the spawn and 0 HP. */
  private localView(): LocalView {
    if (!this.net.online) return { position: MAP.spawn, hp: 0, maxHp: 0 };
    const self = this.net.selfState;
    return {
      position: this.net.position,
      hp: self?.hp ?? 0,
      maxHp: self?.maxHp ?? 0,
    };
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
  private syncView(nowMs: number): void {
    const local = this.localView();
    // Flash on any HP drop the server reports.
    if (local.hp > 0 && local.hp < this.lastLocalHp) {
      this.playerFlashUntil = nowMs + PLAYER_HIT_FLASH_MS;
      this.totals.playerHits++;
    }
    this.lastLocalHp = local.hp;

    const { x, y } = this.renderPosition();
    const alive = local.hp > 0;
    this.player
      .setPosition(x, y)
      .setRotation(-this.viewRotation)
      .setVisible(alive)
      .setTexture(
        nowMs < this.playerFlashUntil ? PLAYER_HIT_TEXTURE : PLAYER_TEXTURE,
      );
    this.cameras.main.centerOn(x, y).setRotation(this.viewRotation);

    this.lastView = this.net.viewModel(performance.now());
    this.combat.sync(this.lastView, this.viewRotation, nowMs);
    this.remotes.sync(
      this.net.remotePositions(performance.now()),
      this.viewRotation,
    );
  }

  private renderPosition(): Vec2 {
    const p = this.localView().position;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  private drawFloorAndGrid(): void {
    const g = this.add.graphics();
    this.world.add(g);
    g.fillStyle(COLORS.floor);
    g.fillRect(0, 0, MAP.world.width, MAP.world.height);

    for (let x = 0; x <= MAP.world.width; x += GRID.minor) {
      g.lineStyle(
        1,
        x % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(x, 0, x, MAP.world.height);
    }
    for (let y = 0; y <= MAP.world.height; y += GRID.minor) {
      g.lineStyle(
        1,
        y % GRID.major === 0 ? COLORS.gridMajor : COLORS.gridMinor,
      );
      g.lineBetween(0, y, MAP.world.width, y);
    }

    // Absolute world coordinates, so positions in the HUD can be matched to the map.
    const style = {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#8a94a6",
    };
    for (let x = 0; x <= MAP.world.width; x += GRID.label) {
      for (let y = 0; y <= MAP.world.height; y += GRID.label) {
        this.world.add(this.add.text(x + 2, y + 2, `${x},${y}`, style));
      }
    }
  }

  private drawWalls(): void {
    const g = this.add.graphics();
    this.world.add(g);
    for (const wall of MAP.walls) {
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
