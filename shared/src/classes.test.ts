import { describe, expect, it } from "vitest";
import {
  CLASS_IDS,
  CLASSES,
  className,
  isClassId,
  needsClass,
} from "./classes.ts";
import { CLASS_CHOICE_LEVEL } from "./progression.ts";

describe("launch classes (D-072, D-073)", () => {
  it("has the 10 confirmed classes, each with an ability item", () => {
    expect(CLASS_IDS.map((id) => CLASSES[id].name)).toEqual([
      "Fighter",
      "Barbarian",
      "Rogue",
      "Ranger",
      "Wizard",
      "Cleric",
      "Bard",
      "Warlock",
      "Druid",
      "Sorcerer",
    ]);
    for (const id of CLASS_IDS) {
      expect(CLASSES[id].id).toBe(id);
      expect(CLASSES[id].abilityItem).not.toBe("");
    }
  });

  it("recognizes only real class ids", () => {
    expect(isClassId("cleric")).toBe(true);
    expect(isClassId("Cleric")).toBe(false);
    expect(isClassId("serf")).toBe(false);
    expect(isClassId("toString")).toBe(false);
    expect(isClassId(null)).toBe(false);
  });

  it("a classless serf is a Serf", () => {
    expect(className(null)).toBe("Serf");
    expect(className("warlock")).toBe("Warlock");
  });

  it("a living classless serf must choose from level 5", () => {
    const serf = { level: CLASS_CHOICE_LEVEL, classId: null, alive: true };
    expect(CLASS_CHOICE_LEVEL).toBe(5);
    expect(needsClass(serf)).toBe(true);
    expect(needsClass({ ...serf, level: 4 })).toBe(false);
    expect(needsClass({ ...serf, level: 20 })).toBe(true);
    expect(needsClass({ ...serf, classId: "bard" })).toBe(false);
    expect(needsClass({ ...serf, alive: false })).toBe(false);
  });
});
