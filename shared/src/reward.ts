/**
 * Placeholder completion reward (Phase 6d, T-039). Real rewards (EXP, gold,
 * potions, equipment) and their rates are unconfirmed and arrive in Phase 9;
 * until then the server rolls one number per completing player, so the
 * individual-roll plumbing (D-010) and the chest reveal (D-049) can be built
 * and tested. The number has no meaning and grants nothing.
 */
export interface PlaceholderReward {
  /** 1 ≤ roll ≤ PLACEHOLDER_ROLL_MAX, rolled by the server. */
  roll: number;
}

export const PLACEHOLDER_ROLL_MAX = 1000;

export function isValidRoll(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= PLACEHOLDER_ROLL_MAX
  );
}
