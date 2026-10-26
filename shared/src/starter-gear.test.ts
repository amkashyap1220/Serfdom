import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import { canEquip, isValidItemSpec, LOOT_POOLS, rollItem } from "./items.ts";
import {
  classSet,
  FREE_TIER0,
  freeTier0,
  isFreeTier0,
  STARTER_GEAR,
} from "./starter-gear.ts";

describe("Tier 0 starter gear (D-157)", () => {
  it("a new serf wears a Sword and leather armor it can use", () => {
    expect(STARTER_GEAR.map((w) => `${w.slot}:${w.item.type}`)).toEqual([
      "weapon:sword",
      "head:leather",
      "chest:leather",
      "legs:leather",
      "gloves:leather",
    ]);
    for (const w of STARTER_GEAR) {
      expect(isValidItemSpec(w.item)).toBe(true);
      expect(canEquip(w.item, null)).toBe(true);
    }
  });

  it("each class's set is its first weapon, its armor, its ability item, all usable", () => {
    expect(classSet("wizard").map((w) => w.item.type)).toEqual([
      "staff",
      "cloth",
      "cloth",
      "cloth",
      "cloth",
      "spellbook",
    ]);
    for (const id of CLASS_IDS) {
      for (const w of classSet(id)) {
        expect(w.item.tier).toBe(0);
        expect(isValidItemSpec(w.item), `${id} ${w.slot}`).toBe(true);
        expect(canEquip(w.item, id), `${id} ${w.slot}`).toBe(true);
      }
    }
  });

  it("every Tier 0 kind is free, valid, and found by slot and type", () => {
    expect(FREE_TIER0.every(isValidItemSpec)).toBe(true);
    expect(FREE_TIER0.every((i) => i.tier === 0 && !i.shiny)).toBe(true);
    expect(freeTier0("cape", "hp")).toMatchObject({ slot: "cape", type: "hp" });
    expect(freeTier0("weapon", "lance")).toBeNull();
    expect(isFreeTier0({ tier: 0 })).toBe(true);
    expect(isFreeTier0({ tier: 1 })).toBe(false);
  });

  it("no dungeon drops Tier 0", () => {
    for (const [id, pool] of Object.entries(LOOT_POOLS)) {
      expect(
        pool.tiers.every(([t]) => t > 0),
        id,
      ).toBe(true);
    }
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      expect(rollItem("goblin-warrens", next).tier).toBeGreaterThan(0);
    }
  });
});
