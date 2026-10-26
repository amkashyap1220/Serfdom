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
    // In Bronze (D-157): 680, 1,360 Silver; the third stash step 510 Silver.
    expect(nextPrice("serfSlots", 0)).toBe(680_000);
    expect(nextPrice("serfSlots", 1)).toBe(1_360_000);
    expect(nextPrice("stash", 2)).toBe(510_000);
    expect(nextPrice("rack", maxBought("rack"))).toBeNull();
    // Everything: 24.48 + 6.12 + 3.4 Gold.
    const total = (kind: (typeof UPGRADE_KINDS)[number]) =>
      Array.from({ length: maxBought(kind) }, (_, n) =>
        nextPrice(kind, n)!,
      ).reduce((a, b) => a + b, 0);
    expect(total("serfSlots")).toBe(24_480_000);
    expect(total("stash")).toBe(6_120_000);
    expect(total("rack")).toBe(3_400_000);
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
