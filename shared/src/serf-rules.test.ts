import { describe, expect, it } from "vitest";
import { newRunStats } from "./run-stats.ts";
import {
  addRunToLife,
  newLifeStats,
  normalizeSerfName,
  serfNameProblem,
  suggestSerfName,
} from "./serf-rules.ts";

describe("serf names", () => {
  it("normalizes spacing", () => {
    expect(normalizeSerfName("  Aldric   Mudfoot ")).toBe("Aldric Mudfoot");
  });

  it.each([
    ["Edda", null],
    ["Aldric Mudfoot", null],
    ["Odo2", null],
    ["Al", "Use at least 3 characters."],
    ["Aldric Mudfoottt", null], // exactly 16
    ["Aldric Mudfootttt", "Use at most 16 characters."],
    ["2Odo", "Use letters, digits, and spaces, starting with a letter."],
    ["Odo!", "Use letters, digits, and spaces, starting with a letter."],
    ["Ödö", "Use letters, digits, and spaces, starting with a letter."],
  ])("%s → %s", (name, problem) => {
    expect(serfNameProblem(name)).toBe(problem);
  });

  it("suggests names that pass the rules", () => {
    let seed = 0;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 200; i++) {
      expect(serfNameProblem(suggestSerfName(random))).toBeNull();
    }
  });
});

describe("life stats", () => {
  it("adds runs up; only completions count as clears", () => {
    const run = {
      ...newRunStats(),
      seconds: 60,
      enemiesDefeated: 3,
      damageTaken: 8,
    };
    let life = addRunToLife(newLifeStats(), "completed", run);
    life = addRunToLife(life, "left", run);
    life = addRunToLife(life, "died", run);
    expect(life).toMatchObject({
      runs: 3,
      clears: 1,
      seconds: 180,
      enemiesDefeated: 9,
      damageTaken: 24,
    });
  });
});
