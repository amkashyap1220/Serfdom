import { WARCHIEF, WARLORD, type EnemyKind } from "@serfdom/shared";

/** What the boss bar shows for one boss (D-102, D-117). */
export interface BossBar {
  name: string;
  /** HP fractions where a new phase begins, drawn as notches. */
  notches: readonly number[];
  /** Phase 2 or later: the bar turns bright red. */
  angry: boolean;
  /** After the name and HP, e.g. "  — ENRAGED". */
  suffix: string;
}

/** The boss bar for an enemy, or undefined if it is not a boss. */
export function bossBar(
  kind: EnemyKind,
  hp: number,
  maxHp: number,
): BossBar | undefined {
  const fraction = hp / maxHp;
  if (kind === "warlord") {
    const angry = fraction < WARLORD.phaseTwoBelow;
    return {
      name: "Goblin Warlord",
      notches: [WARLORD.phaseTwoBelow],
      angry,
      suffix: angry ? "  — ENRAGED" : "",
    };
  }
  if (kind === "warchief") {
    const phase =
      fraction < WARCHIEF.phaseThreeBelow
        ? 3
        : fraction < WARCHIEF.phaseTwoBelow
          ? 2
          : 1;
    return {
      name: "Goblin Warchief",
      notches: [WARCHIEF.phaseTwoBelow, WARCHIEF.phaseThreeBelow],
      angry: phase > 1,
      suffix: phase === 3 ? "  — ENRAGED" : phase === 2 ? "  — WAR CRY" : "",
    };
  }
  return undefined;
}
