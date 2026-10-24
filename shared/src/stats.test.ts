import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./classes.ts";
import { PLAYER_HEALTH, PLAYER_REGEN, PLAYER_WEAPON } from "./combat-config.ts";
import { PLAYER_SPEED } from "./movement-config.ts";
import {
  applyGains,
  BASE_LUCK,
  luckOf,
  combatFor,
  classBonus,
  classTier,
  rollLevelGains,
  rollRange,
  SERF_BASE,
  STAT_KEYS,
  statMax,
  type Stats,
} from "./stats.ts";

const lowest = () => 0;
const highest = () => 0.999999;

/** Average stats after leveling a serf of `classId` from 1 to 20. */
function averageAt20(classId: (typeof CLASS_IDS)[number], runs = 400) {
  const sum: Stats = { ...SERF_BASE };
  for (const key of STAT_KEYS) sum[key] = 0;
  for (let r = 0; r < runs; r++) {
    let stats = { ...SERF_BASE };
    for (let level = 2; level <= 20; level++) {
      if (level === 6) stats = applyGains(stats, classBonus(classId), classId);
      const gains = rollLevelGains(stats, level, classId, Math.random);
      stats = applyGains(stats, gains, level > 5 ? classId : null);
    }
    for (const key of STAT_KEYS) sum[key] += stats[key] / runs;
  }
  return sum;
}

describe("stats (D-074, D-075, T-048)", () => {
  it("a fresh Serf has the Phase 6 numbers: 20 HP, 10s, no Defense", () => {
    expect(SERF_BASE).toEqual({
      hp: 20,
      mp: 10,
      attack: 10,
      dexterity: 10,
      speed: 10,
      defense: 0,
      vitality: 10,
      wisdom: 10,
    });
  });

  it("rolls every whole number in a range, ends included", () => {
    expect(rollRange([3, 6], lowest)).toBe(3);
    expect(rollRange([3, 6], highest)).toBe(6);
    expect(rollRange([0, 0], highest)).toBe(0);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(rollRange([1, 3], Math.random));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("levels 2–5 roll the Serf ranges whatever the class", () => {
    expect(rollLevelGains(SERF_BASE, 3, null, highest)).toEqual({
      hp: 3,
      mp: 2,
      attack: 1,
      dexterity: 1,
      speed: 1,
      defense: 0,
      vitality: 1,
      wisdom: 1,
    });
    expect(rollLevelGains(SERF_BASE, 5, "wizard", lowest).hp).toBe(1);
  });

  it("levels 6+ roll the class tier; a classless serf gains nothing past 5", () => {
    const wizard = rollLevelGains(SERF_BASE, 6, "wizard", highest);
    expect(wizard.hp).toBe(4); // low: 1–4
    expect(wizard.mp).toBe(6); // high: 3–6
    expect(wizard.defense).toBe(0); // low: 0
    expect(rollLevelGains(SERF_BASE, 6, null, highest)).toEqual(
      Object.fromEntries(STAT_KEYS.map((k) => [k, 0])),
    );
  });

  it("level growth stops at the class max (only potions go further)", () => {
    const nearMax = { ...SERF_BASE, attack: 59, hp: 200 };
    const gains = rollLevelGains(nearMax, 12, "wizard", highest);
    expect(gains.attack).toBe(1); // high max 60
    expect(statMax("wizard", "hp")).toBe(130);
    expect(
      applyGains({ ...SERF_BASE, hp: 129 }, { ...gains, hp: 5 }, "wizard").hp,
    ).toBe(130);
  });

  it("the class bonus is +10 HP/MP and +3 on each High stat only", () => {
    expect(classBonus("barbarian")).toEqual({
      hp: 10,
      mp: 0,
      attack: 3,
      dexterity: 0,
      speed: 0,
      defense: 0,
      vitality: 3,
      wisdom: 0,
    });
  });

  it("every class has a tier for every stat", () => {
    for (const id of CLASS_IDS) {
      for (const key of STAT_KEYS)
        expect(classTier(id, key)).toMatch(/^(high|mid|low)$/);
    }
  });

  it("level 20 lands where the approved draft says, well under the maxes", () => {
    const barbarian = averageAt20("barbarian");
    const wizard = averageAt20("wizard");
    expect(barbarian.hp).toBeGreaterThan(98); // ~105
    expect(barbarian.hp).toBeLessThan(112);
    expect(wizard.hp).toBeGreaterThan(60); // ~65
    expect(wizard.hp).toBeLessThan(71);
    expect(wizard.attack).toBeGreaterThan(35); // ~37.5
    expect(wizard.attack).toBeLessThan(40);
    expect(wizard.attack).toBeLessThan(statMax("wizard", "attack"));
  });
});

describe("combat from stats (D-077, D-078)", () => {
  it("a fresh Serf plays exactly like before stats existed", () => {
    expect(combatFor(SERF_BASE)).toEqual({
      maxHp: PLAYER_HEALTH.maxHp,
      moveSpeed: PLAYER_SPEED,
      shotsPerSecond: PLAYER_WEAPON.shotsPerSecond,
      shotDamage: PLAYER_WEAPON.damage,
      damageTakenFactor: 1,
      regenPerSecond: PLAYER_REGEN.hpPerSecond,
      maxMp: 10,
      mpRegenPerSecond: 1, // WIS 10 / 10 (D-096)
      attackFactor: 1,
    });
  });

  it("matches the approved formula table", () => {
    const c = combatFor({
      ...SERF_BASE,
      hp: 105,
      attack: 30,
      dexterity: 30,
      speed: 30,
      defense: 30,
      vitality: 30,
    });
    expect(c.maxHp).toBe(105);
    expect(c.shotDamage).toBe(50);
    expect(c.shotsPerSecond).toBe(6);
    expect(c.moveSpeed).toBe(225);
    // D-121: 40 / (40 + 30).
    expect(c.damageTakenFactor).toBeCloseTo(40 / 70);
    expect(c.regenPerSecond).toBe(1.5);
    // Speed 60 is out of reach (the highest Speed max is 45 → 281.25 px/s).
    const top = combatFor({
      ...SERF_BASE,
      attack: 60,
      dexterity: 60,
      speed: 60,
      vitality: 60,
    });
    expect([
      top.shotDamage,
      top.shotsPerSecond,
      top.moveSpeed,
      top.regenPerSecond,
    ]).toEqual([87.5, 9, 337.5, 3]);
  });
});

describe("Luck (D-065–D-068)", () => {
  it("a serf has 1 Luck, plus +1 for each equipped Luck item, no cap", () => {
    expect(BASE_LUCK).toBe(1);
    expect(luckOf()).toBe(1);
    expect(luckOf([{ luck: 1 }, { luck: 0 }, { luck: 1 }])).toBe(3);
    expect(luckOf(Array.from({ length: 50 }, () => ({ luck: 1 })))).toBe(51);
  });

  it("is not a rolled stat, so levels and classes never change it", () => {
    expect(STAT_KEYS as readonly string[]).not.toContain("luck");
    let stats = { ...SERF_BASE };
    for (let level = 2; level <= 20; level++) {
      if (level === 6) stats = applyGains(stats, classBonus("rogue"), "rogue");
      stats = applyGains(
        stats,
        rollLevelGains(stats, level, "rogue", () => 0.99),
        "rogue",
      );
    }
    expect(Object.keys(stats)).not.toContain("luck");
    expect(luckOf()).toBe(1);
  });
});
