import { CLASSES, type ClassId } from "./classes.ts";
import { abilityForItem, type AbilityLoadout } from "./abilities.ts";
import { PLAYER_WEAPON } from "./combat-config.ts";
import type { DungeonId } from "./dungeons.ts";
import { STAT_KEYS, zeroStats, type StatKey, type Stats } from "./stats.ts";

/**
 * Equipment (Phase 9). Confirmed: 10 slots (D-082), classes restrict
 * weapons and armor (D-081), one chest is one item (D-080), a serf carries
 * only what it has equipped and loses it on death (D-079, D-085), the rest
 * lives in the account's stash (D-085–D-088), Luck +1 at most and never
 * negative (D-067). The numbers are D-083, D-090, D-106 (approved, tunable). Items are rolled only
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

/** One ability item per class (GDD §4, D-092, D-096). */
export const ABILITY_ITEM_TYPES = [
  "shield",
  "warhorn",
  "cloak",
  "quiver",
  "spellbook",
  "tome",
  "instrument",
  "grimoire",
  "totem",
  "scepter",
] as const;
export type AbilityItemType = (typeof ABILITY_ITEM_TYPES)[number];

/** Which ability item each class uses; only that class can wear it (D-096). */
export const CLASS_ABILITY_ITEM: Record<ClassId, AbilityItemType> = {
  fighter: "shield",
  barbarian: "warhorn",
  rogue: "cloak",
  ranger: "quiver",
  wizard: "spellbook",
  cleric: "tome",
  bard: "instrument",
  warlock: "grimoire",
  druid: "totem",
  sorcerer: "scepter",
};

