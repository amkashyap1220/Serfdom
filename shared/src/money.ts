/*
 * Money (D-157): one whole number of Bronze behind the scenes, shown as
 * coins, each worth 1,000 of the one below it.
 */

export const COINS = [
  { id: "platinum", name: "Platinum", bronze: 1_000_000_000 },
  { id: "gold", name: "Gold", bronze: 1_000_000 },
  { id: "silver", name: "Silver", bronze: 1_000 },
  { id: "bronze", name: "Bronze", bronze: 1 },
] as const;

export type CoinId = (typeof COINS)[number]["id"];

export const SILVER = 1_000;
export const GOLD = 1_000_000;
export const PLATINUM = 1_000_000_000;

/** How many of each coin make up an amount (all four, largest first). */
export function coinCounts(money: number): Record<CoinId, number> {
  let left = Math.max(0, Math.floor(money));
  const out = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const c of COINS) {
    out[c.id] = Math.floor(left / c.bronze);
    left -= out[c.id] * c.bronze;
  }
  return out;
}

/** The coins to show, largest first, zeros left out; nothing is "0 Bronze". */
export function coinsOf(
  money: number,
): { coin: CoinId; name: string; count: number }[] {
  const counts = coinCounts(money);
  const shown = COINS.filter((c) => counts[c.id] > 0).map((c) => ({
    coin: c.id,
    name: c.name,
    count: counts[c.id],
  }));
  return shown.length > 0
    ? shown
    : [{ coin: "bronze", name: "Bronze", count: 0 }];
}

/** "2 Silver 535 Bronze", "1 Gold 250 Silver", "0 Bronze". */
export function formatMoney(money: number): string {
  return coinsOf(money)
    .map((p) => `${p.count.toLocaleString("en")} ${p.name}`)
    .join(" ");
}

/** An amount in Bronze from coin counts (a price typed in four boxes). */
export function moneyFrom(counts: Partial<Record<CoinId, number>>): number {
  return COINS.reduce((sum, c) => sum + (counts[c.id] ?? 0) * c.bronze, 0);
}
