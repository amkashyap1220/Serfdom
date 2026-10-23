/**
 * Enemy HP scaling by party size (D-045, PROVISIONAL; the user may change it).
 *
 *   maxHp = base × (1 + 0.75 × (players − 1))  →  1×, 1.75×, 2.5×, 3.25×
 *
 * Each extra player adds less than a full solo's worth of HP: groups split
 * attention between dodging and shooting, and solo play must stay viable.
 */
export const EXTRA_PLAYER_HP_FACTOR = 0.75;

export function partyHpMultiplier(players: number): number {
  const n = Math.max(1, Math.floor(players));
  return 1 + EXTRA_PLAYER_HP_FACTOR * (n - 1);
}

export function scaledMaxHp(baseMaxHp: number, players: number): number {
  return Math.round(baseMaxHp * partyHpMultiplier(players));
}

/**
 * New current HP when max HP changes, keeping the same fraction so a player
 * joining or leaving never heals the enemy or hands out a free kill.
 * A living enemy stays at ≥ 1 HP; a defeated one stays at 0.
 */
export function rescaleHp(hp: number, oldMax: number, newMax: number): number {
  if (hp <= 0) return 0;
  if (oldMax <= 0) return newMax;
  return Math.min(newMax, Math.max(1, Math.round((hp / oldMax) * newMax)));
}
