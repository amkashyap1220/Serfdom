import { describe, expect, it } from "vitest";
import {
  boughtFor,
  capacityOf,
  maxBought,
  nextPrice,
  UPGRADE_KINDS,
  UPGRADES,
} from "./upgrades.ts";

describe("account upgrades (D-154)", () => {
  it("serf slots 2 to 10, stash 20 to 100, rack 20 to 60", () => {
    expect(capacityOf("serfSlots", 0)).toBe(2);
    expect(capacityOf("serfSlots", maxBought("serfSlots"))).toBe(10);
    expect(capacityOf("stash", maxBought("stash"))).toBe(100);
    expect(capacityOf("rack", maxBought("rack"))).toBe(60);
  });

  it("each purchase costs its price times its number; none past the max", () => {
    expect(nextPrice("serfSlots", 0)).toBe(2000);
    expect(nextPrice("serfSlots", 1)).toBe(4000);
    expect(nextPrice("stash", 2)).toBe(1500);
    expect(nextPrice("rack", maxBought("rack"))).toBeNull();
    // Everything: 72,000 + 18,000 + 10,000 gold, as drafted.
    const total = (kind: (typeof UPGRADE_KINDS)[number]) =>
      Array.from({ length: maxBought(kind) }, (_, n) =>
        nextPrice(kind, n)!,
      ).reduce((a, b) => a + b, 0);
    expect(total("serfSlots")).toBe(72000);
    expect(total("stash")).toBe(18000);
    expect(total("rack")).toBe(10000);
  });

  it("the client reads purchases back from capacities", () => {
    for (const kind of UPGRADE_KINDS) {
      for (let n = 0; n <= maxBought(kind); n++) {
        expect(boughtFor(kind, capacityOf(kind, n))).toBe(n);
      }
      expect(UPGRADES[kind].price).toBeGreaterThan(0);
    }
  });
});
