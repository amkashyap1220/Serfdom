import type {
  BlastKind,
  BuffKind,
  EnemyKind,
  SnapshotProjectile,
} from "@serfdom/shared";

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
  /** Under a Warlock's Curse (D-098): drawn with a violet outline. */
  cursed: boolean;
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
  /** An ability's projectile (Volley arrow), drawn in its own colour. */
  ability?: boolean;
}

/** An ability blast shortly after it landed; `fade` runs 0 → 1. */
export interface BlastView {
  kind: BlastKind;
  x: number;
  y: number;
  radius: number;
  fade: number;
}

/** A Chain Lightning path shortly after it struck; `fade` runs 0 → 1. */
export interface ChainView {
  points: { x: number; y: number }[];
  fade: number;
}

/** A Nature's Reach patch on the ground. */
export interface ZoneView {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/** A buffed player's glow (D-098), drawn under them. */
export interface AuraView {
  x: number;
  y: number;
  buffs: BuffKind[];
}

export interface CombatViewModel {
  enemies: EnemyView[];
  projectiles: ProjectileView[];
  hazards: HazardView[];
  blasts: BlastView[];
  chains: ChainView[];
  zones: ZoneView[];
  auras: AuraView[];
  portalOpen: boolean;
}

export const EMPTY_VIEW: CombatViewModel = {
  enemies: [],
  projectiles: [],
  hazards: [],
  blasts: [],
  chains: [],
  zones: [],
  auras: [],
  portalOpen: false,
};

/**
 * The server's projectiles to draw, moved forward `ageSeconds` along their
 * path. Our own basic shots are skipped (we draw them from prediction);
 * our ability projectiles (Volley) exist only on the server, so they stay.
 */
export function serverProjectilesToDraw(
  projectiles: readonly SnapshotProjectile[],
  selfId: number | undefined,
  ageSeconds: number,
): ProjectileView[] {
  return projectiles
    .filter((p) => !(p.owner === "player" && p.by === selfId && !p.ability))
    .map((p) => ({
      owner: p.owner,
      x: p.x + p.dx * p.speed * ageSeconds,
      y: p.y + p.dy * p.speed * ageSeconds,
      size: p.size,
      ability: p.ability,
    }));
}
