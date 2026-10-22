import { describe, expect, it } from "vitest";
import {
  MIN_VISIBLE_WORLD_PX,
  meetsVisibilityTarget,
  screenToWorld,
  stepViewRotation,
  visibleExtentFromCenter,
} from "./camera-math";
import { LAYOUT } from "./layout";

describe("visibleExtentFromCenter", () => {
  it("shows 360 × 320 world pixels from center in the approved 720×640 viewport at zoom 1", () => {
    const extent = visibleExtentFromCenter(
      LAYOUT.gameplay.width,
      LAYOUT.gameplay.height,
      1,
    );
    expect(extent).toEqual({ horizontal: 360, vertical: 320 });
    expect(meetsVisibilityTarget(extent)).toBe(true);
  });

  it("halves the visible world when zoom doubles", () => {
    const extent = visibleExtentFromCenter(720, 640, 2);
    expect(extent).toEqual({ horizontal: 180, vertical: 160 });
    expect(meetsVisibilityTarget(extent)).toBe(false);
  });

  it("rejects zero, negative, and non-finite zoom", () => {
    expect(() => visibleExtentFromCenter(720, 640, 0)).toThrow(RangeError);
    expect(() => visibleExtentFromCenter(720, 640, -1)).toThrow(RangeError);
    expect(() => visibleExtentFromCenter(720, 640, Number.NaN)).toThrow(
      RangeError,
    );
    expect(() =>
      visibleExtentFromCenter(720, 640, Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });

  it("rejects negative viewport sizes", () => {
    expect(() => visibleExtentFromCenter(-1, 640, 1)).toThrow(RangeError);
  });
});

describe("meetsVisibilityTarget", () => {
  it("passes exactly at the 300-pixel boundary", () => {
    expect(meetsVisibilityTarget({ horizontal: 300, vertical: 300 })).toBe(
      true,
    );
  });

  it("fails if either axis is short, even by a fraction", () => {
    expect(meetsVisibilityTarget({ horizontal: 360, vertical: 299.5 })).toBe(
      false,
    );
    expect(meetsVisibilityTarget({ horizontal: 299.5, vertical: 320 })).toBe(
      false,
    );
  });

  it("uses the approved 300-pixel minimum by default", () => {
    expect(MIN_VISIBLE_WORLD_PX).toBe(300);
  });
});

describe("stepViewRotation", () => {
  const none = { left: false, right: false, reset: false };
  const deg = (r: number) => (r * 180) / Math.PI;

  it("does not change without Q/E", () => {
    expect(stepViewRotation(1, none, 1)).toBe(1);
  });

  it("turns 120° per second with Q (left = positive)", () => {
    expect(deg(stepViewRotation(0, { ...none, left: true }, 1))).toBeCloseTo(
      120,
      9,
    );
  });

  it("wraps into [0, 360°) both ways", () => {
    expect(deg(stepViewRotation(0, { ...none, right: true }, 0.5))).toBeCloseTo(
      300,
      9,
    );
    expect(deg(stepViewRotation(0, { ...none, left: true }, 3.5))).toBeCloseTo(
      60,
      9,
    );
  });

  it("cancels when Q and E are both held", () => {
    expect(
      stepViewRotation(0.5, { left: true, right: true, reset: false }, 1),
    ).toBe(0.5);
  });

  it("resets to north with Z, even while turning", () => {
    expect(
      stepViewRotation(2, { left: true, right: false, reset: true }, 1),
    ).toBe(0);
  });

  it("ignores negative and NaN frame times", () => {
    expect(stepViewRotation(1, { ...none, left: true }, -1)).toBe(1);
    expect(stepViewRotation(1, { ...none, left: true }, Number.NaN)).toBe(1);
  });
});

describe("visibility under rotation", () => {
  it("still sees ≥300 px in every world direction at any angle", () => {
    // The viewport contains a circle of radius min(360, 320) = 320 around its
    // center, and rotation only turns the world inside that circle.
    const extent = visibleExtentFromCenter(720, 640, 1);
    expect(Math.min(extent.horizontal, extent.vertical)).toBeGreaterThanOrEqual(
      MIN_VISIBLE_WORLD_PX,
    );
  });
});

describe("screenToWorld", () => {
  const view = { width: 720, height: 640 };
  const center = { x: 1000, y: 1000 };

  it("maps the canvas center to the camera center", () => {
    const p = screenToWorld({ x: 360, y: 320 }, view, center, 1.1, 1);
    expect(p.x).toBeCloseTo(1000, 9);
    expect(p.y).toBeCloseTo(1000, 9);
  });

  it("is a plain offset with no rotation at zoom 1", () => {
    expect(screenToWorld({ x: 460, y: 300 }, view, center, 0, 1)).toEqual({
      x: 1100,
      y: 980,
    });
  });

  it("undoes rotation: 'up the screen' at 90° is world west", () => {
    // Camera rotation +90° draws world west (-1, 0) as screen up.
    const p = screenToWorld({ x: 360, y: 220 }, view, center, Math.PI / 2, 1);
    expect(p.x).toBeCloseTo(900, 9);
    expect(p.y).toBeCloseTo(1000, 9);
  });

  it("undoes zoom", () => {
    const p = screenToWorld({ x: 460, y: 320 }, view, center, 0, 2);
    expect(p.x).toBeCloseTo(1050, 9);
  });
});
