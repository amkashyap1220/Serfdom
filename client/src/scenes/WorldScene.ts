import * as Phaser from "phaser";
import {
  addPlayer,
  aimTargets,
  consumeFixedSteps,
  createSimState,
  DUMMY_ENEMY,
  DUMMY_POSITIONS,
  findPlayer,
  MAX_FRAME_SECONDS,
  NO_INPUT,
  nextFireMode,
  PLAYER_START,
  PLAYER_WEAPON,
  resolveFireIntent,
  stepSim,
  TEST_WALLS,
  TEST_WORLD,
  TICK_SECONDS,
  worldDirectionFromInput,
  type AimTarget,
  type FireMode,
  type PlayerState,
  type SimEvent,
  type SimState,
  type Vec2,
} from "@serfdom/shared";
import {
  MIN_VISIBLE_WORLD_PX,
  screenToWorld,
  stepViewRotation,
} from "../camera-math";
import { viewFromSim, type CombatViewModel } from "../combat-view-model";
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
  /** Running totals since load, for the HUD (hits/blocked: offline only). */
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

/** Id of this browser's player in its local offline sim. */
const LOCAL_PLAYER_ID = 1;

const NO_KEYS: KeyState = {
  move: NO_INPUT,
  rotate: { left: false, right: false, reset: false },
  toggleFireMode: false,
  ability: false,
  playAgain: false,
};

/**
 * Debug scene: test map, WASD movement with walls, player-centered camera
 * with Q/E rotation, and the combat prototype against a dummy.
 *
 * Two modes, one renderer:
 * - **Online** (Phase 5b): the server runs combat (D-043). This scene sends
 *   intents through NetSync, predicts its own movement and shots, and draws
 *   enemies, HP, and other projectiles from snapshots.
 * - **Offline**: the same shared rules run locally for one player.
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
  private readonly net = new NetSync(TEST_WALLS);
  private readKeys: () => KeyState = () => NO_KEYS;
  private readPointer: () => PointerInput = () => ({
    screen: null,
    leftDown: false,
  });
  /** Offline-only simulation. */
  private sim: SimState = addPlayer(
    createSimState(DUMMY_POSITIONS),
    LOCAL_PLAYER_ID,
    PLAYER_START,
  );
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
  private lastLocalHp = 0;
  private lastView: CombatViewModel = { enemies: [], projectiles: [] };
  private deathText!: Phaser.GameObjects.Text;

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
    this.player = this.add.image(
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_TEXTURE,
    );
    this.world.add(this.player);
    const overlay = this.drawScreenOverlay();
    this.deathText = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
        align: "center",
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

    const online = this.net.online;
    const events: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      if (online) {
        this.onlineTick(move);
      } else {
        events.push(...this.offlineTick(move));
      }
    }
    this.countEvents(events);

    // D-046 prototype: a dead player is at the placeholder "main menu";
    // Enter plays again with a fresh state at the start.
    if (this.lastKeys.playAgain && this.localView().hp <= 0) {
      if (online) this.net.playAgain();
      else this.sim = addPlayer(this.sim, LOCAL_PLAYER_ID, PLAYER_START);
    }
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

  /** One tick offline: the shared rules run locally for our one player. */
  private offlineTick(move: Vec2): SimEvent[] {
    const fire = this.resolveFire(
      this.localPlayer().position,
      aimTargets(this.sim),
    );
    const result = stepSim(
      this.sim,
      new Map([[LOCAL_PLAYER_ID, { move, fire }]]),
      TEST_WALLS,
      TICK_SECONDS,
    );
    this.sim = result.state;
    return result.events;
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

  /** The offline sim's player (always present there). */
  private localPlayer(): PlayerState {
    const p = findPlayer(this.sim, LOCAL_PLAYER_ID);
    if (!p) throw new Error("local player missing from sim");
    return p;
  }

  /** Our position (predicted online) and HP (from the server online). */
  private localView(): LocalView {
    if (this.net.online) {
      const self = this.net.selfState;
      return {
        position: this.net.position,
        hp: self?.hp ?? 0,
        maxHp: self?.maxHp ?? 0,
      };
    }
    const p = this.localPlayer();
    return { position: p.position, hp: p.hp, maxHp: p.maxHp };
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
  private syncView(nowMs: number): void {
    const local = this.localView();
    // Flash on any HP drop, whether the local sim or the server caused it.
    if (local.hp < this.lastLocalHp) {
      this.playerFlashUntil = nowMs + PLAYER_HIT_FLASH_MS;
      if (this.net.online) this.totals.playerHits++;
      if (this.net.online && local.hp <= 0) this.totals.deaths++;
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
    // PROTOTYPE ONLY (D-046): placeholder for the real menu/stash and
    // permadeath rules of later phases.
    this.deathText
      .setVisible(!alive)
      .setText("You died\nMain menu (placeholder)\nPress Enter to play again");
    this.cameras.main.centerOn(x, y).setRotation(this.viewRotation);

    this.lastView = this.net.online
      ? this.net.viewModel(performance.now())
      : viewFromSim(this.sim);
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
