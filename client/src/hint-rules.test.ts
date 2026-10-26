import type { HintId } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import {
  HINT_MAX_SECONDS,
  HINT_MIN_SECONDS,
  RunHints,
  type RunFacts,
} from "./hint-rules";

const quiet: RunFacts = {
  seconds: 0,
  moved: false,
  fireModeChanged: false,
  turned: false,
  hurt: false,
  bossVisible: false,
  portalOpen: false,
  hasAbility: false,
  abilityUsed: false,
};

/** Runs the hints over time, marking finished ones seen; returns what showed, in order. */
function play(
  steps: [number, Partial<RunFacts>][],
  seen: Set<HintId> = new Set(),
): HintId[] {
  const hints = new RunHints();
  const shown: HintId[] = [];
  for (const [seconds, change] of steps) {
    const r = hints.update({ ...quiet, ...change, seconds }, seen);
    if (r.finished) seen.add(r.finished);
    if (r.show && shown.at(-1) !== r.show) shown.push(r.show);
  }
  return shown;
}

describe("first-run hints in a run (D-159)", () => {
  it("teaches the basics one at a time, each going when done (but readable first)", () => {
    const hints = new RunHints();
    const seen = new Set<HintId>();
    expect(hints.update({ ...quiet, seconds: 0.2 }, seen).show).toBeNull();
    expect(hints.update({ ...quiet, seconds: 1 }, seen).show).toBe("move");
    // Moving at once does not hide it before it can be read.
    expect(
      hints.update({ ...quiet, seconds: 1.5, moved: true }, seen).show,
    ).toBe("move");
    const r = hints.update(
      { ...quiet, seconds: 1 + HINT_MIN_SECONDS, moved: true },
      seen,
    );
    expect(r.finished).toBe("move");
    expect(r.show).toBe("fire");
  });

  it("a hint whose action never comes goes after a while", () => {
    expect(
      play([
        [1, {}],
        [1 + HINT_MAX_SECONDS, {}],
        [1 + 2 * HINT_MAX_SECONDS, {}],
        [1 + 3 * HINT_MAX_SECONDS, {}],
        [1 + 4 * HINT_MAX_SECONDS, {}],
      ]),
    ).toEqual(["move", "fire", "turn", "leave"]);
  });

  it("the moment's hint comes first: being hit, the boss, the portal", () => {
    const seen = new Set<HintId>(["move", "fire", "turn", "leave"]);
    expect(
      play(
        [
          [1, { hurt: true }],
          [1 + HINT_MAX_SECONDS, { hurt: true, bossVisible: true }],
          [
            1 + 2 * HINT_MAX_SECONDS,
            { hurt: true, bossVisible: true, portalOpen: true },
          ],
        ],
        seen,
      ),
    ).toEqual(["dodge", "boss", "portal"]);
  });

  it("each hint shows once: seen ones never come back", () => {
    const seen = new Set<HintId>(["move", "fire", "turn", "leave", "dodge"]);
    expect(
      play(
        [
          [1, { hurt: true }],
          [20, { hurt: true }],
        ],
        seen,
      ),
    ).toEqual([]);
    // The ability hint waits for a class's ability, and goes once it is used.
    expect(
      play(
        [
          [1, { hasAbility: true }],
          [1 + HINT_MIN_SECONDS, { hasAbility: true, abilityUsed: true }],
          [30, { hasAbility: true }],
        ],
        seen,
      ),
    ).toEqual(["ability"]);
  });
});
