import type { EnemyKind } from "@serfdom/shared";

/**
 * What the combat renderer draws: the server's snapshots plus local
 * prediction (NetSync.viewModel), kept separate from the network types.
 */
export interface EnemyView {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  respawnIn: number;
  /** Telegraphing an attack (brute windup). */
  alert: boolean;
}

export interface HazardView {
  x: number;
  y: number;
  radius: number;
  /** Seconds until it lands (estimated for now). */
  landsIn: number;
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
  hazards: HazardView[];
  portalOpen: boolean;
}

export const EMPTY_VIEW: CombatViewModel = {
  enemies: [],
  projectiles: [],
  hazards: [],
  portalOpen: false,
};
