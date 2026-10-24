import { directionFromAngle, type Direction } from "./sprites";

export interface LichPose {
  state: "idle" | "attacking";
  direction: Direction;
}

/**
 * Which Lich image to show (cosmetic only; the server decides the fight).
 * It spins only while it attacks, turning with its spiral; otherwise it
 * stands idle facing the nearest player. The server picks both, so every
 * player sees the same (D-129).
 */
export function lichPose(input: {
  /** The snapshot's `spinning`. */
  spinning: boolean;
  /** The snapshot's `facing`, turned to screen space; null if unknown. */
  facing: number | null;
}): LichPose {
  return {
    state: input.spinning ? "attacking" : "idle",
    // South, toward the viewer, until the server says otherwise.
    direction: directionFromAngle(input.facing ?? Math.PI / 2),
  };
}
