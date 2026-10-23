import type { SimState } from "@serfdom/shared";

/**
 * What the combat renderer draws, independent of where it came from: the
 * local offline sim, or the server's snapshots plus local prediction.
 */
export interface EnemyView {
  id: number;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  respawnIn: number;
}

export interface ProjectileView {
  owner: "player" | "enemy";
  x: number;
  y: number;
  size: number;
}

export interface CombatViewModel {
  enemies: EnemyView[];
  projectiles: ProjectileView[];
}

export function viewFromSim(state: SimState): CombatViewModel {
  return {
    enemies: state.enemies.map((e) => ({
      id: e.id,
      x: e.position.x,
      y: e.position.y,
      size: e.size,
      hp: e.hp,
      maxHp: e.maxHp,
      respawnIn: e.respawnIn,
    })),
    projectiles: state.projectiles.map((p) => ({
      owner: p.owner,
      x: p.position.x,
      y: p.position.y,
      size: p.size,
    })),
  };
}
