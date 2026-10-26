import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import { canEquip, isAccessorySlot } from "./items.ts";
import { FREE_TIER0 } from "./starter-gear.ts";
import {
  ANY_LISTING,
  EXCHANGE,
  exchangeFee,
  filterListings,
  isValidPrice,
  type Listing,
  usableKinds,
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

  it("filters by slot, type, tier, Shiny, class, and rolls (D-156)", () => {
    const sword = listing({
      item: item({ tier: 3, rolls: [] }),
    });
    const ring = listing({
      item: item({
        slot: "ring",
        type: "attack",
        tier: 9,
        shiny: true,
        rolls: [
          { stat: "dexterity", amount: 2 },
          { stat: "hp", amount: -3 },
          { stat: "speed", amount: 1 },
          { stat: "vitality", amount: 1 },
        ],
        luck: 1,
      }),
    });
    const axe = listing({
      item: { ...rollArtifact("doomrend", () => 0.5), id: 3, equipped: null },
    });
    const potion = listing({ item: null, potion: { id: 9, stat: "hp" } });
    const all = [sword, ring, axe, potion];
    const ids = (q: Partial<typeof ANY_LISTING>) =>
      filterListings(all, { ...ANY_LISTING, ...q }).listings.map((l) => l.id);
    expect(ids({ slot: "weapon" }).sort()).toEqual([sword.id, axe.id].sort());
    expect(ids({ slot: "weapon", type: "axe" })).toEqual([axe.id]);
    expect(ids({ slot: "potion" })).toEqual([potion.id]);
    expect(ids({ tier: 3 })).toEqual([sword.id]);
    expect(ids({ tier: 9 })).toEqual([ring.id]);
    expect(ids({ tier: 4 })).toEqual([]);
    // Artifacts are their own choice, not a tier (they are T12 inside).
    expect(ids({ tier: "artifact" })).toEqual([axe.id]);
    expect(ids({ shiny: true })).toEqual([ring.id]);
    // A Wizard cannot wear a sword or an axe.
    expect(ids({ classId: "wizard" }).sort()).toEqual(
      [ring.id, potion.id].sort(),
    );
    // Rolls: all of them, positive only; a -3 HP roll does not count.
    expect(ids({ rolls: ["dexterity", "luck"] })).toEqual([ring.id]);
    expect(ids({ rolls: ["hp"] }).includes(ring.id)).toBe(false);
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
    expect(ANY_LISTING.sort).toBe("cheapest");
    const newest = filterListings(many, { ...ANY_LISTING, sort: "newest" })
      .listings[0]!;
    expect(newest.listedAt).toBe(Math.max(...many.map((l) => l.listedAt)));
  });
});

describe("the class filter as kinds (for the database)", () => {
  it("matches canEquip for every class, item kind, and tier", () => {
    for (const classId of CLASS_IDS) {
      const kinds = usableKinds(classId);
      for (const kind of FREE_TIER0) {
        for (const tier of [1, 7]) {
          const item = { ...kind, tier };
          const listed =
            isAccessorySlot(item.slot) ||
            kinds.some((k) => k.slot === item.slot && k.type === item.type);
          expect(listed, `${classId} ${item.slot} ${item.type}`).toBe(
            canEquip(item, classId),
          );
        }
      }
    }
  });
});
