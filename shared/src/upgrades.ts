/*
 * Account upgrades bought with gold (D-154, approved by the user
 * 2026-10-26; numbers tunable). They belong to the account, so a serf's
 * death never loses them. Each purchase adds `step` to its capacity and
 * costs `price` × the purchase's number (the 1st, the 2nd, …), up to `max`.
 */

export const UPGRADES = {
  /** Living serfs at once: 2 free, up to 10 (one per class). */
  serfSlots: { name: "Serf slot", base: 2, step: 1, max: 10, price: 2000 },
  /** The shared stash: 20 free, up to 100. */
  stash: { name: "Stash space", base: 20, step: 10, max: 100, price: 500 },
  /** The potion rack: 20 free, up to 60. */
  rack: { name: "Potion rack space", base: 20, step: 10, max: 60, price: 1000 },
} as const;

export type UpgradeKind = keyof typeof UPGRADES;

export const UPGRADE_KINDS = Object.keys(UPGRADES) as UpgradeKind[];

export function isUpgradeKind(v: unknown): v is UpgradeKind {
  return typeof v === "string" && Object.hasOwn(UPGRADES, v);
}

/** How many of each an account has bought. */
export type Upgrades = Record<UpgradeKind, number>;

export const NO_UPGRADES: Upgrades = { serfSlots: 0, stash: 0, rack: 0 };

/** The most of this upgrade an account can buy. */
export function maxBought(kind: UpgradeKind): number {
  const u = UPGRADES[kind];
  return (u.max - u.base) / u.step;
}

/** The capacity after `bought` purchases. */
export function capacityOf(kind: UpgradeKind, bought: number): number {
  const u = UPGRADES[kind];
  return u.base + u.step * bought;
}

/** Purchases behind a capacity (what the client sees). */
export function boughtFor(kind: UpgradeKind, capacity: number): number {
  const u = UPGRADES[kind];
  return Math.max(0, Math.round((capacity - u.base) / u.step));
}

/** The next purchase's price, or null once at the max. */
export function nextPrice(kind: UpgradeKind, bought: number): number | null {
  return bought >= maxBought(kind) ? null : UPGRADES[kind].price * (bought + 1);
}
