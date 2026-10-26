import { describe, expect, it } from "vitest";
import {
  ARTIFACT_IDS,
  ARTIFACT_ROLLS,
  ARTIFACT_TIER,
  ARTIFACTS,
  artifactsOf,
  RARE_LOOT,
} from "./artifacts.ts";
import { LISTED_DUNGEONS } from "./dungeons.ts";
import {
  accessoryBase,
  isAccessorySlot,
  isValidItemSpec,
  itemBonus,
  itemName,
  maxRoll,
  MAX_TIER,
  ROLLS_PER_TIER,
  rollArtifact,
  rollChestItem,
  weaponDamage,
} from "./items.ts";
import { seededRandom } from "./seeded-random.ts";

const endgame = LISTED_DUNGEONS.filter(
  (d) => ("minLevel" in d ? d.minLevel : 1) >= 20,
).map((d) => d.id);
const ladder = LISTED_DUNGEONS.filter((d) => !endgame.includes(d.id)).map(
  (d) => d.id,
);

describe("the 23 Artifacts (D-152, D-153)", () => {
  it("are all 23 concepts, spread over the five endgame dungeons only", () => {
    expect(ARTIFACT_IDS).toHaveLength(23);
    expect(endgame).toHaveLength(5);
    for (const d of ladder) expect(artifactsOf(d), d).toEqual([]);
    for (const d of endgame) {
      expect(artifactsOf(d).length, d).toBeGreaterThanOrEqual(4);
    }
    expect(endgame.flatMap((d) => artifactsOf(d)).sort()).toEqual(
      [...ARTIFACT_IDS].sort(),
    );
  });

  it("roll as valid items: their own slot and type, T12 power, 6 rolls of the usual kind", () => {
    const random = seededRandom(7);
    for (const id of ARTIFACT_IDS) {
      for (let n = 0; n < 50; n++) {
        const item = rollArtifact(id, random);
        expect(isValidItemSpec(item), id).toBe(true);
        expect(item).toMatchObject({
          artifact: id,
          slot: ARTIFACTS[id].slot,
          type: ARTIFACTS[id].type,
          tier: ARTIFACT_TIER,
        });
        expect(item.rolls).toHaveLength(ARTIFACT_ROLLS);
        for (const r of item.rolls) {
          expect(Math.abs(r.amount)).toBeGreaterThanOrEqual(1);
          expect(Math.abs(r.amount)).toBeLessThanOrEqual(maxRoll(r.stat));
          if (isAccessorySlot(item.slot)) expect(r.stat).not.toBe(item.type);
        }
      }
    }
  });

  it("always beat the best tiered item: a stronger base and more roll slots", () => {
    expect(ARTIFACT_ROLLS).toBeGreaterThan(Math.max(...ROLLS_PER_TIER));
    expect(weaponDamage(ARTIFACT_TIER)).toBeGreaterThan(weaponDamage(MAX_TIER));
    expect(accessoryBase("vitality", ARTIFACT_TIER)).toBeGreaterThan(
      accessoryBase("vitality", MAX_TIER),
    );
    for (const type of ["plate", "leather", "cloth"] as const) {
      const at = (tier: number) =>
        itemBonus({ slot: "chest", type, tier, rolls: [], luck: 0 });
      const sum = (b: ReturnType<typeof at>) =>
        Object.values(b).reduce((x, y) => x + y, 0);
      expect(sum(at(ARTIFACT_TIER))).toBeGreaterThan(sum(at(MAX_TIER)));
    }
  });

  it("refuse tampering: wrong type, a tiered tier, too few rolls, an unknown id", () => {
    const item = rollArtifact("doomrend", seededRandom(1));
    expect(isValidItemSpec({ ...item, type: "sword" })).toBe(false);
    expect(isValidItemSpec({ ...item, tier: MAX_TIER })).toBe(false);
    expect(isValidItemSpec({ ...item, rolls: item.rolls.slice(1) })).toBe(
      false,
    );
    expect(
      isValidItemSpec({ ...item, artifact: "mjolnir" as "doomrend" }),
    ).toBe(false);
    // A tiered item cannot claim Artifact power without being one.
    const plain = { ...item };
    delete plain.artifact;
    expect(isValidItemSpec(plain)).toBe(false);
  });
});

describe("names (D-152)", () => {
  it("an Artifact goes by its own name; Shiny comes first", () => {
    const axe = rollArtifact("doomrend", seededRandom(2));
    expect(itemName(axe)).toBe("Doomrend, the World-Ender");
    expect(itemName({ ...axe, shiny: true })).toBe(
      "Shiny Doomrend, the World-Ender",
    );
    expect(
      itemName({
        slot: "weapon",
        type: "sword",
        tier: 7,
        rolls: [],
        luck: 0,
        shiny: true,
      }),
    ).toBe("Shiny T7 Sword");
  });
});

describe("drop rates over many simulated chests (Phase 16 acceptance)", () => {
  const CHESTS = 400_000;
  const tally = (dungeon: (typeof LISTED_DUNGEONS)[number]["id"]) => {
    const random = seededRandom(dungeon.length * 97 + 3);
    let artifacts = 0;
    let shiny = 0;
    const each = new Map<string, number>();
    for (let i = 0; i < CHESTS; i++) {
      const item = rollChestItem(dungeon, random);
      if (item.artifact) {
        artifacts++;
        each.set(item.artifact, (each.get(item.artifact) ?? 0) + 1);
      }
      if (item.shiny) shiny++;
    }
    return { artifacts, shiny, each };
  };

  it("an endgame chest: an Artifact 1 in 500, Shiny 1 in 2,000, each Artifact alike", () => {
    const { artifacts, shiny, each } = tally("dragons-roost");
    // Within about four standard deviations of the configured rate.
    const near = (n: number, p: number) => {
      const mean = CHESTS * p;
      expect(Math.abs(n - mean)).toBeLessThan(4 * Math.sqrt(mean));
    };
    near(artifacts, RARE_LOOT.artifactChance);
    near(shiny, RARE_LOOT.shinyChance);
    const own = artifactsOf("dragons-roost");
    expect([...each.keys()].sort()).toEqual([...own].sort());
    for (const id of own) {
      near(each.get(id) ?? 0, RARE_LOOT.artifactChance / own.length);
    }
  });

  it("a ladder chest never holds an Artifact, but can still be Shiny", () => {
    const { artifacts, shiny } = tally("goblin-warrens");
    expect(artifacts).toBe(0);
    expect(shiny).toBeGreaterThan(0);
  });
});
