import { SERF_BASE, zeroStats, type SerfSummary } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { statParts, statText } from "./screens";

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

const ring = (luck: 0 | 1) =>
  ({
    id: 1,
    slot: "ring",
    type: "attack",
    tier: 3,
    rolls: [],
    luck,
    equipped: "ring1",
  }) as SerfSummary["items"][number];

describe("stat lines (D-151): total (+gear)(+potions), zero sources hidden", () => {
  it("shows just the total with neither", () => {
    expect(statText(serf({ attack: 21 }, {}), "attack")).toBe("21");
  });
  it("splits gear and potions; the base is the rest", () => {
    const s = serf({ attack: 22 }, { attack: 1 }, [ring(0)]);
    const { total, gear, potions } = statParts(s, "attack");
    expect(statText(s, "attack")).toBe(`${total} (+${gear}) (+1)`);
    expect(total - gear - potions).toBe(21);
  });
  it("leaves out a source that adds nothing", () => {
    expect(statText(serf({ attack: 22 }, { attack: 1 }), "attack")).toBe(
      "22 (+1)",
    );
  });
  it("shows Luck's gear: 1 plus worn Luck items, never potions", () => {
    expect(statText(serf({}, {}), "luck")).toBe("1");
    expect(statText(serf({}, {}, [ring(1)]), "luck")).toBe("2 (+1)");
  });
});
