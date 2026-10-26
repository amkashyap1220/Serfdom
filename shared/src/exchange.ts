import { ARTIFACTS } from "./artifacts.ts";
import type { ClassId } from "./classes.ts";
import { canEquip, itemName, type Item, type ItemSlot } from "./items.ts";
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
  price: number;
  /** The fee the seller paid (0 for a buyer's view of it). */
  fee: number;
  at: number;
  role: "sold" | "bought";
}

export const EXCHANGE_SORTS = ["cheapest", "dearest", "newest"] as const;
export type ExchangeSort = (typeof EXCHANGE_SORTS)[number];

export interface ExchangeQuery {
  /** An item slot, "potion", or null for everything. */
  slot: ItemSlot | "potion" | null;
  minTier: number;
  maxTier: number;
  artifacts: boolean;
  shiny: boolean;
  /** Only what this class can wear (potions always pass). */
  usableBy: ClassId | null;
  /** Part of the name, any case. */
  search: string;
  sort: ExchangeSort;
  /** 0-based. */
  page: number;
}

export const ANY_LISTING: ExchangeQuery = {
  slot: null,
  minTier: 0,
  maxTier: 12,
  artifacts: false,
  shiny: false,
  usableBy: null,
  search: "",
  sort: "newest",
  page: 0,
};

/** A listing's name, as shown and searched. */
export function listingName(l: Pick<Listing, "item" | "potion">): string {
  if (l.item) return itemName(l.item);
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
    if (item && (item.tier < q.minTier || item.tier > q.maxTier)) return false;
    if (q.artifacts && !item?.artifact) return false;
    if (q.shiny && !item?.shiny) return false;
    if (q.usableBy && item && !canEquip(item, q.usableBy)) return false;
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
