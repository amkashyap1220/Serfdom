import { PLAYER_WEAPON } from "./combat-config.ts";
import { rotateVec, type Vec2 } from "./geometry.ts";
import type { WeaponType } from "./items.ts";

/*
 * Each base weapon's attack pattern (D-141, approved by the user
 * 2026-10-24; numbers tunable). The wand is the only long-range single
 * shot; the others trade range for spread, piercing, or speed. With every
 * projectile on one target, each comes close to the wand's damage per
 * second. Damage still scales with the weapon's tier and Attack, and the
 * fire rate with Dexterity (D-078).
 */

/** One projectile of a pattern: turned `angleDegrees` from the aim, `offset` px to its side. */
export interface PatternShot {
  angleDegrees: number;
  offset: number;
}

export interface WeaponPattern {
  /** How far each projectile flies (and the auto-aim range). */
  range: number;
  speed: number;
  /** Square hit box, world px. */
  size: number;
  /** Shots per second, times the base (4 × the Dexterity factor). */
  rate: number;
  /** Each projectile's share of the weapon's damage. */
  damage: number;
  /** Flies on through every enemy it hits, each once (the staff's orb). */
  pierce?: boolean;
  shots: readonly PatternShot[];
}

const fan = (...angles: number[]): PatternShot[] =>
  angles.map((angleDegrees) => ({ angleDegrees, offset: 0 }));

export const WEAPON_PATTERNS: Record<WeaponType, WeaponPattern> = {
  // One fast bolt: the only long-range single shot.
  wand: { range: 340, speed: 400, size: 4, rate: 1, damage: 1, shots: fan(0) },
  // Three arrows in a 12° fan; it thins out with distance.
  bow: {
    range: 320,
    speed: 420,
    size: 4,
    rate: 0.75,
    damage: 0.5,
    shots: fan(-12, 0, 12),
  },
  // One big, slow orb through every enemy in its path.
  staff: {
    range: 260,
    speed: 220,
    size: 12,
    rate: 0.5,
    damage: 2.2,
    pierce: true,
    shots: fan(0),
  },
  // Two quick stabs side by side.
  dagger: {
    range: 160,
    speed: 450,
    size: 4,
    rate: 1.5,
    damage: 0.4,
    shots: [
      { angleDegrees: 0, offset: -6 },
      { angleDegrees: 0, offset: 6 },
    ],
  },
  // A slash: three short blades 20° apart.
  sword: {
    range: 140,
    speed: 450,
    size: 6,
    rate: 1,
    damage: 0.45,
    shots: fan(-20, 0, 20),
  },
  // A wide chop: five blades across 80°.
  axe: {
    range: 120,
    speed: 400,
    size: 6,
    rate: 0.7,
    damage: 0.4,
    shots: fan(-40, -20, 0, 20, 40),
  },
  // A smash: a ring of six shockwaves all round you.
  mace: {
    range: 110,
    speed: 300,
    size: 8,
    rate: 0.7,
    damage: 1.4,
    shots: fan(0, 60, 120, 180, 240, 300),
  },
};

/** No weapon (a classless serf's bare hands): the original single shot, unchanged. */
export const UNARMED: WeaponPattern = {
  range: PLAYER_WEAPON.range,
  speed: PLAYER_WEAPON.projectileSpeed,
  size: PLAYER_WEAPON.projectileSize,
  rate: 1,
  damage: 1,
  shots: fan(0),
};

export function patternOf(
  weapon: WeaponType | null | undefined,
): WeaponPattern {
  return weapon ? WEAPON_PATTERNS[weapon] : UNARMED;
}

/** Where each projectile of a pattern starts and flies, fired from `at` towards `aim` (a unit vector). */
export function patternVolley(
  pattern: WeaponPattern,
  at: Vec2,
  aim: Vec2,
): { position: Vec2; direction: Vec2 }[] {
  const side = { x: -aim.y, y: aim.x };
  return pattern.shots.map((s) => ({
    position: { x: at.x + side.x * s.offset, y: at.y + side.y * s.offset },
    direction: rotateVec(aim, (s.angleDegrees * Math.PI) / 180),
  }));
}