/** What an item is. A ring fits either ring slot. */
export const ITEM_SLOTS = [
  "weapon",
  "ability",
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

/** Rings, necklaces, capes: any class wears them (D-081). */
export const ACCESSORY_SLOTS = ["ring", "necklace", "cape"] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

/** Where a serf wears things (D-082). */
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
/**
 * Extra stat rolls per tier T0–T10 (D-106): none before T4, then D-083's
 * counts, up to five at T10. Every item has a base (damage, armor, an
 * accessory's stat), so no drop is empty without them.
 */
export const ROLLS_PER_TIER = [0, 0, 0, 0, 2, 3, 3, 4, 4, 5, 5] as const;

/** Rolls an item of this tier has (the same for every slot, D-106). */
export function rollsFor(_slot: ItemSlot, tier: number): number {
  return ROLLS_PER_TIER[tier] ?? 0;
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
  /**
   * Weapon, armor, or ability item type; for an accessory, its base stat
   * ("a Ring of Defense", D-106). Null is never valid; it stays in the
   * type only because untrusted input is checked by isValidItemSpec.
   */
  type: WeaponType | ArmorType | AbilityItemType | StatKey | null;
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

export interface LootPool {
  tiers: readonly (readonly [tier: number, weight: number])[];
  slots: readonly (readonly [slot: ItemSlot, weight: number])[];
}

/**
 * Standard slot weights: ability items 10% (D-096), the D-083 weights
 * scaled to the other 90% (weapon 18%, armor 9% each, accessories 36%).
 */
const SLOT_WEIGHTS = [
  ["weapon", 18],
  ["ability", 10],
  ["head", 9],
  ["chest", 9],
  ["legs", 9],
  ["gloves", 9],
  ["ring", 13.5],
  ["necklace", 11.25],
  ["cape", 11.25],
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

/** HP and MP come in bigger numbers: their rolls and bases are ×3. */
const statScale = (stat: StatKey): number =>
  stat === "hp" || stat === "mp" ? 3 : 1;

/** Largest size of one extra roll on any item: 3, or 9 for HP and MP (D-106). */
export function maxRoll(stat: StatKey): number {
  return 3 * statScale(stat);
}

/**
 * An accessory's guaranteed base: tier + 1 (×3 for HP and MP), so every
 * tier gives more than the last and the base beats any roll (D-106).
 */
export function accessoryBase(stat: StatKey, tier: number): number {
  return (tier + 1) * statScale(stat);
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
  return rollFromPool(LOOT_POOLS[dungeon], random);
}

/** One item from any pool (tests use pools with higher tiers). */
export function rollFromPool(pool: LootPool, random: () => number): ItemSpec {
  const tier = pickWeighted(pool.tiers, random);
  const slot = pickWeighted(pool.slots, random);
  const type =
    slot === "weapon"
      ? pick(WEAPON_TYPES, random)
      : slot === "ability"
        ? pick(ABILITY_ITEM_TYPES, random) // any class's (D-096)
        : isArmorSlot(slot)
          ? pick(ARMOR_TYPES, random)
          : pick(STAT_KEYS, random); // an accessory's base stat
  // An accessory's extra rolls are other stats than its base (D-106).
  const rollable = isAccessorySlot(slot)
    ? STAT_KEYS.filter((k) => k !== type)
    : STAT_KEYS;
  const rolls: StatRoll[] = [];
  for (let i = 0; i < rollsFor(slot, tier); i++) {
    const stat = pick(rollable, random);
    const size = between(1, maxRoll(stat), random);
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

export function isAccessorySlot(slot: ItemSlot): slot is AccessorySlot {
  return (ACCESSORY_SLOTS as readonly string[]).includes(slot);
}

function isStatKey(v: unknown): v is StatKey {
  return (STAT_KEYS as readonly unknown[]).includes(v);
}

/** What an item adds to its wearer's stats: its base (armor, accessory) plus its rolls. */
export function itemBonus(item: ItemSpec): Stats {
  const bonus = zeroStats();
  if (isAccessorySlot(item.slot) && isStatKey(item.type)) {
    bonus[item.type] += accessoryBase(item.type, item.tier);
  }
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
 * before a class; ability items only by their own class (D-096).
 */
export function canEquip(item: ItemSpec, classId: ClassId | null): boolean {
  if (item.slot === "ability") {
    return classId !== null && CLASS_ABILITY_ITEM[classId] === item.type;
  }
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

/** Accessory names spell out the base stat: "Ring of Defense". */
const BASE_STAT_NAMES: Record<StatKey, string> = {
  hp: "HP",
  mp: "MP",
  attack: "Attack",
  dexterity: "Dexterity",
  speed: "Speed",
  defense: "Defense",
  vitality: "Vitality",
  wisdom: "Wisdom",
};

/** "T1 Wand", "T2 Robe", "T0 Gauntlets", "T5 Ring of Defense". */
export function itemName(item: ItemSpec): string {
  return `T${item.tier} ${pieceName(item)}`;
}

function pieceName(item: ItemSpec): string {
  if (item.slot === "weapon") return capitalize(item.type ?? "weapon");
  if (item.slot === "ability") return abilityItemName(item.type);
  if (isArmorSlot(item.slot)) {
    return ARMOR_NAMES[item.type as ArmorType][item.slot];
  }
  const base = isStatKey(item.type) ? ` of ${BASE_STAT_NAMES[item.type]}` : "";
  return `${ACCESSORY_NAMES[item.slot]}${base}`;
}

/** "War Horn", "Spellbook", …: the class's item name from GDD §4. */
function abilityItemName(type: ItemSpec["type"]): string {
  const owner = (Object.keys(CLASS_ABILITY_ITEM) as ClassId[]).find(
    (id) => CLASS_ABILITY_ITEM[id] === type,
  );
  return owner ? CLASSES[owner].abilityItem : "Ability item";
}

/** The class an ability item belongs to, or null for other items. */
export function abilityItemClass(item: ItemSpec): ClassId | null {
  if (item.slot !== "ability") return null;
  return (
    (Object.keys(CLASS_ABILITY_ITEM) as ClassId[]).find(
      (id) => CLASS_ABILITY_ITEM[id] === item.type,
    ) ?? null
  );
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
 * its slot (an accessory's is its base stat), a tier in range, exactly
 * that tier's number of rolls, each whole, non-zero, at most +3 (+9 HP and
 * MP) and, on an accessory, not its base stat, and Luck 0 or (with at
 * least one roll) 1. Untrusted input goes through this (D-067, D-106).
 */
export function isValidItemSpec(v: ItemSpec): boolean {
  if (!(ITEM_SLOTS as readonly string[]).includes(v.slot)) return false;
  if (!Number.isInteger(v.tier) || v.tier < 0 || v.tier > MAX_TIER) {
    return false;
  }
  const typeOk =
    v.slot === "weapon"
      ? (WEAPON_TYPES as readonly unknown[]).includes(v.type)
      : v.slot === "ability"
        ? (ABILITY_ITEM_TYPES as readonly unknown[]).includes(v.type)
        : isArmorSlot(v.slot)
          ? (ARMOR_TYPES as readonly unknown[]).includes(v.type)
          : isStatKey(v.type);
  if (!typeOk) return false;
  if (v.rolls.length !== rollsFor(v.slot, v.tier)) return false;
  for (const roll of v.rolls) {
    if (!(STAT_KEYS as readonly string[]).includes(roll.stat)) return false;
    const size = Math.abs(roll.amount);
    if (!Number.isInteger(roll.amount) || size < 1) return false;
    if (size > maxRoll(roll.stat)) return false;
    if (isAccessorySlot(v.slot) && roll.stat === v.type) return false;
  }
  if (v.luck !== 0 && v.luck !== 1) return false;
  return v.luck === 0 || v.rolls.length > 0;
}

/** What a serf fights with: its stats plus gear, and its weapon's tier. */
export interface Loadout {
  stats: Stats;
  /** Tier of the equipped weapon, or null (no weapon: 25 damage). */
  weaponTier: number | null;
  /** What Space casts, from the worn ability item (D-092); null = nothing. */
  ability: AbilityLoadout | null;
}

/**
 * A serf's effective stats (D-083): its rolled stats plus everything it
 * has equipped, not limited by the class max. A negative roll can lower a
 * stat, but never below 0 (HP below 1) (T-048).
 */
export function loadoutOf(serf: {
  stats: Stats;
  items: readonly Item[];
}): Loadout {
  const worn = serf.items.filter((i) => i.equipped !== null);
  const stats = { ...serf.stats };
  for (const item of worn) {
    const bonus = itemBonus(item);
    for (const key of STAT_KEYS) stats[key] += bonus[key];
  }
  for (const key of STAT_KEYS) {
    stats[key] = Math.max(key === "hp" ? 1 : 0, stats[key]);
  }
  const weapon = worn.find((i) => i.slot === "weapon");
  const book = worn.find((i) => i.slot === "ability");
  return {
    stats,
    weaponTier: weapon ? weapon.tier : null,
    ability: book
      ? abilityForItem(book.type as AbilityItemType, book.tier)
      : null,
  };
}

/** The worn slots an item can go in: a ring either ring slot, the rest their own. */
export function slotsFor(slot: ItemSlot): EquipSlot[] {
  return slot === "ring" ? ["ring1", "ring2"] : [slot];
}

/**
 * Per stat, how wearing `next` instead of `current` (null = empty slot)
 * changes the bonus: what the hover comparison shows (D-086, D-090).
 */
export function compareItems(next: ItemSpec, current: ItemSpec | null): Stats {
  const a = itemBonus(next);
  const b = current ? itemBonus(current) : zeroStats();
  const diff = zeroStats();
  for (const key of STAT_KEYS) diff[key] = a[key] - b[key];
  return diff;
}
