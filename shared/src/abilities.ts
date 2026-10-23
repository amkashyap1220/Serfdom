import type { Vec2 } from "./geometry.ts";
import type { AbilityItemType } from "./items.ts";
import {
  aimDirection,
  closestTargetInRange,
  type AimTarget,
  type FireMode,
  type PointerState,
} from "./weapon.ts";

/**
 * Class abilities (Phase 10). Confirmed: the ability comes from the worn
 * ability item (D-092), costs MP and has a short cooldown (D-093), aims by
 * the fire mode (D-094), and gets stronger with the item's tier (D-095).
 * Numbers are D-096 and D-097 (approved, tunable). Built so far: Wizard
 * Arcane Blast (10a); Ranger Volley, Sorcerer Chain Lightning, Druid
 * Nature's Reach (10b); the rest arrive in 10c–10d.
 */
export const ARCANE_BLAST = {
  mpCost: 15,
  cooldownSeconds: 1.5,
  /** Furthest a blast lands from the caster (world px). */
  range: 250,
  /** Every enemy whose center is this close to the landing point is hit. */
  radius: 40,
} as const;

/** Damage per enemy before Attack scaling: 80 + 20 × tier (D-096). */
export function arcaneBlastDamage(tier: number): number {
  return 80 + 20 * tier;
}

/** Ranger (D-097): a fan of arrows, aimed like shots. */
export const VOLLEY = {
  mpCost: 12,
  cooldownSeconds: 1.2,
  arrows: 5,
  /** Total spread of the fan, degrees. */
  spreadDegrees: 30,
  speed: 500,
  /** How far each arrow flies; also the Auto aim reach. */
  range: 350,
  size: 4,
} as const;

/** Damage per arrow before Attack scaling: 30 + 8 × tier (D-097). */
export function volleyArrowDamage(tier: number): number {
  return 30 + 8 * tier;
}

/** Sorcerer (D-097): lightning that jumps between enemies. */
export const CHAIN_LIGHTNING = {
  mpCost: 15,
  cooldownSeconds: 1.5,
  /** The first enemy must be this close to the caster… */
  range: 250,
  /** …and this close to the target point (the cursor, or the auto-aimed enemy). */
  pickRadius: 80,
  /** Each jump goes to the nearest unhit enemy this close to the last one hit. */
  jumpRange: 120,
  /** Each jump does this share of the previous hit. */
  falloff: 0.8,
} as const;

/** First hit before Attack scaling: 70 + 15 × tier (D-097). */
export function chainLightningDamage(tier: number): number {
  return 70 + 15 * tier;
}

/** Jumps after the first hit: 3, one more at T5 and at T10 (D-097). */
export function chainLightningJumps(tier: number): number {
  return 3 + (tier >= 5 ? 1 : 0) + (tier >= 10 ? 1 : 0);
}

/** Druid (D-097): a patch of grasping roots that hurts and slows. */
export const NATURES_REACH = {
  mpCost: 20,
  cooldownSeconds: 4,
  range: 250,
  radius: 60,
  seconds: 3,
  /** Damage lands this often while the patch lasts. */
  pulseSeconds: 0.5,
  /** Enemies inside move at this share of their speed. */
  slowFactor: 0.5,
} as const;

/** Damage per pulse before Attack scaling: 20 + 5 × tier (D-097). */
export function naturesReachDamage(tier: number): number {
  return 20 + 5 * tier;
}

export type AbilityKind =
  "arcaneBlast" | "volley" | "chainLightning" | "naturesReach";

/** What every ability shares: its cost, cooldown, and reach (for aiming). */
export const ABILITIES: Record<
  AbilityKind,
  { name: string; mpCost: number; cooldownSeconds: number; range: number }
> = {
  arcaneBlast: {
    name: "Arcane Blast",
    mpCost: ARCANE_BLAST.mpCost,
    cooldownSeconds: ARCANE_BLAST.cooldownSeconds,
    range: ARCANE_BLAST.range,
  },
  volley: {
    name: "Volley",
    mpCost: VOLLEY.mpCost,
    cooldownSeconds: VOLLEY.cooldownSeconds,
    range: VOLLEY.range,
  },
  chainLightning: {
    name: "Chain Lightning",
    mpCost: CHAIN_LIGHTNING.mpCost,
    cooldownSeconds: CHAIN_LIGHTNING.cooldownSeconds,
    range: CHAIN_LIGHTNING.range,
  },
  naturesReach: {
    name: "Nature's Reach",
    mpCost: NATURES_REACH.mpCost,
    cooldownSeconds: NATURES_REACH.cooldownSeconds,
    range: NATURES_REACH.range,
  },
};

/** The ability a player can cast this run, from their worn ability item. */
export interface AbilityLoadout {
  kind: AbilityKind;
  /** The ability item's tier (D-095). */
  tier: number;
}

/** What a worn ability item lets its wearer cast; null if not built yet. */
export function abilityForItem(
  type: AbilityItemType,
  tier: number,
): AbilityLoadout | null {
  const kind = ITEM_ABILITY[type];
  return kind ? { kind, tier } : null;
}

/** Which ability each ability item casts (the rest arrive in 10b–10d). */
const ITEM_ABILITY: Partial<Record<AbilityItemType, AbilityKind>> = {
  spellbook: "arcaneBlast",
  quiver: "volley",
  scepter: "chainLightning",
  totem: "naturesReach",
};

/** Display name for the HUD. */
export const ABILITY_NAMES: Record<AbilityKind, string> = {
  arcaneBlast: ABILITIES.arcaneBlast.name,
  volley: ABILITIES.volley.name,
  chainLightning: ABILITIES.chainLightning.name,
  naturesReach: ABILITIES.naturesReach.name,
};

/** Limits an aimed offset to the ability's range, keeping its direction. */
export function clampToRange(offset: Vec2, range: number): Vec2 {
  const length = Math.hypot(offset.x, offset.y);
  if (length <= range) return offset;
  return { x: (offset.x / length) * range, y: (offset.y / length) * range };
}

/**
 * Where an aimed ability goes (D-094), as an offset from the player: in
 * Auto aim, the closest enemy within reach; otherwise the mouse cursor.
 * Null when there is nothing to aim at (Space then does nothing). The
 * server clamps the result to the range again; the client never decides.
 */
export function resolveAbilityTarget(
  mode: FireMode,
  pointer: PointerState,
  from: Vec2,
  targets: readonly AimTarget[],
  range: number,
): Vec2 | null {
  if (mode === "autoAim") {
    const target = closestTargetInRange(from, targets, range);
    if (!target) return null;
    return clampToRange(
      { x: target.position.x - from.x, y: target.position.y - from.y },
      range,
    );
  }
  if (!pointer.world || !aimDirection(from, pointer.world)) return null;
  return clampToRange(
    { x: pointer.world.x - from.x, y: pointer.world.y - from.y },
    range,
  );
}
