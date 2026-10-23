import { describe, expect, it } from "vitest";
import { ABILITIES, abilityIntent, type AbilityLoadout } from "./abilities.ts";
import { resolveFireIntent, type AimTarget } from "./weapon.ts";

const at = { x: 0, y: 0 };
const cursor = { world: { x: 0, y: -100 }, down: false };
const near: AimTarget[] = [{ id: 1, position: { x: 120, y: 0 } }];
const far: AimTarget[] = [{ id: 1, position: { x: 900, y: 0 } }];
const blast: AbilityLoadout = { kind: "arcaneBlast", tier: 0 };
const cry: AbilityLoadout = { kind: "battleCry", tier: 0 };
const SHOT = 300;

describe("Full auto uses the ability by itself (D-099)", () => {
  it("casts an aimed ability at the closest enemy in reach, without Space", () => {
    expect(
      abilityIntent("fullAuto", false, blast, cursor, at, near, SHOT),
    ).toEqual({ x: 120, y: 0 });
    expect(
      abilityIntent("fullAuto", false, blast, cursor, at, far, SHOT),
    ).toBeNull();
  });

  it("casts buffs too when an enemy is within shot range", () => {
    expect(
      abilityIntent("fullAuto", false, cry, cursor, at, near, SHOT),
    ).toEqual({ x: 0, y: 0 });
    expect(
      abilityIntent("fullAuto", false, cry, cursor, at, far, SHOT),
    ).toBeNull();
  });

  it("never auto-casts a movement ability", () => {
    const original = ABILITIES.arcaneBlast.movement;
    ABILITIES.arcaneBlast.movement = true; // stand-in until a movement ability exists
    try {
      expect(
        abilityIntent("fullAuto", false, blast, cursor, at, near, SHOT),
      ).toBeNull();
      expect(
        abilityIntent("fullAuto", true, blast, cursor, at, near, SHOT),
      ).toEqual({ x: 120, y: 0 });
    } finally {
      ABILITIES.arcaneBlast.movement = original;
    }
  });

  it("Space still casts with no enemy near: aimed at the cursor, buffs on you", () => {
    expect(
      abilityIntent("fullAuto", true, blast, cursor, at, far, SHOT),
    ).toEqual({ x: 0, y: -100 });
    expect(abilityIntent("fullAuto", true, cry, cursor, at, [], SHOT)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("the other modes need Space (D-099)", () => {
  it("Auto aim: Space casts at the closest enemy in reach, else the cursor; nothing without Space", () => {
    expect(
      abilityIntent("autoAim", false, blast, cursor, at, near, SHOT),
    ).toBeNull();
    expect(
      abilityIntent("autoAim", true, blast, cursor, at, near, SHOT),
    ).toEqual({ x: 120, y: 0 });
    expect(
      abilityIntent("autoAim", true, blast, cursor, at, far, SHOT),
    ).toEqual({ x: 0, y: -100 });
  });

  it("Auto fire and Manual: Space casts at the cursor", () => {
    for (const mode of ["autoFire", "manual"] as const) {
      expect(
        abilityIntent(mode, false, blast, cursor, at, near, SHOT),
      ).toBeNull();
      expect(abilityIntent(mode, true, blast, cursor, at, near, SHOT)).toEqual({
        x: 0,
        y: -100,
      });
      expect(abilityIntent(mode, true, cry, cursor, at, [], SHOT)).toEqual({
        x: 0,
        y: 0,
      });
    }
  });

  it("nothing without an ability item", () => {
    expect(
      abilityIntent("fullAuto", true, null, cursor, at, near, SHOT),
    ).toBeNull();
  });
});

describe("Full auto shooting is like Auto aim", () => {
  it("fires at the closest enemy in range, holds fire otherwise", () => {
    expect(resolveFireIntent("fullAuto", cursor, at, near, SHOT)).toEqual({
      trigger: true,
      aim: { x: 1, y: 0 },
    });
    expect(resolveFireIntent("fullAuto", cursor, at, far, SHOT).trigger).toBe(
      false,
    );
  });
});
