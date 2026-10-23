import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import {
  ARMOR_SLOTS,
  CLASS_GEAR,
  canEquip,
  isValidItemSpec,
  itemBonus,
  itemName,
  armorTypeName,
  maxRoll,
  rollItem,
  rollsFor,
  itemValue,
  sellPrice,
  weaponDamage,
  type ItemSpec,
} from "./items.ts";
import { zeroStats } from "./stats.ts";

/** A seeded generator, so a failure can be reproduced. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const many = (n: number, seed = 7) => {
  const random = seeded(seed);
  return Array.from({ length: n }, () => rollItem("goblin-warrens", random));
};

describe("item generation (D-080, D-083)", () => {
  it("every generated item is valid: rolls per tier, sizes, Luck 0 or +1 (D-067)", () => {
    for (const item of many(20000)) {
      expect(isValidItemSpec(item)).toBe(true);
      expect(item.luck === 0 || item.luck === 1).toBe(true);
      expect(item.rolls).toHaveLength(rollsFor(item.slot, item.tier));
    }
  });

  it("the Goblin Warrens drops T0–T2 at about 50/35/15", () => {
    const items = many(20000);
    const share = (tier: number) =>
      items.filter((i) => i.tier === tier).length / items.length;
    expect(share(0)).toBeCloseTo(0.5, 1);
    expect(share(1)).toBeCloseTo(0.35, 1);
    expect(share(2)).toBeCloseTo(0.15, 1);
    expect(items.every((i) => i.tier <= 2)).toBe(true);
  });

  it("slots come at about 20% weapon, 10% each armor piece, 40% accessories", () => {
    const items = many(20000, 11);
    const share = (slot: string) =>
      items.filter((i) => i.slot === slot).length / items.length;
    expect(share("weapon")).toBeCloseTo(0.2, 1);
    for (const slot of ARMOR_SLOTS) expect(share(slot)).toBeCloseTo(0.1, 1);
    expect(share("ring")).toBeCloseTo(0.15, 1);
  });

  it("about 20% of rolls are negative and about 5% of rolled items carry Luck", () => {
    const items = many(20000, 3);
    const rolls = items.flatMap((i) => i.rolls);
    expect(rolls.filter((r) => r.amount < 0).length / rolls.length).toBeCloseTo(
      0.2,
      1,
    );
    const rolled = items.filter((i) => i.rolls.length > 0);
    expect(
      rolled.filter((i) => i.luck === 1).length / rolled.length,
    ).toBeCloseTo(0.05, 1);
    expect(
      items.filter((i) => i.rolls.length === 0).every((i) => i.luck === 0),
    ).toBe(true);
  });
});

describe("no empty drops (D-084)", () => {
  it("a T0 ring, necklace, or cape has one roll; T0 weapons and armor none", () => {
    expect(
      ["ring", "necklace", "cape"].map((s) => rollsFor(s as "ring", 0)),
    ).toEqual([1, 1, 1]);
    expect(rollsFor("weapon", 0)).toBe(0);
    expect(rollsFor("chest", 0)).toBe(0);
    expect(rollsFor("ring", 1)).toBe(1);
    expect(rollsFor("cape", 10)).toBe(5);
    const accessories = many(20000, 5).filter((i) => i.type === null);
    expect(accessories.length).toBeGreaterThan(0);
    expect(accessories.every((i) => i.rolls.length >= 1)).toBe(true);
  });
});

describe("item validation refuses what the server would never roll", () => {
  const ok: ItemSpec = {
    slot: "ring",
    type: null,
    tier: 1,
    rolls: [{ stat: "attack", amount: 2 }],
    luck: 1,
  };
  it("accepts a real item", () => expect(isValidItemSpec(ok)).toBe(true));
  it.each([
    ["negative Luck", { ...ok, luck: -1 }],
    ["Luck +2", { ...ok, luck: 2 }],
    [
      "Luck with no rolls",
      { slot: "weapon", type: "bow", tier: 0, rolls: [], luck: 1 },
    ],
    ["a T0 accessory with no roll", { ...ok, tier: 0, rolls: [], luck: 0 }],
    ["too many rolls", { ...ok, rolls: [ok.rolls[0]!, ok.rolls[0]!] }],
    ["a roll too big", { ...ok, rolls: [{ stat: "attack", amount: 3 }] }],
    ["a zero roll", { ...ok, rolls: [{ stat: "attack", amount: 0 }] }],
    ["a fractional roll", { ...ok, rolls: [{ stat: "attack", amount: 1.5 }] }],
    ["an unknown stat", { ...ok, rolls: [{ stat: "luck", amount: 1 }] }],
    ["tier 11", { ...ok, tier: 11 }],
    ["a type on a ring", { ...ok, type: "plate" }],
    ["a weapon without a type", { ...ok, slot: "weapon", type: null }],
    ["armor with a weapon type", { ...ok, slot: "chest", type: "bow" }],
  ])("%s", (_name, item) =>
    expect(isValidItemSpec(item as ItemSpec)).toBe(false),
  );
  it("HP and MP rolls may be three times bigger", () => {
    expect(maxRoll("hp", 1)).toBe(6);
    expect(
      isValidItemSpec({ ...ok, rolls: [{ stat: "hp", amount: -6 }] }),
    ).toBe(true);
  });
});

describe("what items give and who may wear them (D-081, D-083)", () => {
  it("weapons: 27 + 4 per tier; no weapon 25", () => {
    expect([
      weaponDamage(null),
      weaponDamage(0),
      weaponDamage(2),
      weaponDamage(10),
    ]).toEqual([25, 27, 35, 67]);
  });

  it("armor base: Plate DEF 1+tier, Leather DEF tier, Cloth MP 2+2×tier, plus rolls", () => {
    const piece = (type: "plate" | "leather" | "cloth"): ItemSpec => ({
      slot: "chest",
      type,
      tier: 2,
      rolls: [],
      luck: 0,
    });
    expect(itemBonus(piece("plate"))).toEqual({ ...zeroStats(), defense: 3 });
    expect(itemBonus(piece("leather"))).toEqual({ ...zeroStats(), defense: 2 });
    expect(itemBonus(piece("cloth"))).toEqual({ ...zeroStats(), mp: 6 });
    expect(
      itemBonus({
        ...piece("plate"),
        rolls: [
          { stat: "defense", amount: -2 },
          { stat: "hp", amount: 4 },
        ],
      }),
    ).toEqual({ ...zeroStats(), defense: 1, hp: 4 });
  });

  it("classes use their weapons and armor; a Serf only T0 weapons/armor; accessories for all", () => {
    const wand: ItemSpec = {
      slot: "weapon",
      type: "wand",
      tier: 1,
      rolls: [{ stat: "attack", amount: 1 }],
      luck: 0,
    };
    const plate: ItemSpec = {
      slot: "legs",
      type: "plate",
      tier: 0,
      rolls: [],
      luck: 0,
    };
    const ring: ItemSpec = {
      slot: "ring",
      type: null,
      tier: 2,
      rolls: [{ stat: "hp", amount: 3 }],
      luck: 0,
    };
    expect(canEquip(wand, "wizard")).toBe(true);
    expect(canEquip(wand, "fighter")).toBe(false);
    expect(canEquip(wand, null)).toBe(false);
    expect(canEquip({ ...wand, tier: 0, rolls: [] }, null)).toBe(true);
    expect(canEquip(plate, "cleric")).toBe(true);
    expect(canEquip(plate, "rogue")).toBe(false);
    expect(canEquip(plate, null)).toBe(true);
    for (const id of [null, ...CLASS_IDS])
      expect(canEquip(ring, id)).toBe(true);
    for (const id of CLASS_IDS)
      expect(CLASS_GEAR[id].weapons.length).toBeGreaterThan(0);
  });

  it("names items plainly; armor by material and slot (D-091)", () => {
    expect(
      itemName({ slot: "weapon", type: "wand", tier: 1, rolls: [], luck: 0 }),
    ).toBe("T1 Wand");
    const armor = (
      type: "cloth" | "leather" | "plate",
      slot: "head" | "chest" | "legs" | "gloves",
    ) => itemName({ slot, type, tier: 2, rolls: [], luck: 0 });
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("cloth", s as "head"),
      ),
    ).toEqual(["T2 Hood", "T2 Robe", "T2 Trousers", "T2 Wraps"]);
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("leather", s as "head"),
      ),
    ).toEqual(["T2 Cap", "T2 Tunic", "T2 Leggings", "T2 Gloves"]);
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("plate", s as "head"),
      ),
    ).toEqual(["T2 Helm", "T2 Breastplate", "T2 Greaves", "T2 Gauntlets"]);
    expect(
      armorTypeName({
        slot: "chest",
        type: "cloth",
        tier: 2,
        rolls: [],
        luck: 0,
      }),
    ).toBe("Cloth");
    expect(
      armorTypeName({
        slot: "weapon",
        type: "bow",
        tier: 2,
        rolls: [],
        luck: 0,
      }),
    ).toBeNull();
    expect(
      itemName({
        slot: "ring",
        type: null,
        tier: 0,
        rolls: [{ stat: "hp", amount: 1 }],
        luck: 0,
      }),
    ).toBe("T0 Ring");
  });
});

describe("item values (D-087, D-090)", () => {
  const at = (tier: number, luck = 0): ItemSpec => ({
    slot: "ring",
    type: null,
    tier,
    rolls: Array.from({ length: rollsFor("ring", tier) }, () => ({
      stat: "hp" as const,
      amount: 1,
    })),
    luck,
  });
  it("sells for half of 5 × (tier + 1)², more with Luck, never under 1", () => {
    expect([0, 1, 2, 5, 10].map((t) => sellPrice(at(t)))).toEqual([
      2, 10, 22, 90, 302,
    ]);
    expect([0, 1, 2, 5, 10].map((t) => sellPrice(at(t, 1)))).toEqual([
      3, 15, 33, 135, 453,
    ]);
    expect(itemValue(at(1))).toBe(20);
    for (let tier = 0; tier <= 10; tier++)
      expect(sellPrice(at(tier))).toBeGreaterThanOrEqual(1);
  });
});
