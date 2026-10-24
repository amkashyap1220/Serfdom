import { describe, expect, it } from "vitest";
import { directionFromAngle, spriteKeyFromPath } from "./sprites";
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

describe("lichPose (cosmetic, D-129)", () => {
  it("spins in its attack pose by the server's angle", () => {
    expect(lichPose({ spinning: true, facing: 0 })).toEqual({
      state: "attacking",
      direction: "east",
    });
    expect(lichPose({ spinning: true, facing: Math.PI / 4 }).direction).toBe(
      "south-east",
    );
  });

  it("otherwise stands idle, facing the way the server says", () => {
    expect(lichPose({ spinning: false, facing: Math.PI })).toEqual({
      state: "idle",
      direction: "west",
    });
    expect(lichPose({ spinning: false, facing: null }).direction).toBe("south");
  });
});
