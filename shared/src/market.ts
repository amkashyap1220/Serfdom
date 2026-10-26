import { ARTIFACTS, ARTIFACT_IDS, type ArtifactId } from "./artifacts.ts";
import {
  ABILITY_ITEM_TYPES,
  ARMOR_TYPES,
  ITEM_SLOTS,
  WEAPON_TYPES,
  isArmorSlot,
  itemKindName,
  type ItemSlot,
  type ItemSpec,
} from "./items.ts";
import { potionName } from "./potions.ts";
import { STAT_KEYS, type StatKey } from "./stats.ts";

/*
 * What the Exchange knows about items (D-156): rarity bands, "the same
 * item" for prices and buy orders, and roll filters.
 */

/** Rarity by tier (D-156): extra rolls start at T4 (D-106). */
export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "artifact",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_NAMES: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  artifact: "Artifact",
};

export function rarityOf(item: Pick<ItemSpec, "tier" | "artifact">): Rarity {
  if (item.artifact) return "artifact";
  if (item.tier >= 10) return "epic";
  if (item.tier >= 7) return "rare";
  if (item.tier >= 4) return "uncommon";
  return "common";
}

/** A roll a filter or order can ask for: a stat, or Luck. */
export type RollWish = StatKey | "luck";
export const ROLL_WISHES: readonly RollWish[] = [...STAT_KEYS, "luck"];

export function isRollWish(v: unknown): v is RollWish {
  return (ROLL_WISHES as readonly unknown[]).includes(v);
}

/**
 * Whether an item has every wished roll (D-156): a positive roll of each
 * stat (a negative one does not count), and +1 Luck for "luck". None
 * wished: any item matches.
 */
export function hasRolls(
  item: Pick<ItemSpec, "rolls" | "luck">,
  wished: readonly RollWish[],
): boolean {
  return wished.every((w) =>
    w === "luck"
      ? item.luck > 0
      : item.rolls.some((r) => r.stat === w && r.amount > 0),
  );
}

/**
 * "The same item" for prices and buy orders (D-156): one Artifact; one
 * tier of one kind of tiered piece; one potion stat. Shiny ones apart.
 * Written as a string, e.g. "a:doomrend", "t:7:weapon:sword:shiny",
 * "p:hp".
 */
export type MarketKey = string;

export function marketKeyOf(
  thing:
    | { item: Pick<ItemSpec, "slot" | "type" | "tier" | "artifact" | "shiny"> }
    | { potion: { stat: StatKey } },
): MarketKey {
  if ("potion" in thing) return `p:${thing.potion.stat}`;
  const i = thing.item;
  const shiny = i.shiny ? ":shiny" : "";
  return i.artifact
    ? `a:${i.artifact}${shiny}`
    : `t:${i.tier}:${i.slot}:${i.type ?? ""}${shiny}`;
}

/** A key's parts, or null if it names nothing that can exist. */
export function parseMarketKey(key: unknown):
  | { kind: "artifact"; artifact: ArtifactId; shiny: boolean }
  | {
      kind: "tiered";
      tier: number;
      slot: ItemSlot;
      type: string;
      shiny: boolean;
    }
  | { kind: "potion"; stat: StatKey }
  | null {
  if (typeof key !== "string" || key.length > 64) return null;
  const parts = key.split(":");
  if (parts[0] === "p" && parts.length === 2) {
    const stat = parts[1];
    return (STAT_KEYS as readonly string[]).includes(stat ?? "")
      ? { kind: "potion", stat: stat as StatKey }
      : null;
  }
  if (parts[0] === "a" && (parts.length === 2 || parts.length === 3)) {
    const id = parts[1];
    if (!ARTIFACT_IDS.includes(id as ArtifactId)) return null;
    if (parts.length === 3 && parts[2] !== "shiny") return null;
    return {
      kind: "artifact",
      artifact: id as ArtifactId,
      shiny: parts.length === 3,
    };
  }
  if (parts[0] === "t" && (parts.length === 4 || parts.length === 5)) {
    const tier = Number(parts[1]);
    const slot = parts[2] as ItemSlot;
    const type = parts[3] ?? "";
    if (!Number.isInteger(tier) || tier < 0 || tier > 10) return null;
    if (!(ITEM_SLOTS as readonly string[]).includes(slot)) return null;
    if (!typeFitsSlot(slot, type)) return null;
    if (parts.length === 5 && parts[4] !== "shiny") return null;
    return { kind: "tiered", tier, slot, type, shiny: parts.length === 5 };
  }
  return null;
}

/** A key's name for people: "T7 Sword", "Shiny Doomrend, …", "Potion of Health". */
export function marketKeyName(key: MarketKey): string {
  const k = parseMarketKey(key);
  if (!k) return key;
  if (k.kind === "potion") return potionName(k.stat);
  const shiny = k.shiny ? "Shiny " : "";
  if (k.kind === "artifact") return `${shiny}${ARTIFACTS[k.artifact].name}`;
  const piece = itemKindName({
    slot: k.slot,
    type: k.type as ItemSpec["type"],
    tier: k.tier,
    rolls: [],
    luck: 0,
  });
  return `${shiny}T${k.tier} ${piece}`;
}

/** Whether a tiered piece of this slot can be of this type (an accessory: its base stat). */
function typeFitsSlot(slot: ItemSlot, type: string): boolean {
  const types: readonly string[] =
    slot === "weapon"
      ? WEAPON_TYPES
      : slot === "ability"
        ? ABILITY_ITEM_TYPES
        : isArmorSlot(slot)
          ? ARMOR_TYPES
          : STAT_KEYS;
  return types.includes(type);
}
