import {
  type BlastKind,
  type BuffKind,
  type DungeonLayout,
  type EnemyKind,
  type SnapshotProjectile,
  type TrapWarning,
  firesThisVolley,
  RUNES,
  type RuneWarning,
  type TideState,
  type GustState,
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
  /** A skeleton's bone pile (D-120): drawn small and flat, labelled "bones". */
  pile: boolean;
  /** A ghost faded out (D-122): drawn see-through. */
  faded: boolean;
  /**
   * A grave knight's shield direction (D-122), or which way the Lich faces
   * (D-129), in radians; else null.
   */
  facing: number | null;
  /** The Lich spinning while it attacks (D-129). */
  spinning: boolean;
  /** A magma golem venting (D-132): a bright orange glow. */
  vented: boolean;
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
  kind: "boulder" | "bomb" | "rune" | "slag" | "icicle";
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
  /** A spirit brazier's fireball (D-123), drawn as fire. */
  fireball?: boolean;
}

/** One arrow slit (D-113): dark, or glowing (0 → 1) before a volley. */
export interface SlitView {
  x: number;
  y: number;
  /** Direction its arrow flies. */
  dx: number;
  dy: number;
  glow: number;
  /** A spirit brazier (D-123), not an arrow slit. */
  fire?: boolean;
  /** A fire jet's nozzle (D-133). */
  jet?: boolean;
}

/** The Forgemaster's shockwave (D-134). */
export interface WaveView {
  x: number;
  y: number;
  radius: number;
  gap: number;
  startsIn: number;
  /** Its arena: the ring is only drawn over this floor. */
  clip?: { x: number; y: number; width: number; height: number };
}

/** The Forgemaster's floor plates (D-134). */
export interface PlatesView {
  x: number;
  y: number;
  width: number;
  height: number;
  lane: number;
  warn: number;
  burning: boolean;
}

/** A tide pool (D-135) and how far the tide is in (`rise` 0 → 1 while it rises). */
export interface TideView {
  x: number;
  y: number;
  width: number;
  height: number;
  state: TideState;
  rise: number;
}

/** A whirlpool (D-135): `warn` 0 → 1 before it turns; `active` while it drags. */
export interface WhirlpoolView {
  x: number;
  y: number;
  radius: number;
  warn: number;
  active: boolean;
  /** A wing gust that blows players away (D-140), not a whirlpool. */
  push: boolean;
}

/** A tidal surge (D-135): its band now (empty while it waits), and its gaps. */
export interface SurgeView {
  band: { x: number; y: number; width: number; height: number } | null;
  axis: "x" | "y";
  /** The edge it starts from, while it waits (to mark the gaps). */
  edge: number;
  gaps: { from: number; to: number }[];
}

/** A wind channel (D-139): its gust state now, and the clock for its streaks. */
export interface WindView {
  x: number;
  y: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
  gust: GustState;
  phase: number;
}

/** A blade arm (D-137) as it is now. */
export interface BladeView {
  x: number;
  y: number;
  length: number;
  angle: number;
  laser: boolean;
}

/** Frost on the floor (D-136). */
export interface FrostView {
  x: number;
  y: number;
  radius: number;
}

/** A breath cone (D-136): filling in while it warns. */
export interface ConeView {
  x: number;
  y: number;
  angle: number;
  range: number;
  halfAngle: number;
  startsIn: number;
}

/** An eel-priest's tether (D-135): from the player to where they are pulled. */
export interface TetherView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The pull has started. */
  pulling: boolean;
}

/** A fire jet's beam (D-133): from (x1, y1) to (x2, y2), `width` wide. */
export interface BeamView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  remaining: number;
  /** Still warning (a Storm Caller's arc, D-139). */
  startsIn: number;
  arc: boolean;
}

/** One cursed rune (D-123): faint, or glowing (0 → 1) before it bursts. */
export interface RuneView {
  x: number;
  y: number;
  radius: number;
  glow: number;
}

/** A melee swing shortly after it was made (D-141); `fade` runs 0 → 1. */
export interface SwingView {
  x: number;
  y: number;
  angle: number;
  arcDegrees: number;
  reach: number;
  fade: number;
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
  /** Absent: Nature's Reach; else an Artifact's (D-153). */
  kind?: "decoy" | "field";
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
  swings: SwingView[];
  chains: ChainView[];
  zones: ZoneView[];
  auras: AuraView[];
  slits: SlitView[];
  runes: RuneView[];
  fires: FireView[];
  beams: BeamView[];
  waves: WaveView[];
  plates: PlatesView[];
  tides: TideView[];
  whirlpools: WhirlpoolView[];
  surges: SurgeView[];
  tethers: TetherView[];
  frost: FrostView[];
  cones: ConeView[];
  blades: BladeView[];
  winds: WindView[];
  portalOpen: boolean;
}

export const EMPTY_VIEW: CombatViewModel = {
  enemies: [],
  projectiles: [],
  hazards: [],
  blasts: [],
  swings: [],
  chains: [],
  zones: [],
  auras: [],
  slits: [],
  runes: [],
  fires: [],
  beams: [],
  waves: [],
  plates: [],
  tides: [],
  whirlpools: [],
  surges: [],
  tethers: [],
  frost: [],
  cones: [],
  blades: [],
  winds: [],
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
      // Only those about to fire glow (D-113, D-123).
      const fires = w !== undefined && firesThisVolley(trap, w.gap, k);
      out.push({
        x: at.x,
        y: at.y,
        dx: trap.direction.x,
        dy: trap.direction.y,
        glow: w && fires ? 0.3 + 0.7 * w.warn : 0,
        ...(trap.fire ? { fire: true } : {}),
        ...(trap.jet ? { jet: true } : {}),
      });
    });
  }
  return out;
}

/** Every cursed rune of the run (D-123); a column about to burst glows. */
export function runeViews(
  layout: DungeonLayout | null,
  warnings: readonly RuneWarning[],
): RuneView[] {
  if (!layout) return [];
  const out: RuneView[] = [];
  for (const room of layout.rooms) {
    const w = warnings.find((x) => x.room === room.id);
    for (const r of room.runes ?? []) {
      out.push({
        x: r.at.x,
        y: r.at.y,
        radius: RUNES.radius,
        glow: w && w.column === r.column ? w.warn : 0,
      });
    }
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
      ...(p.fireball ? { fireball: true } : {}),
    }));
}
