import { CLASS_CHOICE_LEVEL } from "./progression.ts";

/**
 * The 10 launch classes (D-072), picked permanently at level 5 (D-073).
 * Ability items and concepts are the GDD §4 design direction; abilities do
 * nothing yet (Phase 10), and class stat growth is still open (8c).
 */
export const CLASS_IDS = [
  "fighter",
  "barbarian",
  "rogue",
  "ranger",
  "wizard",
  "cleric",
  "bard",
  "warlock",
  "druid",
  "sorcerer",
] as const;

export type ClassId = (typeof CLASS_IDS)[number];

export interface ClassInfo {
  id: ClassId;
  name: string;
  /** The class-specific active ability item (GDD §4). */
  abilityItem: string;
  ability: string;
  /** One line for the class picker. */
  concept: string;
}

export const CLASSES: Record<ClassId, ClassInfo> = {
  fighter: {
    id: "fighter",
    name: "Fighter",
    abilityItem: "Shield",
    ability: "Guard",
    concept: "Briefly reduce incoming damage or make a defensive bash.",
  },
  barbarian: {
    id: "barbarian",
    name: "Barbarian",
    abilityItem: "War Horn",
    ability: "Battle Cry",
    concept: "Temporarily increase attack power.",
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    abilityItem: "Cloak",
    ability: "Vanish",
    concept: "Disrupt enemy targeting and become evasive.",
  },
  ranger: {
    id: "ranger",
    name: "Ranger",
    abilityItem: "Quiver",
    ability: "Volley",
    concept: "Fire a special arrow or a small volley.",
  },
  wizard: {
    id: "wizard",
    name: "Wizard",
    abilityItem: "Spellbook",
    ability: "Arcane Blast",
    concept: "Detonate area damage.",
  },
  cleric: {
    id: "cleric",
    name: "Cleric",
    abilityItem: "Tome",
    ability: "Healing",
    concept: "Restore yourself and nearby allies.",
  },
  bard: {
    id: "bard",
    name: "Bard",
    abilityItem: "Instrument",
    ability: "Inspiration",
    concept: "Temporarily strengthen nearby allies.",
  },
  warlock: {
    id: "warlock",
    name: "Warlock",
    abilityItem: "Grimoire",
    ability: "Curse",
    concept: "Mark enemies to take more damage.",
  },
  druid: {
    id: "druid",
    name: "Druid",
    abilityItem: "Totem",
    ability: "Nature's Reach",
    concept: "Create a damaging or entangling area.",
  },
  sorcerer: {
    id: "sorcerer",
    name: "Sorcerer",
    abilityItem: "Scepter",
    ability: "Chain Lightning",
    concept: "Lightning that jumps between enemies.",
  },
};

export function isClassId(v: unknown): v is ClassId {
  return typeof v === "string" && (CLASS_IDS as readonly string[]).includes(v);
}

/** What a serf is called by class: "Serf" until it picks one. */
export function className(classId: ClassId | null): string {
  return classId ? CLASSES[classId].name : "Serf";
}

/**
 * A living serf at level 5 or above without a class must pick one before
 * its next dungeon (D-073).
 */
export function needsClass(serf: {
  level: number;
  classId: ClassId | null;
  alive: boolean;
}): boolean {
  return (
    serf.alive && serf.classId === null && serf.level >= CLASS_CHOICE_LEVEL
  );
}
