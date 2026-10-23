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
 * Numbers are D-096 (approved, tunable). Only the Wizard's Arcane Blast
 * exists so far; the other nine arrive in 10b–10d.
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

export type AbilityKind = "arcaneBlast";

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
  return type === "spellbook" ? { kind: "arcaneBlast", tier } : null;
}

/** Display name for the HUD. */
export const ABILITY_NAMES: Record<AbilityKind, string> = {
  arcaneBlast: "Arcane Blast",
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
