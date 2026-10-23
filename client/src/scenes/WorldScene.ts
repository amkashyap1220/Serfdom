import * as Phaser from "phaser";
import {
  consumeFixedSteps,
  dungeonInfo,
  MAX_FRAME_SECONDS,
  NO_INPUT,
  nextFireMode,
  PLAYER_WEAPON,
  resolveFireIntent,
  abilityIntent,
  TICK_SECONDS,
  worldDirectionFromInput,
  WARLORD,
  type AimTarget,
  type DungeonLayout,
  type FireMode,
  type Vec2,
} from "@serfdom/shared";
import {
  MIN_VISIBLE_WORLD_PX,
  screenToWorld,
  stepViewRotation,
} from "../camera-math";
import { EMPTY_VIEW, type CombatViewModel } from "../combat-view-model";
import {
  createKeyReader,
  createPointerReader,
  type KeyState,
  type PointerInput,
} from "../input";
import { NetSync } from "../net-sync";
import { PLAYER_SPRITE_SIZE } from "../render-config";
import { CombatView, makeSquareTexture } from "./CombatView";
import { MapView } from "./MapView";
import { RemotePlayersView, VANISHED_ALPHA } from "./RemotePlayersView";

const PLAYER_TEXTURE = "player-placeholder";
const PLAYER_HIT_TEXTURE = "player-placeholder-hit";
/** How long the player shows the hit flash. */
const PLAYER_HIT_FLASH_MS = 100;

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const COLORS = {
  visibilityTarget: 0x5cb85c,
  player: 0xf0c419,
  playerMark: 0x1d2129,
  playerHit: 0xff4d4d,
  viewportCenter: 0x5bc0de,
} as const;

const BOSS_BAR = { width: 400, height: 8, y: 24 } as const;

/** Drawn behind the menu screens, outside any run. */
const MENU_MAP = dungeonInfo("goblin-warrens").layout;

/** What the scene knows about the player this browser controls. */
export interface LocalView {
  position: Vec2;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
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
  /** Map underneath, then the world (enemies, players, shots) on top. */
  private mapLayer!: Phaser.GameObjects.Layer;
  private world!: Phaser.GameObjects.Layer;
  private map!: MapView;
  private combat!: CombatView;
  private remotes!: RemotePlayersView;
  readonly net = new NetSync();
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
  /** Whether Phaser reads (and captures) the game keys; null until first set. */
  private gameKeysActive: boolean | null = null;
  private readonly totals: Totals = { shots: 0, playerHits: 0 };
  private playerFlashUntil = 0;
  private lastLocalHp = 0;
  private lastView: CombatViewModel = EMPTY_VIEW;
  /** Boss health bar, fixed to the top of the screen (overlay camera). */
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;

  constructor() {
    super("world");
  }

  create(): void {
    this.mapLayer = this.add.layer();
    this.world = this.add.layer();
    this.map = new MapView(this, this.mapLayer);
    this.map.show(MENU_MAP);
    this.combat = new CombatView(this, this.world);
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
      MENU_MAP.spawn.x,
      MENU_MAP.spawn.y,
      PLAYER_TEXTURE,
    );
    this.world.add(this.player);
    const overlay = this.drawScreenOverlay();
    this.bossBar = this.add.graphics().setScrollFactor(0);
    this.bossLabel = this.add
      .text(this.scale.width / 2, BOSS_BAR.y - 14, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.readKeys = createKeyReader(this);
    // Menus come first, and they need every key for typing.
    this.setGameKeysActive(false);
    this.readPointer = createPointerReader(this);

    // D-033: no camera bounds; the camera always centers the player and
    // shows void past the map edge.
    this.cameras.main
      .setZoom(1)
      .ignore([overlay, this.bossBar, this.bossLabel]);
    this.cameras
      .add(0, 0, this.scale.width, this.scale.height, false, "overlay")
      .ignore([this.mapLayer, this.world]);
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

  /**
   * Game keys only while playing. Phaser "captures" the keys it binds
   * (W A S D Q E Z T R Space Enter): it calls preventDefault on them for the
   * whole page, which stops them from typing into the login form. So outside
   * a run capture is off and the keys are ignored by the game.
   */
  setGameKeysActive(active: boolean): void {
    const keyboard = this.input.keyboard;
    if (!keyboard || this.gameKeysActive === active) return;
    this.gameKeysActive = active;
    keyboard.enabled = active;
    if (active) {
      keyboard.enableGlobalCapture();
    } else {
      keyboard.disableGlobalCapture();
      // Forget keys held while leaving a run, so none stays stuck down.
      keyboard.resetKeys();
    }
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
      // Space held: where to cast, by the fire mode (D-094); the server
      // decides whether it casts (item, MP, cooldown) and clamps the range.
      // Space, or Full auto by itself (D-099); the server decides whether
      // it casts (item, MP, cooldown) and clamps the range.
      const ability = abilityIntent(
        this.fireMode,
        this.lastKeys.ability,
        this.net.myAbility,
        { world: this.lastPointerWorld, down: this.lastPointer.leftDown },
        this.net.position,
        targets,
        PLAYER_WEAPON.range,
      );
      const fired = this.net.tick({ move, fire, ability });
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
      this.net.selfState?.buffs.includes("vanish") ?? false,
    );
  }

