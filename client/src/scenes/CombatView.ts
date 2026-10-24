import * as Phaser from "phaser";
import { CAMERA_ZOOM, PLAYER_SPRITE_SIZE, px } from "../render-config";
import {
  ENEMY_KINDS,
  ENEMY_STATS,
  rotateVec,
  type EnemyKind,
  KNIGHT,
  LICH,
} from "@serfdom/shared";
import type { CombatViewModel } from "../combat-view-model";

const texture = (kind: EnemyKind) => `enemy-${kind}`;
const flashTexture = (kind: EnemyKind) => `enemy-${kind}-flash`;
const alertTexture = (kind: EnemyKind) => `enemy-${kind}-alert`;
const dazedTexture = (kind: EnemyKind) => `enemy-${kind}-dazed`;
/** How fast a dazed brute blinks (slower than a telegraph's warning). */
const DAZED_BLINK_MS = 220;
/** A slinger that leads its shots (D-109) is drawn lighter. */
const LEADING_TEXTURE = "enemy-slinger-leads";
/** How fast a telegraphing enemy blinks. */
const ALERT_BLINK_MS = 90;
/** A boulder is drawn falling for this long before it lands (both kinds). */
const BOULDER_FALL_SECONDS = 1.2;
/** How high above its shadow a boulder starts. */
const BOULDER_DROP_PX = 140;
/** How long an enemy shows the white hit flash. */
const HIT_FLASH_MS = 80;

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const ENEMY_COLORS: Record<EnemyKind, number> = {
  dummy: 0xc0392b,
  grunt: 0x4caf50,
  slinger: 0x9b59b6,
  brute: 0xd35400,
  warlord: 0x8b1a1a,
  skulker: 0x1f6f6a,
  bomber: 0x8a4b2a,
  shaman: 0xe6cf7a,
  warchief: 0x6e0f1a,
  skeleton: 0xe8e2cf,
  archer: 0xb3a98a,
  ghost: 0xa8d8ff,
  necromancer: 0x6a3d9a,
  knight: 0x5b6477,
  lich: 0x5b2a86,
  crystal: 0x7fe3ff,
};

/** A faded ghost's alpha (D-122): there, but plainly not hittable. */
const FADED_ALPHA = 0.25;

/** A skeleton's bone pile (D-120): a small dim square where it fell. */
const PILE_TEXTURE = "enemy-skeleton-pile";
const PILE_SIZE = 8;

const COLORS = {
  enemyMark: 0x1a1a1a,
  flash: 0xffffff,
  playerShot: 0x7fdbff,
  enemyBullet: 0xff9f1c,
  alert: 0xffe066,
  hazard: 0xff4d4d,
  // Placeholder colour, not the verified palette.
  blast: 0xb388ff,
  lightning: 0x9fe8ff,
  arrow: 0xffd34d,
  inspire: 0xffe08a,
  rage: 0xff5a3c,
  curse: 0x8a2be2,
  guard: 0x7fa8d1,
  heal: 0x5fe38a,
  zone: 0x6fcf4f,
  leadingSlinger: 0xd7b8ec,
  dazed: 0x9fc6e8,
  bonePile: 0x8f897a,
  shield: 0xdfe6f2,
  rune: 0xb04545,
  brazier: 0x3b4a5c,
  brazierGlow: 0x8fd3ff,
  raise: 0x9b59b6,
  slit: 0x1a1410,
  slitGlow: 0xff9f1c,
  trapArrow: 0xd9c9a3,
  trapArrowTip: 0xffffff,
  shadow: 0x000000,
  bomb: 0x2a2420,
  bombSpark: 0xffd34d,
  fire: 0xff7a1a,
  fireCore: 0xffd34d,
  chanted: 0xff4a3d,
  chant: 0xe6cf7a,
  boulder: 0x8c7f6e,
  boulderEdge: 0x4a4238,
} as const;

interface EnemySprite {
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  flashUntil: number;
  /** HP last frame, to detect hits from any source (local sim or server). */
  lastHp: number;
}

/**
 * Draws combat state (enemies, HP labels, projectiles) from a view model
 * built from server snapshots. Holds no game rules. Each enemy kind has its
 * own placeholder color and size; a hit flash plays whenever an enemy's HP
 * drops; enemies that leave the snapshot (defeated in a dungeon) are removed.
 */
