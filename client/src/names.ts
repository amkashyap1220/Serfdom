import type { EnemyKind } from "@serfdom/shared";

/** How enemies are named on screen (death screen "Slain by …"). */
export const ENEMY_NAMES: Record<EnemyKind, string> = {
  dummy: "a Training Dummy",
  grunt: "a Goblin Grunt",
  slinger: "a Goblin Slinger",
  brute: "a Goblin Brute",
  warlord: "the Goblin Warlord",
};