  /** Our position (predicted) and HP (from the server); outside a run, the spawn and 0 HP. */
  private localView(): LocalView {
    if (!this.net.online) {
      return {
        position: this.currentLayout().spawn,
        hp: 0,
        maxHp: 0,
        mp: 0,
        maxMp: 0,
      };
    }
    const self = this.net.selfState;
    return {
      position: this.net.position,
      hp: self?.hp ?? 0,
      maxHp: self?.maxHp ?? 0,
      mp: self?.mp ?? 0,
      maxMp: self?.maxMp ?? 0,
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
      .setAlpha(
        this.net.selfState?.buffs.includes("vanish") ? VANISHED_ALPHA : 1,
      )
      .setTexture(
        nowMs < this.playerFlashUntil ? PLAYER_HIT_TEXTURE : PLAYER_TEXTURE,
      );
    this.cameras.main.centerOn(x, y).setRotation(this.viewRotation);

    this.map.show(this.currentLayout());
    this.map.syncDoors(this.net.closedDoors);
    this.lastView = this.net.viewModel(performance.now());
    this.map.syncPortal(this.lastView.portalOpen, nowMs);
    this.syncBossBar();
    this.combat.sync(this.lastView, this.viewRotation, nowMs);
    this.remotes.sync(
      this.net.remotePositions(performance.now()),
      this.viewRotation,
      this.net.vanishedPlayers(),
    );
  }

  private renderPosition(): Vec2 {
    const p = this.localView().position;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  /** Shows the Warlord's health across the top of the screen while it lives. */
  private syncBossBar(): void {
    const boss = this.lastView.enemies.find(
      (e) => e.kind === "warlord" && e.hp > 0,
    );
    const g = this.bossBar.clear();
    this.bossLabel.setVisible(boss !== undefined);
    if (!boss) return;
    const x = (this.scale.width - BOSS_BAR.width) / 2;
    const fraction = boss.hp / boss.maxHp;
    g.fillStyle(0x000000, 0.7);
    g.fillRect(x - 2, BOSS_BAR.y - 2, BOSS_BAR.width + 4, BOSS_BAR.height + 4);
    g.fillStyle(fraction < WARLORD.phaseTwoBelow ? 0xff3030 : 0xc0392b);
    g.fillRect(
      x,
      BOSS_BAR.y,
      Math.round(BOSS_BAR.width * fraction),
      BOSS_BAR.height,
    );
    // Notch where phase 2 begins.
    g.fillStyle(0xffffff, 0.8);
    g.fillRect(
      x + BOSS_BAR.width * WARLORD.phaseTwoBelow,
      BOSS_BAR.y,
      1,
      BOSS_BAR.height,
    );
    this.bossLabel.setText(
      `Goblin Warlord  ${Math.ceil(boss.hp)}/${boss.maxHp}${fraction < WARLORD.phaseTwoBelow ? "  — ENRAGED" : ""}`,
    );
  }

  /** The current run's dungeon, or the menu backdrop outside a run. */
  private currentLayout(): DungeonLayout {
    return this.net.layout ?? MENU_MAP;
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
