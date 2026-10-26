import { SERF_BASE, zeroStats, type SerfSummary } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { statText } from "./screens";

/** A serf with these stats, potion tally, and worn items. */
const serf = (
  stats: Partial<SerfSummary["stats"]>,
  potions: Partial<SerfSummary["stats"]>,
  items: SerfSummary["items"] = [],
): SerfSummary =>
  ({
    stats: { ...SERF_BASE, ...stats },
    potionStats: { ...zeroStats(), ...potions },
    items,
    classId: "fighter",
  }) as SerfSummary;

const ring = {
  id: 1,
  slot: "ring",
  type: "attack",
  tier: 3,
  rolls: [],
  luck: 0,
  equipped: "ring1",
} as SerfSummary["items"][number];

describe("stat lines (D-151): total (+gear)(+potions)", () => {
  it("shows just the total with neither", () => {
    expect(statText(serf({ attack: 21 }, {}), "attack")).toBe("21");
  });
  it("splits gear and potions; the base is the rest", () => {
    const s = serf({ attack: 22 }, { attack: 1 }, [ring]);
    const text = statText(s, "attack");
    const m = text.match(/^(\d+) \(\+(\d+)\)\(\+1\)$/);
    expect(m, text).not.toBeNull();
    // Total minus gear minus potions is the base: 21.
    expect(Number(m![1]) - Number(m![2]) - 1).toBe(21);
  });
  it("keeps both brackets when only one is non-zero, so their places never move", () => {
    expect(statText(serf({ attack: 22 }, { attack: 1 }), "attack")).toBe(
      "22 (+0)(+1)",
    );
  });
});
