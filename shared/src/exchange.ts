import { ARTIFACTS } from "./artifacts.ts";
import type { ClassId } from "./classes.ts";
import {
  canEquip,
  itemFullName,
  MAX_TIER,
  type Item,
  type ItemSlot,
} from "./items.ts";
import {
  hasRolls,
  marketKeyOf,
  type MarketKey,
  type RollWish,
} from "./market.ts";
import { potionName, type Potion } from "./potions.ts";

/*
 * The Grand Serf Exchange (D-155): a listing board. A stash item or rack
 * potion is listed at a gold price, leaves the stash while listed, and
 * anyone else can buy it at once; the seller gets the price minus a fee
 * (destroyed: a gold sink). The server does every transfer.
 */

export const EXCHANGE = {
  /** The seller's fee, a share of the price, rounded down. */
  feeShare: 0.05,
  minPrice: 1,
  maxPrice: 1_000_000,
  /** Listings an account may have at once. */
  maxListings: 10,
  /** Buy orders an account may have at once (D-156). */
  maxOrders: 10,
  /** Buy orders a market view shows (the highest). */
  topOrders: 10,
  /** Listings a browse page shows. */
  pageSize: 20,
  /** Sales kept in "My listings". */
  history: 20,
  /** The longest name search. */
  maxSearch: 32,
} as const;

/** What the seller pays out of a sale. */
export function exchangeFee(price: number): number {
  return Math.floor(price * EXCHANGE.feeShare);
}

export function isValidPrice(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= EXCHANGE.minPrice &&
    v <= EXCHANGE.maxPrice
  );
}

/** One listing as a player sees it: an item or a potion, never both. */
export interface Listing {
  id: number;
  price: number;
  /** When it was listed (ms since 1970). */
  listedAt: number;
  item: Item | null;
  potion: Potion | null;
  /** The viewer's own listing (no Buy). */
  mine: boolean;
}

/** One finished sale, as its seller or buyer saw it. */
export interface Sale {
  /** The item or potion's name. */
  what: string;
  /** "The same item" (D-156), for its price history; null before D-156. */
  key: MarketKey | null;
  price: number;
  /** The fee the seller paid (0 for a buyer's view of it). */
  fee: number;
  at: number;
  role: "sold" | "bought";
}

export const EXCHANGE_SORTS = ["cheapest", "dearest", "newest"] as const;
export type ExchangeSort = (typeof EXCHANGE_SORTS)[number];

/** A browse (D-156): every filter is optional. */
export interface ExchangeQuery {
  /** An item slot, "potion", or null for everything. */
  slot: ItemSlot | "potion" | null;
  /** Within a slot: a weapon, armor, or ability item type, an accessory's base stat, or a potion's stat. */
  type: string | null;
  /** One tier (T0-T10) or Artifacts (the user, 2026-10-26: not rarity bands). */
  tier: TierFilter | null;
  /** Only Shiny ones. */
  shiny: boolean;
  /** Only what this class can wear (potions always pass). */
  classId: ClassId | null;
  /** Rolls it must have, all of them, positive (D-156); none: any. */
  rolls: RollWish[];
  /** Part of the name, any case. */
  search: string;
  sort: ExchangeSort;
  /** 0-based. */
  page: number;
}

/** A tier filter: one tier of tiered items, or the Artifacts. */
export type TierFilter = number | "artifact";

export function isTierFilter(v: unknown): v is TierFilter {
  return (
    v === "artifact" ||
    (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TIER)
  );
}

export const ANY_LISTING: ExchangeQuery = {
  slot: null,
  type: null,
  tier: null,
  shiny: false,
  classId: null,
  rolls: [],
  search: "",
  // The user: cheapest first by default (2026-10-26).
  sort: "cheapest",
  page: 0,
};

/** A buy order (D-156): the item, the rolls it must have, the most its buyer pays. */
export interface BuyOrder {
  id: number;
  key: MarketKey;
  rolls: RollWish[];
  price: number;
  placedAt: number;
  /** The viewer's own order. */
  mine: boolean;
}

/** One window of a price history (D-156): the average sale, and how many. */
export interface PriceWindow {
  window: "24h" | "7d" | "30d" | "all";
  average: number | null;
  sales: number;
}

/** Whether this item or potion is what an order wants (D-156). */
export function fitsOrder(
  thing: { item: Item | null; potion: Potion | null },
  order: Pick<BuyOrder, "key" | "rolls">,
): boolean {
  if (thing.item) {
    return (
      marketKeyOf({ item: thing.item }) === order.key &&
      hasRolls(thing.item, order.rolls)
    );
  }
  if (thing.potion) {
    return (
      marketKeyOf({ potion: thing.potion }) === order.key &&
      order.rolls.length === 0
    );
  }
  return false;
}

/** A listing's name, as shown and searched. */
export function listingName(l: Pick<Listing, "item" | "potion">): string {
  if (l.item) return itemFullName(l.item);
  if (l.potion) return potionName(l.potion.stat);
  return "";
}

/**
 * The page of listings a query shows, and how many match in all (D-155).
 * Pure, so the server's browse is tested on its own.
 */
export function filterListings(
  listings: readonly Listing[],
  q: ExchangeQuery,
): { total: number; listings: Listing[] } {
  const search = q.search.trim().toLowerCase();
  const matching = listings.filter((l) => {
    const item = l.item;
    if (q.slot === "potion" && !l.potion) return false;
    if (q.slot !== null && q.slot !== "potion" && item?.slot !== q.slot) {
      return false;
    }
    if (q.type !== null) {
      const type = item ? item.type : (l.potion?.stat ?? null);
      if (type !== q.type) return false;
    }
    // Potions have no tier, Shine, or rolls: those filters pass items only.
    if (q.tier !== null) {
      if (!item) return false;
      if (
        q.tier === "artifact"
          ? !item.artifact
          : item.artifact || item.tier !== q.tier
      ) {
        return false;
      }
    }
    if (q.shiny && !item?.shiny) return false;
    if (q.classId && item && !canEquip(item, q.classId)) return false;
    if (q.rolls.length > 0 && (!item || !hasRolls(item, q.rolls))) return false;
    if (search) {
      const words = [
        listingName(l),
        item?.artifact ? ARTIFACTS[item.artifact].effect : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!words.includes(search)) return false;
    }
    return true;
  });
  const sorted = [...matching].sort((a, b) =>
    q.sort === "cheapest"
      ? a.price - b.price || b.listedAt - a.listedAt
      : q.sort === "dearest"
        ? b.price - a.price || b.listedAt - a.listedAt
        : b.listedAt - a.listedAt || b.id - a.id,
  );
  const start = q.page * EXCHANGE.pageSize;
  return {
    total: matching.length,
    listings: sorted.slice(start, start + EXCHANGE.pageSize),
  };
}
