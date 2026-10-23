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
 * Nature's Reach (10b); Barbarian Battle Cry, Bard Inspiration, Warlock
 * Curse (10c); Fighter Guard, Rogue Vanish, Cleric Healing (10d): all ten.
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

/** Barbarian (D-098): a self buff to every source of damage. */
export const BATTLE_CRY = {
  mpCost: 15,
  cooldownSeconds: 10,
  seconds: 5,
} as const;

/** Battle Cry's damage bonus: (30 + 5 × tier)% (D-098). */
export function battleCryBonus(tier: number): number {
  return (30 + 5 * tier) / 100;
}

/** Bard (D-098): you and nearby allies hit harder and heal faster. */
export const INSPIRATION = {
  mpCost: 20,
  cooldownSeconds: 12,
  seconds: 6,
  /** Every living player this close to the Bard at the cast is inspired. */
  radius: 160,
  /** Extra HP per second while inspired. */
  regenPerSecond: 1,
} as const;

/** Inspiration's damage bonus: (20 + 4 × tier)% (D-098). */
export function inspirationBonus(tier: number): number {
  return (20 + 4 * tier) / 100;
}

/** Warlock (D-098): enemies in an area take more damage from everyone. */
export const CURSE = {
  mpCost: 15,
  cooldownSeconds: 6,
  range: 250,
  radius: 50,
  seconds: 5,
} as const;

/** Extra damage a cursed enemy takes: (25 + 5 × tier)% (D-098). */
export function curseBonus(tier: number): number {
  return (25 + 5 * tier) / 100;
}

/** Fighter (D-100): brace behind the Shield. */
export const GUARD = { mpCost: 12, cooldownSeconds: 6, seconds: 2.5 } as const;

/** Share of each hit Guard blocks: (50 + 3 × tier)%, at most 80% (D-100). */
export function guardReduction(tier: number): number {
  return Math.min(0.8, (50 + 3 * tier) / 100);
}

/** Rogue (D-100): out of sight; flying bullets still hit, softer. */
export const VANISH = {
  mpCost: 15,
  cooldownSeconds: 8,
  /** Share of a hit that still lands while vanished. */
  damageReduction: 0.5,
} as const;

/** How long Vanish lasts: 2 + 0.2 × tier seconds (D-100). */
export function vanishSeconds(tier: number): number {
  return 2 + 0.2 * tier;
}

/** Cleric (D-100): heal yourself and everyone near. */
export const HEALING = { mpCost: 20, cooldownSeconds: 8, radius: 160 } as const;

/** HP Healing restores: 10 + 3 × tier, plus 10% of the target's max HP. */
export function healingAmount(tier: number, maxHp: number): number {
  return 10 + 3 * tier + 0.1 * maxHp;
}

export type AbilityKind =
  | "arcaneBlast"
  | "volley"
  | "chainLightning"
  | "naturesReach"
  | "battleCry"
  | "inspiration"
  | "curse"
  | "guard"
  | "vanish"
  | "healing";

/**
 * What every ability shares: its cost, cooldown, and reach (for aiming).
 * `selfCast` abilities need no target: Space casts them where you stand.
 */
