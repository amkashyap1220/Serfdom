import {
  ABILITY_ITEM_TYPES,
  CLASS_ABILITY_ITEM,
  CLASS_GEAR,
  ACCESSORY_SLOTS,
  ARMOR_SLOTS,
  ARMOR_TYPES,
  WEAPON_TYPES,
  type EquipSlot,
  type ItemSlot,
  type ItemSpec,
} from "./items.ts";
import type { ClassId } from "./classes.ts";
import { STAT_KEYS } from "./stats.ts";

/*
 * Tier 0 is free starter gear (D-157): a new serf wears it, a class choice
 * offers the class's set, the Exchange gives any of it away without limit,
 * and no dungeon drops it.
 */

/** A piece to create and wear in one slot. */
export interface Wear {
  slot: EquipSlot;
  item: ItemSpec;
}

function tier0(slot: ItemSlot, type: string): ItemSpec {
  return { slot, type: type as ItemSpec["type"], tier: 0, rolls: [], luck: 0 };
}

/** What a new serf wears: a Sword and leather Cap, Tunic, Leggings, Gloves. */
export const STARTER_GEAR: readonly Wear[] = [
  { slot: "weapon", item: tier0("weapon", "sword") },
  ...ARMOR_SLOTS.map((slot) => ({ slot, item: tier0(slot, "leather") })),
];

/**
 * The free Tier 0 set a class choice offers: the class's first weapon, the
 * four armor pieces of its material, and its ability item.
 */
export function classSet(classId: ClassId): Wear[] {
  const gear = CLASS_GEAR[classId];
  return [
    { slot: "weapon", item: tier0("weapon", gear.weapons[0]!) },
    ...ARMOR_SLOTS.map((slot) => ({ slot, item: tier0(slot, gear.armor) })),
    { slot: "ability", item: tier0("ability", CLASS_ABILITY_ITEM[classId]) },
  ];
}

/** Every Tier 0 item, each free on the Exchange: no rolls, never Shiny. */
export const FREE_TIER0: readonly ItemSpec[] = [
  ...WEAPON_TYPES.map((t) => tier0("weapon", t)),
  ...ABILITY_ITEM_TYPES.map((t) => tier0("ability", t)),
  ...ARMOR_SLOTS.flatMap((slot) => ARMOR_TYPES.map((t) => tier0(slot, t))),
  ...ACCESSORY_SLOTS.flatMap((slot) => STAT_KEYS.map((s) => tier0(slot, s))),
];

/** Whether this item is free Tier 0 gear (an Artifact never is). */
export function isFreeTier0(
  item: Pick<ItemSpec, "tier" | "artifact">,
): boolean {
  return item.tier === 0 && !item.artifact;
}

/** The free Tier 0 item of this slot and type, if there is one. */
export function freeTier0(slot: unknown, type: unknown): ItemSpec | null {
  return FREE_TIER0.find((i) => i.slot === slot && i.type === type) ?? null;
}
