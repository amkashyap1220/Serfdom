import { describe, expect, it } from "vitest";
import { fitWindow, MIN_SCALE } from "./window-fit";

describe("fitting the game box to the window (D-159)", () => {
  it("is 1:1 at exactly 1200×800", () => {
    expect(fitWindow(1200, 800)).toEqual({
      scale: 1,
      left: 0,
      top: 0,
      tooSmall: false,
    });
  });

  it("never grows past 1200×800: a bigger window gets plain margins, centred", () => {
    const fit = fitWindow(1920, 1080);
    expect(fit.scale).toBe(1);
    expect(fit.left).toBe(360);
    expect(fit.top).toBe(140);
    expect(fit.tooSmall).toBe(false);
  });

  it("shrinks for a smaller window down to 900×600", () => {
    const laptop = fitWindow(1366, 768);
    expect(laptop.scale).toBeCloseTo(0.96);
    expect(laptop.left).toBe(107);
    expect(fitWindow(900, 600)).toMatchObject({ scale: 0.75, tooSmall: false });
  });

  it("below 900×600 it stops shrinking and asks for a bigger window", () => {
    expect(fitWindow(800, 600)).toMatchObject({
      scale: MIN_SCALE,
      left: 0,
      tooSmall: true,
    });
    expect(fitWindow(1600, 500).tooSmall).toBe(true);
  });
});