export const ABILITIES: Record<
  AbilityKind,
  {
    name: string;
    mpCost: number;
    cooldownSeconds: number;
    range: number;
    selfCast?: boolean;
    /** Moves the caster: never cast by Full auto, only by Space (D-099). */
    movement?: boolean;
  }
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
  battleCry: {
    name: "Battle Cry",
    mpCost: BATTLE_CRY.mpCost,
    cooldownSeconds: BATTLE_CRY.cooldownSeconds,
    range: 0,
    selfCast: true,
  },
  inspiration: {
    name: "Inspiration",
    mpCost: INSPIRATION.mpCost,
    cooldownSeconds: INSPIRATION.cooldownSeconds,
    range: 0,
    selfCast: true,
  },
  curse: {
    name: "Curse",
    mpCost: CURSE.mpCost,
    cooldownSeconds: CURSE.cooldownSeconds,
    range: CURSE.range,
  },
  guard: {
    name: "Guard",
    mpCost: GUARD.mpCost,
    cooldownSeconds: GUARD.cooldownSeconds,
    range: 0,
    selfCast: true,
  },
  vanish: {
    name: "Vanish",
    mpCost: VANISH.mpCost,
    cooldownSeconds: VANISH.cooldownSeconds,
    range: 0,
    selfCast: true,
    // An escape, so only Space casts it, never Full auto (D-102).
    movement: true,
  },
  healing: {
    name: "Healing",
    mpCost: HEALING.mpCost,
    cooldownSeconds: HEALING.cooldownSeconds,
    range: 0,
    selfCast: true,
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

/** Which ability each ability item casts (every class has one, D-072). */
const ITEM_ABILITY: Record<AbilityItemType, AbilityKind> = {
  spellbook: "arcaneBlast",
  quiver: "volley",
  scepter: "chainLightning",
  totem: "naturesReach",
  warhorn: "battleCry",
  instrument: "inspiration",
  grimoire: "curse",
  shield: "guard",
  cloak: "vanish",
  tome: "healing",
};

/** Display name for the HUD. */
export const ABILITY_NAMES: Record<AbilityKind, string> = {
  arcaneBlast: ABILITIES.arcaneBlast.name,
  volley: ABILITIES.volley.name,
  chainLightning: ABILITIES.chainLightning.name,
  naturesReach: ABILITIES.naturesReach.name,
  battleCry: ABILITIES.battleCry.name,
  inspiration: ABILITIES.inspiration.name,
  curse: ABILITIES.curse.name,
  guard: ABILITIES.guard.name,
  vanish: ABILITIES.vanish.name,
  healing: ABILITIES.healing.name,
};

/** Limits an aimed offset to the ability's range, keeping its direction. */
export function clampToRange(offset: Vec2, range: number): Vec2 {
  const length = Math.hypot(offset.x, offset.y);
  if (length <= range) return offset;
  return { x: (offset.x / length) * range, y: (offset.y / length) * range };
}

/**
 * What Space (or Full auto) asks the server to cast this tick, as a target
 * offset from the player, or null for nothing (D-094, D-099):
 * - Full auto casts by itself whenever an enemy is within the ability's
 *   reach (for self-cast buffs, the basic shot's range), except movement
 *   abilities; Space works too, even with no enemy near.
 * - The other modes cast only while Space is held.
 * - Aimed abilities go at the closest enemy in reach in Full auto and
 *   Auto aim (the cursor if none is near), otherwise at the cursor.
 * - Self-cast abilities need no target: "here" (0, 0).
 * The server still checks the item, MP, and cooldown and clamps the range.
 */
export function abilityIntent(
  mode: FireMode,
  spaceHeld: boolean,
  ability: AbilityLoadout | null,
  pointer: PointerState,
  from: Vec2,
  targets: readonly AimTarget[],
  shotRange: number,
): Vec2 | null {
  if (!ability) return null;
  const info = ABILITIES[ability.kind];
  const reach = info.selfCast ? shotRange : info.range;
  const enemyNear = closestTargetInRange(from, targets, reach) !== null;
  const auto = mode === "fullAuto" && !info.movement && enemyNear;
  if (!spaceHeld && !auto) return null;
  if (info.selfCast) return { x: 0, y: 0 };
  const aimed = resolveAbilityTarget(mode, pointer, from, targets, info.range);
  if (aimed || mode === "autoFire" || mode === "manual") return aimed;
  // Space in an auto-aim mode with nobody in reach: toward the cursor.
  return resolveAbilityTarget("manual", pointer, from, targets, info.range);
}

/**
 * Where an aimed ability goes (D-094), as an offset from the player: in
 * Full auto and Auto aim, the closest enemy within reach; otherwise the
 * mouse cursor. Null when there is nothing to aim at. The server clamps
 * the result to the range again; the client never decides.
 */
export function resolveAbilityTarget(
  mode: FireMode,
  pointer: PointerState,
  from: Vec2,
  targets: readonly AimTarget[],
  range: number,
): Vec2 | null {
  if (mode === "autoAim" || mode === "fullAuto") {
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
