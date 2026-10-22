import * as Phaser from "phaser";
import {
  isAlive,
  rotateVec,
  type SimEvent,
  type SimState,
} from "@serfdom/shared";

const ENEMY_TEXTURE = "enemy-placeholder";
const ENEMY_FLASH_TEXTURE = "enemy-placeholder-flash";
/** How long an enemy shows the white hit flash. */
const HIT_FLASH_MS = 80;

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const COLORS = {
  enemy: 0xc0392b,
  enemyMark: 0x2b0b07,
  flash: 0xffffff,
  playerShot: 0x7fdbff,
  enemyBullet: 0xff9f1c,
} as const;

interface EnemySprite {
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  flashUntil: number;
}

/**
 * Draws combat state (enemies, HP labels, projectiles) from the simulation.
 * Holds no game rules: everything it shows comes from SimState and events.
 */
export class CombatView {
  private readonly enemies = new Map<number, EnemySprite>();
  private readonly projectiles: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    size: number,
  ) {
    makeSquareTexture(
      scene,
      ENEMY_TEXTURE,
      size,
      COLORS.enemy,
      COLORS.enemyMark,
    );
    makeSquareTexture(
      scene,
      ENEMY_FLASH_TEXTURE,
      size,
      COLORS.flash,
      COLORS.flash,
    );
    this.projectiles = scene.add.graphics();
    layer.add(this.projectiles);
  }

  /**
   * Updates sprites for this frame. Enemies and labels are counter-rotated
   * like the player, so they stay upright on screen; labels sit "above" the
   * enemy on screen whatever the view rotation.
   */
  sync(
    state: SimState,
    events: readonly SimEvent[],
    viewRotation: number,
    nowMs: number,
  ): void {
    for (const e of events) {
      if (e.type === "hit") {
        const sprite = this.enemies.get(e.enemyId);
        if (sprite) sprite.flashUntil = nowMs + HIT_FLASH_MS;
      }
    }

    for (const enemy of state.enemies) {
      const sprite = this.enemySprite(enemy.id);
      const x = Math.round(enemy.position.x);
      const y = Math.round(enemy.position.y);
      const alive = isAlive(enemy);
      sprite.image
        .setVisible(alive)
        .setPosition(x, y)
        .setRotation(-viewRotation)
        .setTexture(
          nowMs < sprite.flashUntil ? ENEMY_FLASH_TEXTURE : ENEMY_TEXTURE,
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
            ? `${enemy.hp}/${enemy.maxHp}`
            : `respawn ${enemy.respawnIn.toFixed(1)}s`,
        );
    }

    const g = this.projectiles.clear();
    for (const p of state.projectiles) {
      g.fillStyle(p.owner === "enemy" ? COLORS.enemyBullet : COLORS.playerShot);
      g.fillRect(
        Math.round(p.position.x - p.size / 2),
        Math.round(p.position.y - p.size / 2),
        p.size,
        p.size,
      );
    }
  }

  private enemySprite(id: number): EnemySprite {
    let sprite = this.enemies.get(id);
    if (!sprite) {
      const image = this.scene.add.image(0, 0, ENEMY_TEXTURE);
      const label = this.scene.add
        .text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#ffffff",
        })
        .setOrigin(0.5, 1);
      this.layer.add([image, label]);
      sprite = { image, label, flashUntil: 0 };
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
