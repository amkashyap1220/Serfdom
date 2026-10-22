import { describe, expect, it } from "vitest";
import { consumeFixedSteps } from "./fixed-step.ts";

const STEP = 1 / 60;
const MAX = 0.25;

describe("consumeFixedSteps", () => {
  it("runs one step for one step's worth of time", () => {
    const r = consumeFixedSteps(0, STEP, STEP, MAX);
    expect(r.steps).toBe(1);
    expect(r.remainder).toBeCloseTo(0, 12);
  });

  it("carries partial time into the next frame (144 Hz display)", () => {
    const frame = 1 / 144;
    const a = consumeFixedSteps(0, frame, STEP, MAX);
    expect(a.steps).toBe(0);
    const b = consumeFixedSteps(a.remainder, frame, STEP, MAX);
    expect(b.steps).toBe(0);
    const c = consumeFixedSteps(b.remainder, frame, STEP, MAX);
    expect(c.steps).toBe(1); // 3/144 s ≥ 1/60 s
  });

  it("does not lose a step to floating-point error", () => {
    expect(consumeFixedSteps(0, 3 * STEP, STEP, MAX).steps).toBe(3);
  });

  it("caps a long stall at the max frame time", () => {
    const r = consumeFixedSteps(0, 5, STEP, MAX);
    expect(r.steps).toBe(15); // 0.25 s × 60
  });

  it("treats negative and NaN frame times as zero", () => {
    expect(consumeFixedSteps(0, -1, STEP, MAX).steps).toBe(0);
    expect(consumeFixedSteps(0, Number.NaN, STEP, MAX).steps).toBe(0);
  });

  it("rejects a non-positive step size", () => {
    expect(() => consumeFixedSteps(0, STEP, 0, MAX)).toThrow(RangeError);
  });
});
