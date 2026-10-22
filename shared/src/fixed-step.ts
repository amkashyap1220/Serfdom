/**
 * Fixed-timestep accumulator.
 *
 * Rendered frames arrive at whatever rate the display runs (60, 144 Hz…) and
 * with jitter. The simulation instead advances in equal steps so movement is
 * identical on every machine and can later match the server. Each frame adds
 * its elapsed time; whole steps are run and the remainder carries over.
 */
export interface FixedStepResult {
  /** Number of fixed steps to simulate this frame. */
  steps: number;
  /** Leftover time (seconds) to carry into the next frame. */
  remainder: number;
}

export function consumeFixedSteps(
  carriedSeconds: number,
  frameSeconds: number,
  stepSeconds: number,
  maxFrameSeconds: number,
): FixedStepResult {
  if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
    throw new RangeError(
      `stepSeconds must be finite and > 0, got ${stepSeconds}`,
    );
  }
  // Bad or negative frame times (clock hiccups) count as zero, and very long
  // frames are capped, so a stall never causes a burst of catch-up movement.
  const frame = Number.isFinite(frameSeconds)
    ? Math.min(Math.max(frameSeconds, 0), maxFrameSeconds)
    : 0;
  const total = Math.max(carriedSeconds, 0) + frame;
  // Small epsilon so float error (e.g. 3 × 1/60 summing to 0.04999…) does
  // not drop a step.
  const steps = Math.floor(total / stepSeconds + 1e-9);
  return { steps, remainder: Math.max(total - steps * stepSeconds, 0) };
}
