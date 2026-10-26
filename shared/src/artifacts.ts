import type { DungeonId } from "./dungeons.ts";
import type {
  AbilityItemType,
  ArmorType,
  ItemSlot,
  WeaponType,
} from "./items.ts";
import type { StatKey } from "./stats.ts";

/*
 * Artifacts (Phase 16, D-152, D-153). A separate, rarer kind of item than
 * the tiered ones: always stronger than any tier (T12 power: the tier
 * formulas run two tiers past T10), with 6 random rolls of the usual sizes
 * and rates (T10 has 5), and a special effect on top of its type's normal
 * attack. Only the five endgame dungeons drop them; each has its own.
 */

/** The power an Artifact's base has: two tiers past the best tiered item (D-153). */
export const ARTIFACT_TIER = 12;
/** Random roll slots on an Artifact: one more than a T10's 5 (D-153). */
export const ARTIFACT_ROLLS = 6;

/** Rare-loot rates (D-152), all here and nowhere else. */
export const RARE_LOOT = {
  /** A reward chest in an endgame dungeon holds an Artifact instead. */
  artifactChance: 1 / 500,
  /** Any dropped item, Artifacts included, is Shiny: looks only. */
  shinyChance: 1 / 2000,
} as const;

export interface ArtifactDef {
  /** Its own name, shown instead of "T7 Axe". */
  name: string;
  slot: ItemSlot;
  /** As for tiered items: weapon, armor, or ability item type, or an accessory's base stat. */
  type: WeaponType | ArmorType | AbilityItemType | StatKey;
  /** The endgame dungeon that drops it (D-153). */
  dungeon: DungeonId;
  /** What it does, as approved (D-153); shown on the item. */
  effect: string;
}

