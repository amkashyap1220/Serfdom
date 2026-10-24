import type { EnemyKind, HazardKind } from "@serfdom/shared";

/** How enemies and room hazards are named on screen (death screen "Slain by …"). */
export const ENEMY_NAMES: Record<EnemyKind | HazardKind, string> = {
  dummy: "a Training Dummy",
  grunt: "a Goblin Grunt",
  slinger: "a Goblin Slinger",
  brute: "a Goblin Brute",
  warlord: "the Goblin Warlord",
  skulker: "a Goblin Skulker",
  bomber: "a Goblin Bomber",
  shaman: "a Goblin Shaman",
  warchief: "the Goblin Warchief",
  skeleton: "a Skeleton",
  archer: "a Skeleton Archer",
  rockfall: "a falling boulder",
  arrows: "an arrow trap",
};
