import {
  ARROWS,
  type BlastKind,
  type BuffKind,
  type DungeonLayout,
  type EnemyKind,
  type SnapshotProjectile,
  type TrapWarning,
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
  /** A slinger that leads its shots (D-109): drawn lighter. */
  leads: boolean;
  /** A brute dazed after charging into a wall (D-112): blinks pale blue. */
  dazed: boolean;
  /** Strengthened by a shaman's chant (D-115): a red glow. */
  chanted: boolean;
}

/** Burning floor (D-115). */
export interface FireView {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

export interface HazardView {
  x: number;
  y: number;
  radius: number;
  /** Seconds until it lands (estimated for now). */
  landsIn: number;
  kind: "boulder" | "bomb";
}

export interface ProjectileView {
  owner: "player" | "enemy";
  x: number;
  y: number;
  size: number;
  /** An ability's projectile (Volley arrow), drawn in its own colour. */
  ability?: boolean;
  /** A trap's arrow (D-113), drawn as a shaft along its flight. */
  trap?: { dx: number; dy: number };
}

/** One arrow slit (D-113): dark, or glowing (0 → 1) before a volley. */
export interface SlitView {
  x: number;
  y: number;
  /** Direction its arrow flies. */
  dx: number;
  dy: number;
  glow: number;
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
  slits: SlitView[];
  fires: FireView[];
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
  slits: [],
  fires: [],
  portalOpen: false,
};

/**
 * Every arrow slit of the run (D-113): those of a trap about to fire glow,
 * except the gap's, so players see where to stand.
 */
export function slitViews(
  layout: DungeonLayout | null,
  warnings: readonly TrapWarning[],
): SlitView[] {
  if (!layout) return [];
  const out: SlitView[] = [];
  for (const room of layout.rooms) {
    const trap = room.arrows;
    if (!trap) continue;
    const w = warnings.find((x) => x.room === room.id);
    trap.slits.forEach((at, k) => {
      const inGap = w !== undefined && k >= w.gap && k < w.gap + ARROWS.gap;
      out.push({
        x: at.x,
        y: at.y,
        dx: trap.direction.x,
        dy: trap.direction.y,
        glow: w && !inGap ? 0.3 + 0.7 * w.warn : 0,
      });
    });
  }
  return out;
}

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
      ...(p.trap ? { trap: { dx: p.dx, dy: p.dy } } : {}),
    }));
}
