import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import {
  itemFullName,
  tierLabel,
  ARMOR_SLOTS,
  CLASS_GEAR,
  canEquip,
  isValidItemSpec,
  itemBonus,
  itemName,
  armorTypeName,
  abilityItemClass,
  CLASS_ABILITY_ITEM,
  accessoryBase,
  LOOT_POOLS,
  maxRoll,
  rollFromPool,
  rollItem,
  rollsFor,
  itemValue,
  sellPrice,
  weaponDamage,
  type ItemSpec,
  compareItems,
  loadoutOf,
  slotsFor,
  type EquipSlot,
  type Item,
} from "./items.ts";
import { combatFor, SERF_BASE, zeroStats } from "./stats.ts";

/** A seeded generator, so a failure can be reproduced. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Items from T4 and up, where extra rolls begin (D-106). */
const manyHigh = (n: number, seed = 7) => {
  const random = seeded(seed);
  const pool = {
    tiers: [
      [4, 1],
      [7, 1],
      [10, 1],
    ] as const,
    slots: LOOT_POOLS["goblin-warrens"].slots,
  };
  return Array.from({ length: n }, () => rollFromPool(pool, random));
};

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

  it("slots: ability 10%, then weapon 18%, armor 9% each, ring 13.5% (D-096)", () => {
    const items = many(40000, 11);
    const share = (slot: string) =>
      items.filter((i) => i.slot === slot).length / items.length;
    expect(Math.abs(share("ability") - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(share("weapon") - 0.18)).toBeLessThan(0.01);
    for (const slot of ARMOR_SLOTS) {
      expect(Math.abs(share(slot) - 0.09)).toBeLessThan(0.01);
    }
    expect(Math.abs(share("ring") - 0.135)).toBeLessThan(0.01);
  });

  it("about 20% of rolls are negative and about 5% of rolled items carry Luck", () => {
    const items = manyHigh(20000, 3);
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

describe("base stats and extra rolls (D-106)", () => {
  it("no item has extra rolls before T4; then 2, 3, 3, 4, 4, 5, 5", () => {
    for (const slot of [
      "weapon",
      "ability",
      "chest",
      "ring",
      "necklace",
      "cape",
    ] as const) {
      expect(
        Array.from({ length: 11 }, (_, t) => rollsFor(slot, t)),
        slot,
      ).toEqual([0, 0, 0, 0, 2, 3, 3, 4, 4, 5, 5]);
    }
    expect(many(20000, 5).every((i) => i.rolls.length === 0)).toBe(true);
  });

  it("an accessory's base is tier + 1, x3 for HP and MP: more every tier", () => {
    expect(
      Array.from({ length: 11 }, (_, t) => accessoryBase("defense", t)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(accessoryBase("hp", 0)).toBe(3);
    expect(accessoryBase("mp", 10)).toBe(33);
  });

  it("extra rolls are at most +3 (+9 HP and MP) and always below the base", () => {
    expect(maxRoll("speed")).toBe(3);
    expect(maxRoll("hp")).toBe(9);
    for (const stat of ["hp", "attack"] as const) {
      expect(accessoryBase(stat, 4)).toBeGreaterThan(maxRoll(stat));
    }
  });

  it("rings, necklaces, and capes all get a base stat (never Luck) and never roll it", () => {
    const accessories = [...many(20000, 5), ...manyHigh(20000, 9)].filter((i) =>
      ["ring", "necklace", "cape"].includes(i.slot),
    );
    expect(new Set(accessories.map((i) => i.slot)).size).toBe(3);
    expect(new Set(accessories.map((i) => i.type)).size).toBe(8);
    for (const item of accessories) {
      expect(item.rolls.some((r) => r.stat === item.type)).toBe(false);
      expect(isValidItemSpec(item)).toBe(true);
    }
    for (const item of manyHigh(5000, 11)) {
      expect(isValidItemSpec(item)).toBe(true);
    }
  });

  it("a T5 Ring of Defense gives +6 DEF, plus its rolls", () => {
    const ring: ItemSpec = {
      slot: "ring",
      type: "defense",
      tier: 5,
      rolls: [
        { stat: "speed", amount: 3 },
        { stat: "hp", amount: -4 },
        { stat: "wisdom", amount: 1 },
      ],
      luck: 0,
    };
    expect(itemName(ring)).toBe("Ring of Defense");
    expect(itemFullName(ring)).toBe("Ring of Defense (Tier 5)");
    expect(tierLabel(ring)).toBe("Tier 5");
    expect(itemBonus(ring)).toMatchObject({
      defense: 6,
      speed: 3,
      hp: -4,
      wisdom: 1,
    });
    expect(
      itemName({ ...ring, slot: "cape", type: "hp", tier: 0, rolls: [] }),
    ).toBe("Cape of HP");
    expect(
      itemBonus({ ...ring, slot: "necklace", type: "mp", rolls: [] }).mp,
    ).toBe(18);
  });
});

describe("item validation refuses what the server would never roll", () => {
  const ok: ItemSpec = {
    slot: "ring",
    type: "defense",
    tier: 4,
    rolls: [
      { stat: "attack", amount: 2 },
      { stat: "speed", amount: -1 },
    ],
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
    ["too many rolls", { ...ok, rolls: [...ok.rolls, ok.rolls[0]!] }],
    ["a roll below T4", { ...ok, tier: 3 }],
    [
      "a roll above +3",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "attack", amount: 4 }] },
    ],
    [
      "an HP roll above +9",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "hp", amount: 10 }] },
    ],
    [
      "a zero roll",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "attack", amount: 0 }] },
    ],
    [
      "a fractional roll",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "attack", amount: 1.5 }] },
    ],
    [
      "an unknown stat",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "luck", amount: 1 }] },
    ],
    [
      "a ring rolling its own base stat",
      { ...ok, rolls: [ok.rolls[1]!, { stat: "defense", amount: 2 }] },
    ],
    ["tier 11", { ...ok, tier: 11 }],
    ["a ring with no base stat", { ...ok, type: null }],
    ["a Ring of Luck", { ...ok, type: "luck" }],
    ["a type on a ring", { ...ok, type: "plate" }],
    ["a weapon without a type", { ...ok, slot: "weapon", type: null }],
    ["armor with a weapon type", { ...ok, slot: "chest", type: "bow" }],
  ])("%s", (_name, item) =>
    expect(isValidItemSpec(item as ItemSpec)).toBe(false),
  );
  it("HP and MP rolls may be three times bigger", () => {
    expect(maxRoll("hp")).toBe(9);
    expect(
      isValidItemSpec({
        ...ok,
        rolls: [ok.rolls[1]!, { stat: "hp", amount: -9 }],
      }),
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
      type: "hp",
      tier: 2,
      rolls: [],
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
    ).toBe("Wand");
    const armor = (
      type: "cloth" | "leather" | "plate",
      slot: "head" | "chest" | "legs" | "gloves",
    ) => itemName({ slot, type, tier: 2, rolls: [], luck: 0 });
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("cloth", s as "head"),
      ),
    ).toEqual(["Hood", "Robe", "Trousers", "Wraps"]);
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("leather", s as "head"),
      ),
    ).toEqual(["Cap", "Tunic", "Leggings", "Gloves"]);
    expect(
      ["head", "chest", "legs", "gloves"].map((s) =>
        armor("plate", s as "head"),
      ),
    ).toEqual(["Helm", "Breastplate", "Greaves", "Gauntlets"]);
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
        type: "hp",
        tier: 0,
        rolls: [],
        luck: 0,
      }),
    ).toBe("Ring of HP");
  });
});

