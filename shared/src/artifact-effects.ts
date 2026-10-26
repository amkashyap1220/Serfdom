import type { ArtifactId } from "./artifacts.ts";

/*
 * What the Artifacts do (D-153), as numbers in one place. Each works on
 * top of its type's normal attack (D-141). The server decides every
 * effect: their extra projectiles are drawn from snapshots (like Volley's),
 * so a client's own prediction is never involved.
 */

/** The seven weapon Artifacts (16b). Damage shares are of the attack's own damage. */
export const WEAPON_ARTIFACT = {
  /** A cleave hitting `minHits`+ throws an axe from each to one more enemy. */
  doomrend: { minHits: 2, range: 120, damage: 0.4 },
  /** Every `every`th slash fires a piercing beam of light. */
  excalibur: { every: 5, range: 400, speed: 900, size: 14, damage: 1.5 },
  /** A kill empowers the next stab within `seconds`. */
  whisper: { seconds: 2, damage: 2, reach: 1.5 },
  /** Each enemy pierced adds `perPierce` damage, up to `max` more. */
  artemis: { perPierce: 0.25, max: 1 },
  /** The orb pulls enemies within `pull` together, then bursts `burst` wide. */
  aetherion: { pull: 120, burst: 60 },
  /** Every `every`th bolt splits on hit into `bolts` seeking bolts. */
  eternity: {
    every: 4,
    bolts: 3,
    damage: 0.4,
    range: 300,
    speed: 500,
    size: 4,
  },
  /** Every `every`th smash sends a shockwave out to `radius`. */
  golgorr: { every: 3, radius: 200, damage: 0.6 },
} as const;

/** Whether this player wears this Artifact (the same one twice counts once, D-153). */
export function wears(
  player: { artifacts?: readonly ArtifactId[] },
  id: ArtifactId,
): boolean {
  return player.artifacts?.includes(id) ?? false;
}
