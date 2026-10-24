import { describe, expect, it } from "vitest";
import { DIRECTIONS, directionFromAngle, spriteKeyFromPath } from "./sprites";
import { lichPose } from "./lich-pose";

describe("sprite files", () => {
  it("keys a file by character, state, and direction", () => {
    expect(
      spriteKeyFromPath("./assets/sprites/lich/attacking/north-east.png"),
    ).toBe("sprite-lich-attacking-north-east");
  });

  it("refuses a file outside the layout or with an unknown direction", () => {
    expect(spriteKeyFromPath("./assets/sprites/lich/south.png")).toBe(
      undefined,
    );
    expect(spriteKeyFromPath("./assets/sprites/lich/idle/up.png")).toBe(
      undefined,
    );
    expect(spriteKeyFromPath("./assets/sprites/lich/Idle/south.png")).toBe(
      undefined,
    );
  });
});

describe("directionFromAngle", () => {
  it("picks the nearest of 8 directions, screen y down", () => {
    expect(directionFromAngle(0)).toBe("east");
    expect(directionFromAngle(Math.PI / 2)).toBe("south");
    expect(directionFromAngle(-Math.PI / 2)).toBe("north");
    expect(directionFromAngle(Math.PI)).toBe("west");
    expect(directionFromAngle((3 * Math.PI) / 4)).toBe("south-west");
    // 20° is still east; 25° is past the halfway mark to south-east.
    expect(directionFromAngle((20 * Math.PI) / 180)).toBe("east");
    expect(directionFromAngle((25 * Math.PI) / 180)).toBe("south-east");
    // Any number of whole turns either way.
    expect(directionFromAngle(-4 * Math.PI + 0.1)).toBe("east");
    expect(directionFromAngle(9 * Math.PI)).toBe("west");
  });
});

describe("lichPose (cosmetic)", () => {
  const base = {
    faded: false,
    dazed: false,
    hp: 11000,
    maxHp: 11000,
    towardPlayer: Math.PI / 2,
    seconds: 0,
  };

  it("spins clockwise in its attack pose at the spiral's 90°/s", () => {
    const at = (seconds: number) => lichPose({ ...base, seconds });
    expect(at(0)).toEqual({ state: "attacking", direction: "east" });
    expect(at(0.5)).toEqual({ state: "attacking", direction: "south-east" });
    expect(at(1)).toEqual({ state: "attacking", direction: "south" });
    // One full turn in 4 s visits all 8 directions.
    const seen = new Set(
      Array.from({ length: 8 }, (_, i) => at(i * 0.5).direction),
    );
    expect(seen.size).toBe(DIRECTIONS.length);
  });

  it("spins at 135°/s once enraged (below 30%)", () => {
    const enraged = lichPose({ ...base, hp: 3000, seconds: 1 });
    expect(enraged.direction).toBe("south-west");
  });

  it("warded or stunned, it stops attacking and faces the player", () => {
    expect(lichPose({ ...base, faded: true, seconds: 3 })).toEqual({
      state: "idle",
      direction: "south",
    });
    expect(
      lichPose({ ...base, dazed: true, towardPlayer: Math.PI, seconds: 3 }),
    ).toEqual({ state: "idle", direction: "west" });
  });
});
