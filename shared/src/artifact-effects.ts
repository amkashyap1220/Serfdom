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

/** The six armor and accessory Artifacts (16c). */
export const GEAR_ARTIFACT = {
  /** Casting the ability blocks the next `blocks` enemy projectiles within `seconds`. */
  mantle: { blocks: 2, seconds: 2 },
  /** An enemy shot passing within `nearMiss` px of you (unhit): faster, and the next attack stronger. */
  hide: { nearMiss: 24, speed: 0.3, strike: 0.5, seconds: 1.5, every: 4 },
  /** Once a run, below `below` of max HP: a shield of `shield` × max HP for `seconds`. */
  aegisKing: { below: 0.25, shield: 0.3, seconds: 5 },
  /** Each kill restores these shares of max HP and max MP. */
  ouroboros: { hp: 0.02, mp: 0.02 },
  /** A death becomes `hp` × max HP and `seconds` of invulnerability; the necklace shatters. */
  resurrection: { hp: 0.5, seconds: 2 },
  /** After a hit: untouchable for `seconds`, at most once every `every` seconds. */
  veil: { seconds: 1, every: 10 },
} as const;
