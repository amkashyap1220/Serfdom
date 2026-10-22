/**
 * Subtracts damage from HP, never going below 0. Shared by players and
 * enemies so both follow exactly the same rule.
 */
export function applyDamage(
  hp: number,
  damage: number,
): { hp: number; died: boolean } {
  if (!(damage >= 0) || !Number.isFinite(damage)) {
    throw new RangeError(`damage must be finite and >= 0, got ${damage}`);
  }
  if (hp <= 0) return { hp: 0, died: false };
  const next = Math.max(hp - damage, 0);
  return { hp: next, died: next === 0 };
}
