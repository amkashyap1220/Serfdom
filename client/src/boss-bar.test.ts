import { describe, expect, it } from "vitest";
import { WARCHIEF, WARLORD } from "@serfdom/shared";
import { bossBar } from "./boss-bar";

describe("boss bar (D-117)", () => {
  it("is shown only for bosses", () => {
    expect(bossBar("grunt", 10, 10)).toBeUndefined();
    expect(bossBar("brute", 10, 10)).toBeUndefined();
  });

  it("the Warlord turns ENRAGED below its phase-2 line", () => {
    const max = WARLORD.maxHp;
    expect(bossBar("warlord", max, max)).toMatchObject({
      name: "Goblin Warlord",
      notches: [WARLORD.phaseTwoBelow],
      angry: false,
      suffix: "",
    });
    expect(bossBar("warlord", max * 0.3, max)).toMatchObject({
      angry: true,
      suffix: "  — ENRAGED",
    });
  });

  it("the Warchief shows both phase lines and names each phase", () => {
    const max = WARCHIEF.maxHp;
    expect(bossBar("warchief", max, max)).toEqual({
      name: "Goblin Warchief",
      notches: [0.66, 0.33],
      angry: false,
      suffix: "",
    });
    expect(bossBar("warchief", max * 0.5, max)).toMatchObject({
      angry: true,
      suffix: "  — WAR CRY",
    });
    expect(bossBar("warchief", max * 0.2, max)).toMatchObject({
      angry: true,
      suffix: "  — ENRAGED",
    });
  });
});
