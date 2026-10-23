import {
  stepProjectile,
  type HitTarget,
  type Projectile,
  type Rect,
} from "@serfdom/shared";

/**
 * The local player's own shots, drawn the moment they are fired (D-043).
 * They fly with the same shared rule as on the server and vanish on walls,
 * enemies, or at max range, but they are purely visual: damage only ever
 * comes from the server. The server's copies of our shots are not drawn,
 * so each shot appears once.
 */
export class LocalShots {
  private shots: Projectile[] = [];

  get list(): readonly Projectile[] {
    return this.shots;
  }

  add(shot: Projectile): void {
    this.shots.push(shot);
  }

  clear(): void {
    this.shots = [];
  }

  step(
    dtSeconds: number,
    walls: readonly Rect[],
    enemies: readonly HitTarget[],
  ): void {
    const next: Projectile[] = [];
    for (const s of this.shots) {
      const outcome = stepProjectile(s, dtSeconds, walls, enemies);
      if (outcome.kind === "flying") next.push(outcome.projectile);
    }
    this.shots = next;
  }
}
