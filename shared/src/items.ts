import type { ClassId } from "./classes.ts";
import { PLAYER_WEAPON } from "./combat-config.ts";
import type { DungeonId } from "./dungeons.ts";
import { STAT_KEYS, zeroStats, type StatKey, type Stats } from "./stats.ts";

/**
 * Equipment (Phase 9). Confirmed: 10 slots (D-082), classes restrict
 * weapons and armor (D-081), one chest is one item (D-080), a serf carries
 * only what it has equipped and loses it on death (D-079, D-085), the rest
 * lives in the account's stash (D-085–D-088), Luck +1 at most and never
 * negative (D-067). The numbers are D-083, D-084, D-090 (approved, tunable). Items are rolled only
 * by the server; these rules are shared so the client can show and check
 * them, never to create items.
 */
export const WEAPON_TYPES = [
  "sword",
  "dagger",
  "axe",
  "bow",
  "staff",
  "wand",
  "mace",
] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export const ARMOR_TYPES = ["cloth", "leather", "plate"] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];

/** What an item is. A ring fits either ring slot. */
export const ITEM_SLOTS = [
  "weapon",
  "head",
  "chest",
  "legs",
  "gloves",
  "ring",
  "necklace",
  "cape",
] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const ARMOR_SLOTS = ["head", "chest", "legs", "gloves"] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

