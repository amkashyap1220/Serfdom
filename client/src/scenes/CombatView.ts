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
/** How long an enemy shows the white hit flash. */
const HIT_FLASH_MS = 80;

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const ENEMY_COLORS: Record<EnemyKind, number> = {
  dummy: 0xc0392b,
  grunt: 0x4caf50,
  slinger: 0x9b59b6,
};

const COLORS = {
  enemyMark: 0x1a1a1a,
  flash: 0xffffff,
  playerShot: 0x7fdbff,
  enemyBullet: 0xff9f1c,
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
    }
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

    const g = this.projectiles.clear();
    for (const p of view.projectiles) {
      g.fillStyle(p.owner === "enemy" ? COLORS.enemyBullet : COLORS.playerShot);
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
