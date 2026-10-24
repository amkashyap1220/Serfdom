import { directionFromAngle, type Direction } from "./sprites";

export interface LichPose {
  state: "idle" | "attacking";
  direction: Direction;
}

/**
 * Which Lich image to show (cosmetic only; the server decides the fight).
 * It spins only while it fires its spiral, turning with the spiral itself
 * (the snapshot's `facing`); otherwise it stands idle, looking at the
 * player (D-129).
 */
export function lichPose(input: {
  /** Screen angle of its spiral while it fires, else null. */
  spin: number | null;
  /** Screen angle from the Lich to the local player, radians. */
  towardPlayer: number;
}): LichPose {
  if (input.spin === null) {
    return { state: "idle", direction: directionFromAngle(input.towardPlayer) };
  }
  return { state: "attacking", direction: directionFromAngle(input.spin) };
}