/** Where a serf wears things (D-082). The ability item slot fills in Phase 10. */
export const EQUIP_SLOTS = [
  "weapon",
  "ability",
  "head",
  "chest",
  "legs",
  "gloves",
  "ring1",
  "ring2",
  "necklace",
  "cape",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const MAX_TIER = 10;
/** Stat rolls per tier T0–T10 (D-083: T0 none, T10 five). */
export const ROLLS_PER_TIER = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;

/**
 * Rolls an item of this slot and tier has: the tier's count, except that
 * accessories (no base value) always have at least one, so no drop is
 * empty (D-084).
 */
export function rollsFor(slot: ItemSlot, tier: number): number {
  const count = ROLLS_PER_TIER[tier] ?? 0;
  return slot === "weapon" || isArmorSlot(slot) ? count : Math.max(1, count);
}
export const NEGATIVE_ROLL_CHANCE = 0.2;
/** Chance of +1 Luck on an item with at least one roll. */
export const LUCK_CHANCE = 0.05;
/** Unequipped items an account can keep (D-090; more in Phase 12). */
export const STASH_SIZE = 20;

export interface StatRoll {
  stat: StatKey;
  /** Whole, never 0; negative for a bad roll. */
  amount: number;
}

/** An item as rolled: everything but where it is. */
export interface ItemSpec {
  slot: ItemSlot;
  /** Weapon or armor type; null for accessories. */
  type: WeaponType | ArmorType | null;
  tier: number;
  rolls: StatRoll[];
  /** 0 or +1 (D-067): never negative, never more than one. */
  luck: number;
}

/** An item an account owns. */
export interface Item extends ItemSpec {
  id: number;
  /** Where its serf wears it, or null in the stash (or waiting for room). */
  equipped: EquipSlot | null;
}

/** Reference value in gold (D-090): 5 × (tier + 1)², ×1.5 with +1 Luck. */
export function itemValue(item: ItemSpec): number {
  const base = 5 * (item.tier + 1) ** 2;
  return item.luck > 0 ? base * 1.5 : base;
}

/** What the vendor pays (D-087, D-090): half the value, rounded down, at least 1. */
export function sellPrice(item: ItemSpec): number {
  return Math.max(1, Math.floor(itemValue(item) / 2));
}

/** Who may use which weapons and armor (D-081, D-083). */
export const CLASS_GEAR: Record<
  ClassId,
  { weapons: readonly WeaponType[]; armor: ArmorType }
> = {
  fighter: { weapons: ["sword", "axe", "mace"], armor: "plate" },
  barbarian: { weapons: ["axe", "mace"], armor: "leather" },
  rogue: { weapons: ["dagger", "bow"], armor: "leather" },
  ranger: { weapons: ["bow", "dagger"], armor: "leather" },
  wizard: { weapons: ["staff", "wand"], armor: "cloth" },
  cleric: { weapons: ["mace", "staff"], armor: "plate" },
  bard: { weapons: ["dagger", "wand"], armor: "leather" },
  warlock: { weapons: ["wand", "dagger"], armor: "cloth" },
  druid: { weapons: ["staff", "bow"], armor: "leather" },
  sorcerer: { weapons: ["wand", "staff"], armor: "cloth" },
};

interface LootPool {
  tiers: readonly (readonly [tier: number, weight: number])[];
  slots: readonly (readonly [slot: ItemSlot, weight: number])[];
}

/** Standard slot weights (D-083): weapon 20%, armor 10% each, accessories 40%. */
const SLOT_WEIGHTS = [
  ["weapon", 20],
  ["head", 10],
  ["chest", 10],
  ["legs", 10],
  ["gloves", 10],
  ["ring", 15],
  ["necklace", 12.5],
  ["cape", 12.5],
] as const;

/** Loot pools are specific to the dungeon (D-016). */
export const LOOT_POOLS: Record<DungeonId, LootPool> = {
  "goblin-warrens": {
    tiers: [
      [0, 50],
      [1, 35],
      [2, 15],
    ],
    slots: SLOT_WEIGHTS,
  },
  training: {
    tiers: [
      [0, 50],
      [1, 35],
      [2, 15],
    ],
    slots: SLOT_WEIGHTS,
  },
};

/** Weapon shot damage at Attack 10 (D-083); no weapon shoots for 25. */
export function weaponDamage(tier: number | null): number {
  return tier === null ? PLAYER_WEAPON.damage : 27 + 4 * tier;
}

/** Largest size of one roll on an item of `tier` (HP and MP roll ×3). */
export function maxRoll(stat: StatKey, tier: number): number {
  return (tier + 1) * (stat === "hp" || stat === "mp" ? 3 : 1);
}

/** A whole number in [min, max] from a random() in [0, 1). */
function between(min: number, max: number, random: () => number): number {
  return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

function pickWeighted<T>(
  options: readonly (readonly [T, number])[],
  random: () => number,
): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [value, weight] of options) {
    if (r < weight) return value;
    r -= weight;
  }
  const last = options[options.length - 1];
  if (!last) throw new Error("empty weighted list");
  return last[0];
}

function pick<T>(list: readonly T[], random: () => number): T {
  const v = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  if (v === undefined) throw new Error("empty list");
  return v;
}

/** One chest's item from the dungeon's pool (D-080). Server only. */
export function rollItem(dungeon: DungeonId, random: () => number): ItemSpec {
  const pool = LOOT_POOLS[dungeon];
  const tier = pickWeighted(pool.tiers, random);
  const slot = pickWeighted(pool.slots, random);
  const type =
    slot === "weapon"
      ? pick(WEAPON_TYPES, random)
      : isArmorSlot(slot)
        ? pick(ARMOR_TYPES, random)
        : null;
  const rolls: StatRoll[] = [];
  for (let i = 0; i < rollsFor(slot, tier); i++) {
    const stat = pick(STAT_KEYS, random);
    const size = between(1, maxRoll(stat, tier), random);
    rolls.push({
      stat,
      amount: random() < NEGATIVE_ROLL_CHANCE ? -size : size,
    });
  }
  const luck = rolls.length > 0 && random() < LUCK_CHANCE ? 1 : 0;
  return { slot, type, tier, rolls, luck };
}

export function isArmorSlot(slot: ItemSlot): slot is ArmorSlot {
  return (ARMOR_SLOTS as readonly string[]).includes(slot);
}

