import {
  ABILITIES,
  totalExpForLevel,
  type SerfSummary,
  type SnapshotPlayer,
} from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { abilityLine, expBar, partyRows } from "./hud";

const player = (id: number, hp: number, maxHp = 100): SnapshotPlayer => ({
  id,
  x: 0,
  y: 0,
  ack: 0,
  hp,
  maxHp,
  mp: 0,
  maxMp: 0,
  buffs: [],
  cooldown: 0,
  abilityCooldown: 0,
  boost: 0,
  pull: null,
});

describe("the HUD's ability line (D-146)", () => {
  const guard = { kind: "guard", tier: 7 } as const;
  const cost = ABILITIES.guard.mpCost;
  it("says ready, cooling down, or short of MP", () => {
    expect(abilityLine(guard, 0, cost)).toMatch(/· ready$/);
    expect(abilityLine(guard, 1.24, cost)).toMatch(/· 1\.2 s$/);
    expect(abilityLine(guard, 0, cost - 1)).toMatch(/· need MP$/);
    expect(abilityLine(null, 0, 0)).toBe("Space: no ability");
  });
});

describe("the HUD's party rows (D-146)", () => {
  const party = {
    leaderId: 1,
    members: [
      { playerId: 1, name: "Bran", classId: "fighter" as const, level: 20 },
      { playerId: 2, name: "Wynne", classId: "wizard" as const, level: 20 },
      { playerId: 3, name: null, classId: null, level: 1 },
    ],
  };
  it("lists the others with their HP in this run, or not here", () => {
    expect(partyRows(party, 2, [player(1, 50), player(2, 100)])).toEqual([
      { name: "Bran", hp: 0.5, leader: true },
      { name: "Choosing a serf", hp: null, leader: false },
    ]);
  });
  it("shows nothing without a party", () => {
    expect(partyRows(null, 1, [player(1, 50), player(4, 10)])).toEqual([]);
  });
});

describe("the HUD's EXP bar", () => {
  const serf = (exp: number) => ({ exp }) as SerfSummary;
  it("fills towards the next level, and is full at 20", () => {
    expect(expBar(serf(0)).fill).toBe(0);
    const at5 = totalExpForLevel(5);
    expect(expBar(serf(at5)).text).toMatch(/^0 \/ \d+ EXP$/);
    expect(expBar(serf(totalExpForLevel(20) + 5))).toEqual({
      fill: 1,
      text: `Max level · ${totalExpForLevel(20) + 5} EXP`,
    });
  });
});
