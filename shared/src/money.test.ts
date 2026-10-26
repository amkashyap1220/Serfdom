import { describe, expect, it } from "vitest";
import { coinCounts, formatMoney, moneyFrom, PLATINUM } from "./money.ts";

describe("money (D-157)", () => {
  it("shows the non-zero coins, largest first; nothing is 0 Bronze", () => {
    expect(formatMoney(0)).toBe("0 Bronze");
    expect(formatMoney(535)).toBe("535 Bronze");
    expect(formatMoney(2535)).toBe("2 Silver 535 Bronze");
    expect(formatMoney(1_250_000)).toBe("1 Gold 250 Silver");
    expect(formatMoney(PLATINUM + 5)).toBe("1 Platinum 5 Bronze");
    expect(formatMoney(3_000 * PLATINUM)).toBe("3,000 Platinum");
  });

  it("splits into four coins and adds them back", () => {
    const n = 7_004_030_201;
    const c = coinCounts(n);
    expect(c).toEqual({ platinum: 7, gold: 4, silver: 30, bronze: 201 });
    expect(moneyFrom(c)).toBe(n);
    expect(moneyFrom({ silver: 170 })).toBe(170_000);
  });
});