describe("item values (D-087, D-090)", () => {
  const at = (tier: number, luck = 0): ItemSpec => ({
    slot: "ring",
    type: "defense",
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

describe("gear on a serf (9b, D-083, T-048)", () => {
  const worn = (spec: ItemSpec, slot: EquipSlot): Item => ({
    ...spec,
    id: 1,
    equipped: slot,
  });
  const plate: ItemSpec = {
    slot: "chest",
    type: "plate",
    tier: 2,
    rolls: [{ stat: "speed", amount: -2 }],
    luck: 0,
  };
  const bow: ItemSpec = {
    slot: "weapon",
    type: "bow",
    tier: 2,
    rolls: [{ stat: "attack", amount: 3 }],
    luck: 1,
  };

  it("adds worn gear to the serf's stats and takes the weapon's tier; the stash does not count", () => {
    const serf = {
      stats: { ...SERF_BASE },
      items: [
        worn(plate, "chest"),
        worn(bow, "weapon"),
        { ...bow, id: 9, equipped: null },
      ],
    };
    const l = loadoutOf(serf);
    expect(l.stats).toEqual({ ...SERF_BASE, defense: 3, speed: 8, attack: 13 });
    expect(l.weaponTier).toBe(2);
    expect(loadoutOf({ stats: SERF_BASE, items: [] })).toEqual({
      stats: SERF_BASE,
      weaponTier: null,
      weaponType: null,
      ability: null,
    });
  });

  it("negative rolls never take a stat below 0, or HP below 1", () => {
    const awful: ItemSpec = {
      slot: "ring",
      type: null,
      tier: 9,
      rolls: [
        { stat: "defense", amount: -10 },
        { stat: "hp", amount: -30 },
        { stat: "speed", amount: -10 },
        { stat: "mp", amount: -30 },
        { stat: "wisdom", amount: -10 },
      ],
      luck: 0,
    };
    const l = loadoutOf({ stats: SERF_BASE, items: [worn(awful, "ring1")] });
    expect(l.stats.defense).toBe(0);
    expect(l.stats.hp).toBe(1);
    expect(l.stats.speed).toBe(0);
  });

  it("the weapon sets shot damage: no weapon 25, a T2 bow 35 (at ATK 10)", () => {
    expect(combatFor(SERF_BASE).shotDamage).toBe(25);
    expect(combatFor(SERF_BASE, weaponDamage(2)).shotDamage).toBe(35);
  });

  it("rings fit either ring slot; everything else its own", () => {
    expect(slotsFor("ring")).toEqual(["ring1", "ring2"]);
    expect(slotsFor("cape")).toEqual(["cape"]);
    expect(slotsFor("weapon")).toEqual(["weapon"]);
  });

  it("compares a new item with what is worn: per stat up and down", () => {
    const cloth: ItemSpec = {
      slot: "chest",
      type: "cloth",
      tier: 1,
      rolls: [{ stat: "wisdom", amount: 2 }],
      luck: 0,
    };
    expect(compareItems(cloth, plate)).toEqual({
      ...zeroStats(),
      defense: -3,
      speed: 2,
      mp: 4,
      wisdom: 2,
    });
    expect(compareItems(cloth, null)).toEqual({
      ...zeroStats(),
      mp: 4,
      wisdom: 2,
    });
  });
});

describe("ability items (D-092, D-096)", () => {
  const book: ItemSpec = {
    slot: "ability",
    type: "spellbook",
    tier: 0,
    rolls: [],
    luck: 0,
  };
  it("only their own class can wear them; never a classless Serf", () => {
    expect(canEquip(book, "wizard")).toBe(true);
    expect(canEquip(book, "sorcerer")).toBe(false);
    expect(canEquip(book, null)).toBe(false);
    for (const id of CLASS_IDS) {
      expect(canEquip({ ...book, type: CLASS_ABILITY_ITEM[id] }, id)).toBe(
        true,
      );
    }
  });
  it("are named after GDD §4 and roll like weapons (none before T4)", () => {
    expect(itemName(book)).toBe("Spellbook");
    expect(itemName({ ...book, type: "warhorn" })).toBe("War Horn");
    expect(abilityItemClass({ ...book, type: "totem" })).toBe("druid");
    expect(rollsFor("ability", 0)).toBe(0);
    expect(rollsFor("ability", 3)).toBe(0);
    expect(rollsFor("ability", 4)).toBe(2);
    expect(isValidItemSpec(book)).toBe(true);
    expect(isValidItemSpec({ ...book, type: "wand" })).toBe(false);
    expect(isValidItemSpec({ ...book, type: null })).toBe(false);
  });
  it("drop for every class and only go in the ability slot", () => {
    const books = many(40000, 13).filter((i) => i.slot === "ability");
    expect(new Set(books.map((b) => b.type)).size).toBe(10);
    expect(slotsFor("ability")).toEqual(["ability"]);
  });
});
