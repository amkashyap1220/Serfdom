import * as Phaser from "phaser";
import {
  ENEMY_KINDS,
  ENEMY_STATS,
  rotateVec,
  type EnemyKind,
} from "@serfdom/shared";
import type { CombatViewModel } from "../combat-view-model";

const texture = (kind: EnemyKind) => `enemy-${kind}`;
const flashTexture = (kind: EnemyKind) => `enemy-${kind}-flash`;
const alertTexture = (kind: EnemyKind) => `enemy-${kind}-alert`;
/** How fast a telegraphing enemy blinks. */
const ALERT_BLINK_MS = 90;
/** How long an enemy shows the white hit flash. */
const HIT_FLASH_MS = 80;

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const ENEMY_COLORS: Record<EnemyKind, number> = {
  dummy: 0xc0392b,
  grunt: 0x4caf50,
  slinger: 0x9b59b6,
  brute: 0xd35400,
  warlord: 0x8b1a1a,
};

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
  zone: 0x6fcf4f,
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
    }
    // Hazards are drawn under everything else on the world layer.
    this.hazards = scene.add.graphics();
    layer.add(this.hazards);
    this.blasts = scene.add.graphics();
    layer.add(this.blasts);
    this.projectiles = scene.add.graphics();
    layer.add(this.projectiles);
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
        .setVisible(alive)
        .setPosition(x, y)
        .setRotation(-viewRotation)
        .setTexture(
          nowMs < sprite.flashUntil
            ? flashTexture(enemy.kind)
            : enemy.alert && Math.floor(nowMs / ALERT_BLINK_MS) % 2 === 0
              ? alertTexture(enemy.kind)
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
          alive
            ? `${Math.ceil(enemy.hp)}`
            : `respawn ${enemy.respawnIn.toFixed(1)}s`,
        );
    }

    // Rockfall warnings: an outline, filling in as the landing nears.
    const h = this.hazards.clear();
    for (const hz of view.hazards) {
      const urgency = 1 - Math.min(1, hz.landsIn / 1.2);
      h.fillStyle(COLORS.hazard, 0.15 + 0.45 * urgency);
      h.fillCircle(hz.x, hz.y, hz.radius * (0.4 + 0.6 * urgency));
      h.lineStyle(2, COLORS.hazard, 0.9);
      h.strokeCircle(hz.x, hz.y, hz.radius);
    }

    const bl = this.blasts.clear();
    // Nature's Reach (D-097): a green patch, fading as it runs out.
    for (const z of view.zones) {
      const life = Math.min(1, z.remaining / 3);
      bl.fillStyle(COLORS.zone, 0.12 + 0.18 * life);
      bl.fillCircle(z.x, z.y, z.radius);
      bl.lineStyle(2, COLORS.zone, 0.4 + 0.5 * life);
      bl.strokeCircle(z.x, z.y, z.radius);
    }
    // Chain Lightning (D-097): a jagged line through every enemy hit.
    for (const c of view.chains) {
      bl.lineStyle(2, COLORS.lightning, 1 - c.fade);
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1]!;
        const b = c.points[i]!;
        const mx = (a.x + b.x) / 2 + (i % 2 === 0 ? 6 : -6);
        const my = (a.y + b.y) / 2 + (i % 2 === 0 ? -6 : 6);
        bl.lineBetween(a.x, a.y, mx, my);
        bl.lineBetween(mx, my, b.x, b.y);
      }
    }
    // Flashes (D-096, D-098): Arcane Blast purple, the Bard's ring gold
    // (it widens out), the Warlock's curse dark violet.
    for (const b of view.blasts) {
      const color =
        b.kind === "inspiration"
          ? COLORS.inspire
          : b.kind === "curse"
            ? COLORS.curse
            : COLORS.blast;
      if (b.kind !== "inspiration") {
        bl.fillStyle(color, 0.5 * (1 - b.fade));
        bl.fillCircle(b.x, b.y, b.radius);
      }
      bl.lineStyle(2, color, 1 - b.fade);
      bl.strokeCircle(
        b.x,
        b.y,
        b.kind === "inspiration"
          ? b.radius * (0.3 + 0.7 * b.fade)
          : b.radius * (1 + 0.3 * b.fade),
      );
    }
    // Buff glows under players: red Battle Cry, gold Inspiration.
    for (const a of view.auras) {
      a.buffs.forEach((buff, i) => {
        bl.lineStyle(
          2,
          buff === "battleCry" ? COLORS.rage : COLORS.inspire,
          0.9,
        );
        bl.strokeCircle(a.x, a.y, 12 + 4 * i);
      });
    }
    // Cursed enemies: a violet outline.
    for (const e of view.enemies) {
      if (!e.cursed || e.hp <= 0) continue;
      bl.lineStyle(2, COLORS.curse, 1);
      bl.strokeRect(
        e.x - e.size / 2 - 2,
        e.y - e.size / 2 - 2,
        e.size + 4,
        e.size + 4,
      );
    }

    const g = this.projectiles.clear();
    for (const p of view.projectiles) {
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
        .setOrigin(0.5, 1);
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