export class CombatView {
  private readonly enemies = new Map<number, EnemySprite>();
  private readonly projectiles: Phaser.GameObjects.Graphics;
  private readonly hazards: Phaser.GameObjects.Graphics;
  private readonly blasts: Phaser.GameObjects.Graphics;
  /** Falling boulders, above players and enemies. */
  private readonly boulders: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
  ) {
    for (const kind of ENEMY_KINDS) {
      const { size } = ENEMY_STATS[kind];
      makeSquareTexture(
        scene,
        texture(kind),
        size,
        ENEMY_COLORS[kind],
        COLORS.enemyMark,
      );
      makeSquareTexture(
        scene,
        flashTexture(kind),
        size,
        COLORS.flash,
        COLORS.flash,
      );
      makeSquareTexture(
        scene,
        alertTexture(kind),
        size,
        COLORS.alert,
        COLORS.enemyMark,
      );
      makeSquareTexture(
        scene,
        dazedTexture(kind),
        size,
        COLORS.dazed,
        COLORS.enemyMark,
      );
    }
    makeSquareTexture(
      scene,
      PILE_TEXTURE,
      PILE_SIZE,
      COLORS.bonePile,
      COLORS.enemyMark,
    );
    makeSquareTexture(
      scene,
      LEADING_TEXTURE,
      ENEMY_STATS.slinger.size,
      COLORS.leadingSlinger,
      COLORS.enemyMark,
    );
    // Hazards are drawn under everything else on the world layer.
    this.hazards = scene.add.graphics();
    layer.add(this.hazards);
    this.blasts = scene.add.graphics();
    layer.add(this.blasts);
    this.projectiles = scene.add.graphics();
    layer.add(this.projectiles);
    this.boulders = scene.add.graphics();
    layer.add(this.boulders);
  }

  /**
   * Updates sprites for this frame. Enemies and labels are counter-rotated
   * like the player, so they stay upright on screen; labels sit "above" the
   * enemy on screen whatever the view rotation.
   */
  sync(view: CombatViewModel, viewRotation: number, nowMs: number): void {
    const present = new Set(view.enemies.map((e) => e.id));
    for (const [id, sprite] of this.enemies) {
      if (!present.has(id)) {
        sprite.image.destroy();
        sprite.label.destroy();
        this.enemies.delete(id);
      }
    }
    for (const enemy of view.enemies) {
      const sprite = this.enemySprite(enemy.id, enemy.kind, enemy.hp);
      if (enemy.hp < sprite.lastHp) sprite.flashUntil = nowMs + HIT_FLASH_MS;
      sprite.lastHp = enemy.hp;
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const alive = enemy.hp > 0;
      sprite.image
        .setAlpha(enemy.faded ? FADED_ALPHA : 1)
        .setVisible(alive)
        .setPosition(x, y)
        .setRotation(-viewRotation)
        .setTexture(
          enemy.pile
            ? PILE_TEXTURE
            : nowMs < sprite.flashUntil
              ? flashTexture(enemy.kind)
              : enemy.alert && Math.floor(nowMs / ALERT_BLINK_MS) % 2 === 0
                ? alertTexture(enemy.kind)
                : enemy.dazed && Math.floor(nowMs / DAZED_BLINK_MS) % 2 === 0
                  ? dazedTexture(enemy.kind)
                  : enemy.leads
                    ? LEADING_TEXTURE
                    : texture(enemy.kind),
        );

      const above = rotateVec(
        { x: 0, y: -(enemy.size / 2 + 3) },
        -viewRotation,
      );
      sprite.label
        .setPosition(Math.round(x + above.x), Math.round(y + above.y))
        .setRotation(-viewRotation)
        .setText(
          enemy.pile
            ? "bones"
            : alive
              ? `${Math.ceil(enemy.hp)}`
              : `respawn ${enemy.respawnIn.toFixed(1)}s`,
        );
    }

    const h = this.hazards.clear();
    // Falling boulders (the Warlord's and rockfall rooms', D-110): the
    // shadow grows on the floor and the hit area is outlined; the boulder
    // drops onto it, drawn above everyone.
    const rocks = this.boulders.clear();
    this.layer.bringToTop(this.boulders);
    for (const hz of view.hazards) {
      // The Lich's runes (D-125): a red circle filling in as it comes.
      if (hz.kind === "rune") {
        const fill = 1 - Math.min(1, hz.landsIn / LICH.runes.warnSeconds);
        h.lineStyle(px(2), COLORS.rune, 0.6 + 0.4 * fill);
        h.strokeCircle(hz.x, hz.y, hz.radius);
        h.fillStyle(COLORS.hazard, 0.15 + 0.35 * fill);
        h.fillCircle(hz.x, hz.y, hz.radius * fill);
        continue;
      }
      const fall = 1 - Math.min(1, hz.landsIn / BOULDER_FALL_SECONDS);
      h.fillStyle(COLORS.shadow, 0.2 + 0.4 * fall);
      h.fillEllipse(
        hz.x,
        hz.y,
        2 * hz.radius * (0.3 + 0.7 * fall),
        1.4 * hz.radius * (0.3 + 0.7 * fall),
      );
      h.lineStyle(px(2), COLORS.hazard, 0.5 + 0.4 * fall);
      h.strokeCircle(hz.x, hz.y, hz.radius);
      const lift = (1 - fall) * BOULDER_DROP_PX;
      if (hz.kind === "bomb") {
        // A lobbed bomb: small, dark, its fuse sparking (D-115).
        rocks.fillStyle(COLORS.bomb, 1);
        rocks.fillCircle(hz.x, hz.y - lift * 0.6, 7);
        rocks.fillStyle(COLORS.bombSpark, Math.floor(nowMs / 90) % 2 ? 1 : 0.4);
        rocks.fillCircle(hz.x + 4, hz.y - lift * 0.6 - 7, 2);
        continue;
      }
      const size = hz.radius * 0.6;
      rocks.fillStyle(COLORS.boulder, 1);
      rocks.fillCircle(hz.x, hz.y - lift, size);
      rocks.lineStyle(px(2), COLORS.boulderEdge, 1);
      rocks.strokeCircle(hz.x, hz.y - lift, size);
    }
    // Burning floor (D-115): flickering, fading as it goes out.
    for (const f of view.fires) {
      const flicker = 0.8 + 0.2 * Math.sin(nowMs / 60 + f.x);
      const life = Math.min(1, f.remaining / 1);
      h.fillStyle(COLORS.fire, (0.25 + 0.25 * life) * flicker);
      h.fillCircle(f.x, f.y, f.radius);
      h.fillStyle(COLORS.fireCore, (0.2 + 0.3 * life) * flicker);
      h.fillCircle(f.x, f.y, f.radius * 0.5);
    }

    const bl = this.blasts.clear();
    // Nature's Reach (D-097): a green patch, fading as it runs out.
    for (const z of view.zones) {
      const life = Math.min(1, z.remaining / 3);
      bl.fillStyle(COLORS.zone, 0.12 + 0.18 * life);
      bl.fillCircle(z.x, z.y, z.radius);
      bl.lineStyle(px(2), COLORS.zone, 0.4 + 0.5 * life);
      bl.strokeCircle(z.x, z.y, z.radius);
    }
    // Chain Lightning (D-097): a jagged line through every enemy hit.
    for (const c of view.chains) {
      bl.lineStyle(px(2), COLORS.lightning, 1 - c.fade);
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1]!;
        const b = c.points[i]!;
        const mx = (a.x + b.x) / 2 + (i % 2 === 0 ? 6 : -6);
        const my = (a.y + b.y) / 2 + (i % 2 === 0 ? -6 : 6);
        bl.lineBetween(a.x, a.y, mx, my);
        bl.lineBetween(mx, my, b.x, b.y);
      }
    }
    // Flashes (D-096, D-098, D-100): Arcane Blast purple, the curse dark
    // violet, a healed player's green flash; the Bard's gold ring and the
    // Cleric's green ring widen out.
    for (const b of view.blasts) {
      // The Warchief's sweep (D-117): a red circle filling in as the axe
      // goes up, exactly where it will hit; then a white flash.
      if (b.kind === "sweepWarning") {
        bl.fillStyle(COLORS.hazard, 0.15 + 0.25 * b.fade);
        bl.fillCircle(b.x, b.y, b.radius * b.fade);
        bl.lineStyle(px(2), COLORS.hazard, 0.9);
        bl.strokeCircle(b.x, b.y, b.radius);
        continue;
      }
      if (b.kind === "sweep") {
        bl.fillStyle(COLORS.flash, 0.6 * (1 - b.fade));
        bl.fillCircle(b.x, b.y, b.radius);
        continue;
      }
      // A grave knight's slam (D-122): drawn like the sweep.
      if (b.kind === "slamWarning") {
        bl.fillStyle(COLORS.hazard, 0.15 + 0.25 * b.fade);
        bl.fillCircle(b.x, b.y, b.radius * b.fade);
        bl.lineStyle(px(2), COLORS.hazard, 0.9);
        bl.strokeCircle(b.x, b.y, b.radius);
        continue;
      }
      if (b.kind === "slam") {
        bl.fillStyle(COLORS.flash, 0.6 * (1 - b.fade));
        bl.fillCircle(b.x, b.y, b.radius);
        continue;
      }
      // A shot stopped by a shield: a small white spark.
      if (b.kind === "shieldBlock") {
        bl.fillStyle(COLORS.flash, 1 - b.fade);
        bl.fillCircle(b.x, b.y, b.radius * (1 - 0.5 * b.fade));
        continue;
      }
      const color =
        b.kind === "chant"
          ? COLORS.chant
          : b.kind === "raise"
            ? COLORS.raise
            : b.kind === "rune"
              ? COLORS.hazard
              : b.kind === "inspiration"
                ? COLORS.inspire
                : b.kind === "curse"
                  ? COLORS.curse
                  : b.kind === "heal" || b.kind === "healed"
                    ? COLORS.heal
                    : COLORS.blast;
      const ring =
        b.kind === "inspiration" ||
        b.kind === "heal" ||
        b.kind === "chant" ||
        b.kind === "raise";
      if (!ring) {
        bl.fillStyle(color, 0.5 * (1 - b.fade));
        bl.fillCircle(b.x, b.y, b.radius);
      }
      bl.lineStyle(px(2), color, 1 - b.fade);
      bl.strokeCircle(
        b.x,
        b.y,
        ring ? b.radius * (0.3 + 0.7 * b.fade) : b.radius * (1 + 0.3 * b.fade),
      );
    }
    // Buff glows under players: red Battle Cry, gold Inspiration, blue
    // Guard. Vanish shows as a faded sprite instead (D-100).
    for (const a of view.auras) {
      a.buffs
        .filter((buff) => buff !== "vanish")
        .forEach((buff, i) => {
          const color =
            buff === "battleCry"
              ? COLORS.rage
              : buff === "guard"
                ? COLORS.guard
                : COLORS.inspire;
          bl.lineStyle(px(buff === "guard" ? 3 : 2), color, 0.9);
          // Just outside the player's sprite (D-127: 32 px), one ring per buff.
          bl.strokeCircle(a.x, a.y, PLAYER_SPRITE_SIZE / 2 + 4 + 6 * i);
        });
    }
    // The Lich warded (D-125): a violet line to each of its soul crystals.
    const lich = view.enemies.find((e) => e.kind === "lich" && e.hp > 0);
    if (lich?.faded) {
      bl.lineStyle(px(2), COLORS.raise, 0.5 + 0.3 * Math.sin(nowMs / 150));
      for (const c of view.enemies) {
        if (c.kind === "crystal" && c.hp > 0)
          bl.lineBetween(lich.x, lich.y, c.x, c.y);
      }
    }
    // Grave knights' shields (D-122): a bright arc on the front side.
    for (const e of view.enemies) {
      if (e.facing === null || e.hp <= 0) continue;
      const half = ((KNIGHT.shieldArcDegrees / 2) * Math.PI) / 180;
      bl.lineStyle(px(3), COLORS.shield, 1);
      bl.beginPath();
      bl.arc(e.x, e.y, e.size * 0.75, e.facing - half, e.facing + half);
      bl.strokePath();
    }
    // Chanted goblins (D-115): a red glow.
    for (const e of view.enemies) {
      if (!e.chanted || e.hp <= 0) continue;
      bl.lineStyle(px(2), COLORS.chanted, 0.6 + 0.4 * Math.sin(nowMs / 120));
      bl.strokeCircle(e.x, e.y, e.size * 0.9);
    }
    // Cursed enemies: a violet outline.
    for (const e of view.enemies) {
      if (!e.cursed || e.hp <= 0) continue;
      bl.lineStyle(px(2), COLORS.curse, 1);
      bl.strokeRect(
        e.x - e.size / 2 - 2,
        e.y - e.size / 2 - 2,
        e.size + 4,
        e.size + 4,
      );
    }

    const g = this.projectiles.clear();
    // Cursed runes (D-123): faint circles on the floor; the column about
    // to burst fills in red.
    for (const r of view.runes) {
      g.lineStyle(px(1), COLORS.rune, 0.35 + 0.65 * r.glow);
      g.strokeCircle(r.x, r.y, r.radius);
      if (r.glow > 0) {
        g.fillStyle(COLORS.hazard, 0.15 + 0.35 * r.glow);
        g.fillCircle(r.x, r.y, r.radius * r.glow);
      }
    }
    // Arrow slits (D-113): dark marks, glowing orange before a volley.
    // Spirit braziers (D-123): round, glowing blue-white before they fire.
    for (const s of view.slits) {
      if (s.fire) {
        g.fillStyle(
          s.glow > 0 ? COLORS.brazierGlow : COLORS.brazier,
          s.glow > 0 ? s.glow : 1,
        );
        g.fillCircle(s.x, s.y, 6);
        continue;
      }
      const across = { x: -s.dy, y: s.dx };
      g.fillStyle(
        s.glow > 0 ? COLORS.slitGlow : COLORS.slit,
        s.glow > 0 ? s.glow : 1,
      );
      g.fillRect(
        Math.round(s.x - 5 * Math.abs(across.x) - 2 * Math.abs(s.dx)),
        Math.round(s.y - 5 * Math.abs(across.y) - 2 * Math.abs(s.dy)),
        Math.round(10 * Math.abs(across.x) + 4 * Math.abs(s.dx)),
        Math.round(10 * Math.abs(across.y) + 4 * Math.abs(s.dy)),
      );
    }
    for (const p of view.projectiles) {
      if (p.fireball) {
        // A spirit brazier's fireball: a pale flame with a bright core.
        g.fillStyle(COLORS.brazierGlow, 0.85);
        g.fillCircle(p.x, p.y, p.size / 2 + 1);
        g.fillStyle(COLORS.flash, 1);
        g.fillCircle(p.x, p.y, p.size / 4);
        continue;
      }
      if (p.trap) {
        // A trap arrow: a shaft along its flight, its point leading.
        g.lineStyle(px(2), COLORS.trapArrow, 1);
        g.lineBetween(p.x - p.trap.dx * 12, p.y - p.trap.dy * 12, p.x, p.y);
        g.fillStyle(COLORS.trapArrowTip);
        g.fillRect(Math.round(p.x - 2), Math.round(p.y - 2), 4, 4);
        continue;
      }
      g.fillStyle(
        p.owner === "enemy"
          ? COLORS.enemyBullet
          : p.ability
            ? COLORS.arrow
            : COLORS.playerShot,
      );
      g.fillRect(
        Math.round(p.x - p.size / 2),
        Math.round(p.y - p.size / 2),
        p.size,
        p.size,
      );
    }
  }

  private enemySprite(id: number, kind: EnemyKind, hp: number): EnemySprite {
    let sprite = this.enemies.get(id);
    if (!sprite) {
      const image = this.scene.add.image(0, 0, texture(kind));
      const label = this.scene.add
        .text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#ffffff",
        })
        .setOrigin(0.5, 1)
        // Reads at 10 CSS px whatever the camera zoom (D-127).
        .setScale(1 / CAMERA_ZOOM);
      this.layer.add([image, label]);
      sprite = { image, label, flashUntil: 0, lastHp: hp };
      this.enemies.set(id, sprite);
    }
    return sprite;
  }
}

/** Square placeholder texture with a 2×2 center mark (same style as the player). */
export function makeSquareTexture(
  scene: Phaser.Scene,
  key: string,
  size: number,
  fill: number,
  mark: number,
): void {
  const g = scene.make.graphics({}, false);
  g.fillStyle(fill);
  g.fillRect(0, 0, size, size);
  g.fillStyle(mark);
  g.fillRect(size / 2 - 1, size / 2 - 1, 2, 2);
  g.generateTexture(key, size, size);
  g.destroy();
}
