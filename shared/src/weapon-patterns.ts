import { PLAYER_WEAPON } from "./combat-config.ts";
import type { Vec2 } from "./geometry.ts";
import type { WeaponType } from "./items.ts";

/*
 * Each base weapon's attack (D-141, redesigned and approved by the user
 * 2026-10-24; numbers tunable). Not more projectiles, but different kinds
 * of attack: the wand fires the only long-range single bolt; the bow's
 * arrow pierces; the staff's orb bursts; the sword, axe, dagger, and mace
 * swing, cutting everything in an arc in front of you at once. At its own
 * range each comes close to the wand's damage on one target. Damage still
 * scales with the weapon's tier and Attack, the rate with Dexterity (D-078).
 */

/** A projectile weapon: one shot per pull. */
export interface ShotAttack {
  kind: "shot";
  /** How far it flies (and the auto-aim range). */
  range: number;
  speed: number;
  /** Square hit box, world px. */
  size: number;
  /** Shots per second, times the base (4 × the Dexterity factor). */
  rate: number;
  /** Its share of the weapon's damage. */
  damage: number;
  /** Flies on through every enemy in its line, each hit once (the bow's arrow). */
  pierce?: boolean;
  /** Bursts where it stops, hitting every enemy this close (the staff's orb). */
  burst?: number;
}

/** A melee weapon: an instant swing, hitting every enemy in the arc once. */
export interface SwingAttack {
  kind: "swing";
  /** How far in front it cuts, from your centre (also the auto-aim range). */
  reach: number;
  /** The arc's full width, centred on your aim (360: all round you). */
  arcDegrees: number;
  rate: number;
  damage: number;
}

export type WeaponAttack = ShotAttack | SwingAttack;

export const WEAPON_ATTACKS: Record<WeaponType, WeaponAttack> = {
  // One fast bolt: the only long-range single shot.
  wand: { kind: "shot", range: 340, speed: 400, size: 4, rate: 1, damage: 1 },
  // One arrow through every enemy in its line.
  bow: {
    kind: "shot",
    range: 320,
    speed: 450,
    size: 6,
    rate: 0.6,
    damage: 1.8,
    pierce: true,
  },
  // A slow orb that bursts on impact, hitting everything round it.
  staff: {
    kind: "shot",
    range: 260,
    speed: 240,
    size: 10,
    rate: 0.5,
    damage: 2,
    burst: 40,
  },
  // A slash: everything in a 100° arc in front of you.
  sword: { kind: "swing", reach: 70, arcDegrees: 100, rate: 1, damage: 1.2 },
  // A heavy cleave: slower, wider, further.
  axe: { kind: "swing", reach: 85, arcDegrees: 180, rate: 0.6, damage: 2 },
  // Rapid stabs: a narrow thrust straight ahead.
  dagger: { kind: "swing", reach: 90, arcDegrees: 30, rate: 1.6, damage: 0.8 },
  // A ground smash: everything all round you.
  mace: { kind: "swing", reach: 70, arcDegrees: 360, rate: 0.45, damage: 2.6 },
};

/** No weapon (a classless serf's bare hands): the original single shot, unchanged. */
export const UNARMED: ShotAttack = {
  kind: "shot",
  range: PLAYER_WEAPON.range,
  speed: PLAYER_WEAPON.projectileSpeed,
  size: PLAYER_WEAPON.projectileSize,
  rate: 1,
  damage: 1,
};

export function attackOf(weapon: WeaponType | null | undefined): WeaponAttack {
  return weapon ? WEAPON_ATTACKS[weapon] : UNARMED;
}

/**
 * How far auto-aim looks for a target (centre to centre): a shot's range;
 * for a swing, its reach plus half an enemy's body (SWING_AIM_BODY), since a
 * swing cuts any enemy whose body is within reach, not only its centre.
 */
export function attackRange(attack: WeaponAttack): number {
  return attack.kind === "shot" ? attack.range : attack.reach + SWING_AIM_BODY;
}

/** Half the body of an enemy up to 48 px: auto-aim swings at anything this much past the reach. */
export const SWING_AIM_BODY = 24;

/**
 * Does a swing from \`at\` aimed along \`aim\` (a unit vector) catch an enemy
 * of \`size\` at \`enemy\`? Its body must come within the reach, and its
 * centre must lie inside the arc (an enemy pressed against you counts
 * whatever the angle).
 */
export function swingCatches(
  swing: Pick<SwingAttack, "reach" | "arcDegrees">,
  at: Vec2,
  aim: Vec2,
  enemy: Vec2,
  size: number,
): boolean {
  const dx = enemy.x - at.x;
  const dy = enemy.y - at.y;
  const d = Math.hypot(dx, dy);
  if (d > swing.reach + size / 2) return false;
  if (swing.arcDegrees >= 360 || d <= size / 2) return true;
  const cos = (dx * aim.x + dy * aim.y) / d;
  return cos >= Math.cos(((swing.arcDegrees / 2) * Math.PI) / 180) - 1e-9;
}