export const ARTIFACTS = {
  // Weapons.
  doomrend: {
    name: "Doomrend, the World-Ender",
    slot: "weapon",
    type: "axe",
    dungeon: "abyssal-gauntlet",
    effect:
      "A cleave that hits 2 or more enemies throws a spectral axe from each to one more enemy within 120 px, for 40% damage.",
  },
  excalibur: {
    name: "Excalibur, the Dawn's Judgment",
    slot: "weapon",
    type: "sword",
    dungeon: "dragons-roost",
    effect:
      "Every 5th slash also fires a piercing beam of light 400 px ahead, for 150% damage.",
  },
  whisper: {
    name: "Whisper, the Unseen End",
    slot: "weapon",
    type: "dagger",
    dungeon: "frost-hollow",
    effect:
      "A kill makes your next stab within 2 s deal double damage with 50% more reach.",
  },
  artemis: {
    name: "Artemis, the Moon's Pursuit",
    slot: "weapon",
    type: "bow",
    dungeon: "stormspire",
    effect:
      "Your arrow gains +25% damage for each enemy it pierces, up to +100%.",
  },
  aetherion: {
    name: "Aetherion, the First Spell",
    slot: "weapon",
    type: "staff",
    dungeon: "stormspire",
    effect:
      "Your orb pulls enemies within 120 px together before it bursts, and the burst grows to 60 px.",
  },
  eternity: {
    name: "Eternity, the Unbound Spark",
    slot: "weapon",
    type: "wand",
    dungeon: "clockwork-vault",
    effect:
      "Every 4th bolt splits on hit into 3 seeking bolts, for 40% damage each.",
  },
  golgorr: {
    name: "Golgorr, the Mountain's Wrath",
    slot: "weapon",
    type: "mace",
    dungeon: "abyssal-gauntlet",
    effect: "Every 3rd smash sends a shockwave out to 200 px, for 60% damage.",
  },
  // Armor (worn on the chest).
  mantle: {
    name: "The Mantle of Creation",
    slot: "chest",
    type: "cloth",
    dungeon: "stormspire",
    effect:
      "Casting your ability blocks the next 2 enemy projectiles within 2 s.",
  },
  hide: {
    name: "The Hide of the First Beast",
    slot: "chest",
    type: "leather",
    dungeon: "frost-hollow",
    effect:
      "When an enemy shot just misses you: +30% speed and +50% on your next attack for 1.5 s (once every 4 s).",
  },
  aegisKing: {
    name: "Aegis of the Eternal King",
    slot: "chest",
    type: "plate",
    dungeon: "clockwork-vault",
    effect:
      "Once a run, below 25% HP, a shield soaks up 30% of your max HP for 5 s.",
  },
  // Accessories (their type is their base stat, as for tiered ones).
  ouroboros: {
    name: "The Ouroboros",
    slot: "ring",
    type: "vitality",
    dungeon: "clockwork-vault",
    effect: "Each kill restores 2% of your max HP and 2% of your max MP.",
  },
  resurrection: {
    name: "The Resurrection Necklace",
    slot: "necklace",
    type: "hp",
    dungeon: "dragons-roost",
    effect:
      "When you would die, you survive at 50% HP with 2 s of invulnerability, and the necklace shatters.",
  },
  veil: {
    name: "The Veil Between Worlds",
    slot: "cape",
    type: "speed",
    dungeon: "frost-hollow",
    effect: "After you are hit, you are untouchable for 1 s (once every 10 s).",
  },
  // Class ability items.
  lastStand: {
    name: "Aegis of the Last Stand",
    slot: "ability",
    type: "shield",
    dungeon: "dragons-roost",
    effect:
      "Guard stores the damage it blocks; when it ends, a shockwave deals twice that within 150 px (at most 400).",
  },
  bloodKing: {
    name: "Horn of the Blood King",
    slot: "ability",
    type: "warhorn",
    dungeon: "dragons-roost",
    effect:
      "During Battle Cry each kill restores 3% of your max HP, up to 30% a cry.",
  },
  unseenEnd: {
    name: "Veil of the Unseen End",
    slot: "ability",
    type: "cloak",
    dungeon: "abyssal-gauntlet",
    effect:
      "Vanish leaves a decoy enemies attack instead; when Vanish ends it bursts for 150 damage within 100 px.",
  },
  worldseeker: {
    name: "Quiver of the Worldseeker",
    slot: "ability",
    type: "quiver",
    dungeon: "clockwork-vault",
    effect:
      "A Volley arrow that hits a boss spawns a seeking arrow, for 50% damage.",
  },
  codex: {
    name: "Aetherion's Codex",
    slot: "ability",
    type: "spellbook",
    dungeon: "dragons-roost",
    effect:
      "Arcane Blast pulls enemies just outside it into the middle before it detonates.",
  },
  firstDawn: {
    name: "The Tome of the First Dawn",
    slot: "ability",
    type: "tome",
    dungeon: "frost-hollow",
    effect:
      "Healing also shields each healed player for half the heal (at most 20% of their max HP) for 4 s.",
  },
  worldsong: {
    name: "The Worldsong",
    slot: "ability",
    type: "instrument",
    dungeon: "stormspire",
    effect:
      "Inspiration's pulse destroys up to 6 enemy projectiles within 150 px.",
  },
  testament: {
    name: "The Black Testament",
    slot: "ability",
    type: "grimoire",
    dungeon: "abyssal-gauntlet",
    effect:
      "A cursed enemy that dies drops a fragment: +10 MP, and curses within 150 px last 2 s longer.",
  },
  worldroot: {
    name: "The Worldroot Totem",
    slot: "ability",
    type: "totem",
    dungeon: "frost-hollow",
    effect:
      "Every 3rd Nature's Reach roots the enemies in it for 1.5 s; the next hit on a rooted enemy does +50%.",
  },
  conduit: {
    name: "Eternity's Conduit",
    slot: "ability",
    type: "scepter",
    dungeon: "clockwork-vault",
    effect:
      "The chain's last target leaves an 80 px field for 2 s that zaps enemies walking in for 30% damage, once each.",
  },
} as const satisfies Record<string, ArtifactDef>;

export type ArtifactId = keyof typeof ARTIFACTS;

export const ARTIFACT_IDS = Object.keys(ARTIFACTS) as ArtifactId[];

export function isArtifactId(v: unknown): v is ArtifactId {
  return typeof v === "string" && Object.hasOwn(ARTIFACTS, v);
}

export function artifactDef(id: ArtifactId): ArtifactDef {
  return ARTIFACTS[id];
}

/** The Artifacts this dungeon drops (D-153): none outside the endgame. */
export function artifactsOf(dungeon: DungeonId): ArtifactId[] {
  return ARTIFACT_IDS.filter((id) => ARTIFACTS[id].dungeon === dungeon);
}
