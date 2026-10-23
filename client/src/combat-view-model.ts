/**
 * What the combat renderer draws: the server's snapshots plus local
 * prediction (NetSync.viewModel), kept separate from the network types.
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
