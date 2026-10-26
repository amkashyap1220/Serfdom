import * as Phaser from "phaser";
import { CAMERA_ZOOM } from "../render-config";
import { rotateVec, type Vec2 } from "@serfdom/shared";
import { makeSquareTexture } from "./CombatView";

const REMOTE_TEXTURE = "remote-player-placeholder";

// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const COLORS = { body: 0x5b8def, mark: 0x0b1a33 } as const;

interface RemoteSprite {
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

/** Draws other players (blue squares with a "#id" label) at interpolated positions. */
/** A vanished player is drawn this see-through (D-100). */
export const VANISHED_ALPHA = 0.3;

export class RemotePlayersView {
  private readonly sprites = new Map<number, RemoteSprite>();
  /** The "#id" tags are debug marks (D-146). */
  private labelsShown = false;
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    size: number,
  ) {
    this.scene = scene;
    this.layer = layer;
    makeSquareTexture(scene, REMOTE_TEXTURE, size, COLORS.body, COLORS.mark);
  }

  setLabelsVisible(on: boolean): void {
    this.labelsShown = on;
    for (const s of this.sprites.values()) s.label.setVisible(on);
  }

  get count(): number {
    return this.sprites.size;
  }

  sync(
    positions: ReadonlyMap<number, Vec2>,
    viewRotation: number,
    faded: ReadonlySet<number> = new Set(),
  ): void {
    for (const [id, sprite] of this.sprites) {
      if (!positions.has(id)) {
        sprite.image.destroy();
        sprite.label.destroy();
        this.sprites.delete(id);
      }
    }
    for (const [id, p] of positions) {
      const sprite = this.sprites.get(id) ?? this.create(id);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      sprite.image
        .setPosition(x, y)
        .setRotation(-viewRotation)
        .setAlpha(faded.has(id) ? VANISHED_ALPHA : 1);
      // Upright and "above" on screen whatever the view rotation.
      const above = rotateVec({ x: 0, y: -11 }, -viewRotation);
      sprite.label
        .setPosition(Math.round(x + above.x), Math.round(y + above.y))
        .setRotation(-viewRotation);
    }
  }

  private create(id: number): RemoteSprite {
    const image = this.scene.add.image(0, 0, REMOTE_TEXTURE);
    const label = this.scene.add
      .text(0, 0, `#${id}`, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#a9c4ff",
      })
      .setOrigin(0.5, 1)
      // Reads at 10 CSS px whatever the camera zoom (D-127).
      .setScale(1 / CAMERA_ZOOM)
      .setVisible(this.labelsShown);
    this.layer.add([image, label]);
    const sprite = { image, label };
    this.sprites.set(id, sprite);
    return sprite;
  }
}
