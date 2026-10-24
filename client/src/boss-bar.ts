import {
  FORGEMASTER,
  LICH,
  TIDEPRIEST,
  WARCHIEF,
  WYRM,
  AUTOMATON,
  WARDEN,
  STORMCALLER,
  WARLORD,
  type EnemyKind,
} from "@serfdom/shared";

/** What the boss bar shows for one boss (D-102, D-117, D-125). */
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
  /** The Lich: warded (`faded`) or stunned (`dazed`), as the snapshot says. */
  state: { faded?: boolean; dazed?: boolean; vented?: boolean } = {},
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
  if (kind === "lich") {
    return {
      name: "The Lich",
      notches: LICH.wardBelow,
      angry: fraction < LICH.wardBelow[0]!,
      suffix: state.faded
        ? "  — WARDED"
        : state.dazed
          ? "  — STUNNED"
          : fraction < LICH.wardBelow[1]!
            ? "  — ENRAGED"
            : "",
    };
  }
  if (kind === "stormcaller") {
    return {
      name: "The Storm Caller",
      notches: STORMCALLER.wardBelow,
      angry: fraction < STORMCALLER.wardBelow[0]!,
      suffix: state.faded
        ? "  — WARDED"
        : state.dazed
          ? "  — STUNNED"
          : fraction < STORMCALLER.wardBelow[1]!
            ? "  — ENRAGED"
            : "",
    };
  }
  if (kind === "warden") {
    const phase =
      fraction < WARDEN.phaseThreeBelow
        ? 3
        : fraction < WARDEN.phaseTwoBelow
          ? 2
          : 1;
    return {
      name: "The Warden of the Abyss",
      notches: [WARDEN.phaseTwoBelow, WARDEN.phaseThreeBelow],
      angry: phase > 1,
      suffix: state.dazed ? "  — DAZED" : phase === 3 ? "  — ENRAGED" : "",
    };
  }
  if (kind === "automaton") {
    return {
      name: "The Automaton",
      notches: [AUTOMATON.dronesBelow, AUTOMATON.enragedBelow],
      angry: fraction < AUTOMATON.dronesBelow,
      suffix: state.vented
        ? "  — OVERHEATED"
        : fraction < AUTOMATON.enragedBelow
          ? "  — ENRAGED"
          : "",
    };
  }
  if (kind === "wyrm") {
    return {
      name: "The Frost Wyrm",
      notches: [WYRM.summonBelow, WYRM.enragedBelow],
      angry: fraction < WYRM.summonBelow,
      suffix: fraction < WYRM.enragedBelow ? "  — ENRAGED" : "",
    };
  }
  if (kind === "tidepriest") {
    return {
      name: "The Tide Priest",
      notches: [TIDEPRIEST.whirlBelow, TIDEPRIEST.enragedBelow],
      angry: fraction < TIDEPRIEST.whirlBelow,
      suffix: fraction < TIDEPRIEST.enragedBelow ? "  — ENRAGED" : "",
    };
  }
  if (kind === "forgemaster") {
    return {
      name: "The Forgemaster",
      notches: [FORGEMASTER.golemsBelow, FORGEMASTER.enragedBelow],
      angry: fraction < FORGEMASTER.golemsBelow,
      suffix: fraction < FORGEMASTER.enragedBelow ? "  — ENRAGED" : "",
    };
  }
  return undefined;
}