/** What an item adds to its wearer's stats: armor base plus its rolls. */
export function itemBonus(item: ItemSpec): Stats {
  const bonus = zeroStats();
  if (isArmorSlot(item.slot)) {
    if (item.type === "plate") bonus.defense += 1 + item.tier;
    if (item.type === "leather") bonus.defense += item.tier;
    if (item.type === "cloth") bonus.mp += 2 + 2 * item.tier;
  }
  for (const roll of item.rolls) bonus[roll.stat] += roll.amount;
  return bonus;
}

/**
 * Whether a serf of this class (null = still a Serf) may wear the item:
 * accessories always; weapons and armor by class (D-081), and only T0
 * before a class.
 */
export function canEquip(item: ItemSpec, classId: ClassId | null): boolean {
  if (item.slot === "weapon") {
    if (classId === null) return item.tier === 0;
    return (CLASS_GEAR[classId].weapons as readonly string[]).includes(
      item.type ?? "",
    );
  }
  if (isArmorSlot(item.slot)) {
    if (classId === null) return item.tier === 0;
    return CLASS_GEAR[classId].armor === item.type;
  }
  return true;
}

/** Armor pieces are named by material and slot (D-091): a Robe is cloth. */
const ARMOR_NAMES: Record<ArmorType, Record<ArmorSlot, string>> = {
  cloth: { head: "Hood", chest: "Robe", legs: "Trousers", gloves: "Wraps" },
  leather: { head: "Cap", chest: "Tunic", legs: "Leggings", gloves: "Gloves" },
  plate: {
    head: "Helm",
    chest: "Breastplate",
    legs: "Greaves",
    gloves: "Gauntlets",
  },
};

const ACCESSORY_NAMES = { ring: "Ring", necklace: "Necklace", cape: "Cape" };

/** "T1 Wand", "T2 Robe", "T0 Gauntlets", "T0 Ring". */
export function itemName(item: ItemSpec): string {
  return `T${item.tier} ${pieceName(item)}`;
}

function pieceName(item: ItemSpec): string {
  if (item.slot === "weapon") return capitalize(item.type ?? "weapon");
  if (isArmorSlot(item.slot)) {
    return ARMOR_NAMES[item.type as ArmorType][item.slot];
  }
  return ACCESSORY_NAMES[item.slot];
}

/** "Cloth", "Leather", "Plate" for armor; null otherwise. */
export function armorTypeName(item: ItemSpec): string | null {
  return isArmorSlot(item.slot) && item.type ? capitalize(item.type) : null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Whether `v` is an item the server could have rolled: the right type for
 * its slot, a tier in range, exactly that tier's number of rolls, each
 * whole, non-zero, and within the tier's size, and Luck 0 or (with at
 * least one roll) 1. Untrusted input goes through this (D-067).
 */
export function isValidItemSpec(v: ItemSpec): boolean {
  if (!(ITEM_SLOTS as readonly string[]).includes(v.slot)) return false;
  if (!Number.isInteger(v.tier) || v.tier < 0 || v.tier > MAX_TIER) {
    return false;
  }
  const typeOk =
    v.slot === "weapon"
      ? (WEAPON_TYPES as readonly unknown[]).includes(v.type)
      : isArmorSlot(v.slot)
        ? (ARMOR_TYPES as readonly unknown[]).includes(v.type)
        : v.type === null;
  if (!typeOk) return false;
  if (v.rolls.length !== rollsFor(v.slot, v.tier)) return false;
  for (const roll of v.rolls) {
    if (!(STAT_KEYS as readonly string[]).includes(roll.stat)) return false;
    const size = Math.abs(roll.amount);
    if (!Number.isInteger(roll.amount) || size < 1) return false;
    if (size > maxRoll(roll.stat, v.tier)) return false;
  }
  if (v.luck !== 0 && v.luck !== 1) return false;
  return v.luck === 0 || v.rolls.length > 0;
}
