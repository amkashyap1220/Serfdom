import type { HintId } from "@serfdom/shared";

/*
 * The first-run hints in a run (D-159): which one shows, and when it is
 * done. Pure (a clock is passed in), so the rules are unit-tested; the
 * words and drawing are in main.ts.
 */

/** What has happened in the current run, for the hints. */
export interface RunFacts {
  /** Seconds since the run started. */
  seconds: number;
  moved: boolean;
  fireModeChanged: boolean;
  turned: boolean;
  /** HP has dropped at least once this run. */
  hurt: boolean;
  bossVisible: boolean;
  portalOpen: boolean;
  hasAbility: boolean;
  abilityUsed: boolean;
}

/** A hint is readable for at least this long, even if it is done at once. */
export const HINT_MIN_SECONDS = 2.5;
/** …and it goes after this long even if its action never happens. */
export const HINT_MAX_SECONDS = 9;

/** Hints that wait for a moment; the first one whose moment has come shows. */
const MOMENTS: readonly {
  id: HintId;
  ready: (f: RunFacts, seen: ReadonlySet<HintId>) => boolean;
}[] = [
  // Something happening now comes first.
  { id: "portal", ready: (f) => f.portalOpen },
  { id: "boss", ready: (f) => f.bossVisible },
  { id: "dodge", ready: (f) => f.hurt },
  { id: "ability", ready: (f) => f.hasAbility },
  // Then the basics, one after another.
  { id: "move", ready: (f) => f.seconds >= 0.5 },
  { id: "fire", ready: (_f, seen) => seen.has("move") },
  { id: "turn", ready: (_f, seen) => seen.has("fire") },
  { id: "leave", ready: (_f, seen) => seen.has("turn") },
];

/** Whether a hint's own action has been done (so it can go early). */
function actionDone(id: HintId, f: RunFacts): boolean {
  switch (id) {
    case "move":
      return f.moved;
    case "fire":
      return f.fireModeChanged;
    case "turn":
      return f.turned;
    case "ability":
      return f.abilityUsed;
    default:
      return false;
  }
}

/**
 * Shows one hint at a time: \`update\` returns the hint to show now (or
 * null) and any hint that has just finished, which the caller marks seen.
 */
export class RunHints {
  private current: { id: HintId; since: number } | null = null;

  /** A new run: nothing showing. */
  reset(): void {
    this.current = null;
  }

  update(
    facts: RunFacts,
    seen: ReadonlySet<HintId>,
  ): { show: HintId | null; finished: HintId | null } {
    let finished: HintId | null = null;
    const cur = this.current;
    if (cur) {
      const shown = facts.seconds - cur.since;
      if (
        shown >= HINT_MAX_SECONDS ||
        (shown >= HINT_MIN_SECONDS && actionDone(cur.id, facts))
      ) {
        finished = cur.id;
        this.current = null;
      }
    }
    if (!this.current) {
      const done = new Set(seen);
      if (finished) done.add(finished);
      const next = MOMENTS.find((m) => !done.has(m.id) && m.ready(facts, done));
      if (next) this.current = { id: next.id, since: facts.seconds };
    }
    return { show: this.current?.id ?? null, finished };
  }
}
