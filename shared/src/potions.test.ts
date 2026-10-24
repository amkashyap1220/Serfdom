import { describe, expect, it } from "vitest";
import {
  drinkPotion,
  POTION_CHANCE,
  potionAmount,
  potionName,
  potionProblem,
  rollPotions,
} from "./potions.ts";
import { CLASS_IDS } from "./classes.ts";
import {
  addStats,
  applyGains,
  classBonus,
  rollLevelGains,
  SERF_BASE,
  SERF_MAX,
  STAT_KEYS,
  statMax,
  zeroStats,
} from "./stats.ts";

/** Returns the given numbers in turn (then 0.99, a losing roll). */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0.99;
};

describe("stat potions (D-118)", () => {
  it("there is one for each stat, and none for Luck (D-066)", () => {
    expect(STAT_KEYS.map(potionName)).toEqual([
      "Potion of Health",
      "Potion of Mana",
      "Potion of Attack",
      "Potion of Dexterity",
      "Potion of Speed",
      "Potion of Defense",
      "Potion of Vitality",
      "Potion of Wisdom",
    ]);
    expect(STAT_KEYS as readonly string[]).not.toContain("luck");
  });

  it("adds 5 HP or MP, 1 of anything else", () => {
    expect(potionAmount("hp")).toBe(5);
    expect(potionAmount("mp")).toBe(5);
    for (const key of STAT_KEYS.filter((k) => k !== "hp" && k !== "mp")) {
      expect(potionAmount(key)).toBe(1);
    }
  });

  it("only the Stronghold gives potions, a 20% chance per Luck point", () => {
    expect(POTION_CHANCE["goblin-stronghold"]).toBe(0.2);
    // The Warrens uses no random numbers at all.
    let calls = 0;
    expect(
      rollPotions("goblin-warrens", 5, () => {
        calls++;
        return 0;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
    // Luck 3: a win (picks stat 2, Attack), a loss, a win (picks the last).
    expect(
      rollPotions("goblin-stronghold", 3, sequence(0.1, 0.3, 0.5, 0.19, 0.99)),
    ).toEqual(["attack", "wisdom"]);
    expect(rollPotions("goblin-stronghold", 3, () => 0.2)).toEqual([]);
  });

  it("each stat is equally likely", () => {
    const counts = new Map<string, number>();
    for (let n = 0; n < 8; n++) {
      // Win, then pick the middle of stat n's slice.
      const [stat] = rollPotions(
        "goblin-stronghold",
        1,
        sequence(0, (n + 0.5) / 8),
      );
      counts.set(stat!, (counts.get(stat!) ?? 0) + 1);
    }
    expect([...counts.keys()]).toEqual([...STAT_KEYS]);
  });

  it("needs a living, classed serf below that stat's class max", () => {
    const serf = {
      name: "Ida",
      alive: true,
      classId: "fighter" as const,
      stats: { ...SERF_BASE, wisdom: statMax("fighter", "wisdom") },
    };
    expect(potionProblem(serf, "attack")).toBeNull();
    expect(potionProblem(serf, "wisdom")).toBe(
      "Ida's Wisdom is already at its max.",
    );
    // Before a class: up to the Serf max (D-119), and no Defense at all.
    const plain = { ...serf, classId: null, stats: { ...SERF_BASE } };
    expect(potionProblem(plain, "attack")).toBeNull();
    expect(potionProblem({ ...plain, stats: { ...SERF_MAX } }, "attack")).toBe(
      "Ida's Attack is at the Serf max (14); a class raises it.",
    );
    expect(potionProblem(plain, "defense")).toBe(
      "A Serf has no Defense to raise: Ida needs a class first.",
    );
    expect(potionProblem({ ...serf, alive: false }, "attack")).toBe(
      "Ida is dead.",
    );
  });

  it("never raises a stat past the class max", () => {
    const max = statMax("fighter", "hp");
    expect(drinkPotion({ ...SERF_BASE, hp: max - 2 }, "fighter", "hp").hp).toBe(
      max,
    );
    const once = drinkPotion(SERF_BASE, "fighter", "attack");
    expect(once).toEqual({ ...SERF_BASE, attack: SERF_BASE.attack + 1 });
    // A Serf stops at the Serf max: 30 HP + 5 is 32.
    expect(drinkPotion({ ...SERF_BASE, hp: 30 }, null, "hp").hp).toBe(32);
  });

  it("works like Realm of the Mad God: potions and levels add up to one max (D-119)", () => {
    // The Serf max is the best a Serf can roll by level 5.
    expect(SERF_MAX).toEqual({
      hp: 32,
      mp: 18,
      attack: 14,
      dexterity: 14,
      speed: 14,
      defense: 0,
      vitality: 14,
      wisdom: 14,
    });
    // Below every class's max, so choosing a class never lowers a stat.
    for (const classId of CLASS_IDS) {
      for (const key of STAT_KEYS) {
        expect(SERF_MAX[key]).toBeLessThanOrEqual(statMax(classId, key));
      }
    }
    // Best rolls on every Serf level reach the Serf max exactly.
    let best = { ...SERF_BASE };
    for (let level = 2; level <= 5; level++) {
      best = addStats(
        best,
        rollLevelGains(best, level, null, () => 0.999),
      );
    }
    expect(best).toEqual(SERF_MAX);
    // A level-1 Serf maxed on potions gains nothing from its Serf levels:
    // the free level gains are wasted, so leveling first is the better deal.
    expect(rollLevelGains(SERF_MAX, 2, null, () => 0.999)).toEqual(zeroStats());
    // After a class, potions take it on to the class max, and so do levels.
    const fighter = applyGains(SERF_MAX, classBonus("fighter"), "fighter");
    expect(
      potionProblem(
        { name: "Ida", alive: true, classId: "fighter", stats: fighter },
        "attack",
      ),
    ).toBeNull();
    const gains = rollLevelGains(
      { ...fighter, attack: statMax("fighter", "attack") },
      6,
      "fighter",
      () => 0.999,
    );
    expect(gains.attack).toBe(0);
  });
});
