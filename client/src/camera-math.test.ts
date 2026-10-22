import { describe, expect, it } from "vitest";
import {
  MIN_VISIBLE_WORLD_PX,
  meetsVisibilityTarget,
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
