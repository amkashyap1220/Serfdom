import { describe, expect, it } from "vitest";
import {
  ANY_LISTING,
  EXCHANGE,
  exchangeFee,
  filterListings,
  isValidPrice,
  type Listing,
} from "./exchange.ts";
import { rollArtifact, type Item } from "./items.ts";

const item = (over: Partial<Item>): Item => ({
  id: 1,
  slot: "weapon",
  type: "sword",
  tier: 5,
  rolls: [],
  luck: 0,
  equipped: null,
  ...over,
});

let n = 0;
const listing = (over: Partial<Listing>): Listing => ({
  id: ++n,
  price: 100,
  listedAt: n,
  item: item({}),
  potion: null,
  mine: false,
  ...over,
});

describe("the Exchange's rules (D-155)", () => {
  it("the seller pays 5%, rounded down; prices are whole, 1 to 1,000,000", () => {
    expect(exchangeFee(100)).toBe(5);
    expect(exchangeFee(19)).toBe(0);
    expect(exchangeFee(1_000_000)).toBe(50_000);
    expect(isValidPrice(1)).toBe(true);
    expect(isValidPrice(EXCHANGE.maxPrice)).toBe(true);
    for (const bad of [0, -5, 1.5, EXCHANGE.maxPrice + 1, "100", NaN]) {
      expect(isValidPrice(bad), String(bad)).toBe(false);
    }
  });

  it("filters by slot, tier, Artifact, Shiny, class, and name", () => {
    const sword = listing({ item: item({ tier: 3 }) });
    const ring = listing({
      item: item({ slot: "ring", type: "attack", tier: 9, shiny: true }),
    });
    const axe = listing({
      item: { ...rollArtifact("doomrend", () => 0.5), id: 3, equipped: null },
    });
    const potion = listing({ item: null, potion: { id: 9, stat: "hp" } });
    const all = [sword, ring, axe, potion];
    const ids = (q: Partial<typeof ANY_LISTING>) =>
      filterListings(all, { ...ANY_LISTING, ...q }).listings.map((l) => l.id);
    expect(ids({ slot: "weapon" }).sort()).toEqual([sword.id, axe.id].sort());
    expect(ids({ slot: "potion" })).toEqual([potion.id]);
    expect(ids({ minTier: 5, maxTier: 10 })).toEqual(
      expect.arrayContaining([ring.id, potion.id]),
    );
    expect(ids({ artifacts: true })).toEqual([axe.id]);
    expect(ids({ shiny: true })).toEqual([ring.id]);
    // A Wizard cannot wear a sword or an axe.
    expect(ids({ usableBy: "wizard" }).sort()).toEqual(
      [ring.id, potion.id].sort(),
    );
    expect(ids({ search: "DOOMREND" })).toEqual([axe.id]);
    expect(ids({ search: "potion of health" })).toEqual([potion.id]);
  });

  it("sorts by price or newest, 20 a page, and counts every match", () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      listing({ price: 1000 - i }),
    );
    const first = filterListings(many, { ...ANY_LISTING, sort: "cheapest" });
    expect(first.total).toBe(45);
    expect(first.listings).toHaveLength(EXCHANGE.pageSize);
    expect(first.listings[0]!.price).toBe(956);
    const last = filterListings(many, {
      ...ANY_LISTING,
      sort: "dearest",
      page: 2,
    });
    expect(last.listings).toHaveLength(5);
    expect(last.listings.at(-1)!.price).toBe(956);
    const newest = filterListings(many, ANY_LISTING).listings[0]!;
    expect(newest.listedAt).toBe(Math.max(...many.map((l) => l.listedAt)));
  });
});
