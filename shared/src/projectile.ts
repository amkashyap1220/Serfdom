import { segmentHitTime } from "./collision.ts";
import type { Rect, Vec2 } from "./geometry.ts";

export interface Projectile {
  id: number;
  /** Player shots hit enemies; enemy bullets hit players. */
  owner: "player" | "enemy";
  /** Id of the player or enemy that fired it. */
  ownerId: number;
  position: Vec2;
  /** Unit direction of travel. */
  direction: Vec2;
  speed: number;
  /** Distance it may still travel before expiring. */
  remaining: number;
  damage: number;
  /** Square hit box size. */
  size: number;
  /** Fired by an ability (Volley), not a basic shot: clients draw it from the server. */
  fromAbility?: boolean;
  /** A room's arrow (D-113): its hits are hazard hits. */
  hazard?: "arrows" | "braziers";
  /** Flies on through enemies (the bow's arrow, D-141), each hit once: those it has hit. */
  pierce?: boolean;
  pierced?: readonly number[];
  /** Bursts where it stops, hitting every enemy this close (the staff's orb, D-141). */
  burst?: number;
}

/** Something a projectile can hit: an id and its hit box. */
export interface HitTarget {
  id: number;
  box: Rect;
}

export type ProjectileOutcome =
  | { kind: "flying"; projectile: Projectile }
  | { kind: "hit"; targetId: number; position: Vec2 }
  | { kind: "blocked"; position: Vec2 }
  | { kind: "expired"; position: Vec2 };

/**
 * Moves a projectile for one step. Whatever its path touches first (a wall
 * or a target) ends it; otherwise it expires once it has travelled its range.
 * Walls and targets are checked along the whole path, so speed never lets
 * it pass through anything. On an exact tie a wall wins (shots never hit
 * through the face of a wall).
 */
export function stepProjectile(
  p: Projectile,
  dtSeconds: number,
  walls: readonly Rect[],
  targets: readonly HitTarget[],
): ProjectileOutcome {
  const travel = Math.min(p.speed * dtSeconds, p.remaining);
  const to = {
    x: p.position.x + p.direction.x * travel,
    y: p.position.y + p.direction.y * travel,
  };
  const half = p.size / 2;
  const at = (t: number): Vec2 => ({
    x: p.position.x + (to.x - p.position.x) * t,
    y: p.position.y + (to.y - p.position.y) * t,
  });

  let wallT = Infinity;
  for (const wall of walls) {
    const t = segmentHitTime(p.position, to, half, wall);
    if (t !== null && t < wallT) wallT = t;
  }

  let targetT = Infinity;
  let targetId = -1;
  for (const target of targets) {
    const t = segmentHitTime(p.position, to, half, target.box);
    // Ties between targets go to the lowest id, so results are deterministic.
    if (
      t !== null &&
      (t < targetT || (t === targetT && target.id < targetId))
    ) {
      targetT = t;
      targetId = target.id;
    }
  }

  if (wallT <= targetT && wallT !== Infinity) {
    return { kind: "blocked", position: at(wallT) };
  }
  if (targetT !== Infinity) {
    return { kind: "hit", targetId, position: at(targetT) };
  }
  const remaining = p.remaining - travel;
  if (remaining <= 1e-9) return { kind: "expired", position: to };
  return { kind: "flying", projectile: { ...p, position: to, remaining } };
}
