import { LICH } from "@serfdom/shared";
import { directionFromAngle, type Direction } from "./sprites";

export interface LichPose {
  state: "idle" | "attacking";
  direction: Direction;
}

/**
 * Which Lich image to show (cosmetic only; the server decides the fight).
 * While it pours out its spiral it spins in its attack pose at the spiral's
 * own turn rate (faster once enraged); warded or stunned it stops attacking
 * and looks at the player. PROVISIONAL mapping, chosen by Claude.
 */
export function lichPose(input: {
  /** Warded behind its crystals (the snapshot's `faded`). */
  faded: boolean;
  /** Stunned after its crystals break (the snapshot's `dazed`). */
  dazed: boolean;
  hp: number;
  maxHp: number;
  /** Screen angle from the Lich to the local player, radians. */
  towardPlayer: number;
  /** Any steadily increasing clock, in seconds. */
  seconds: number;
}): LichPose {
  if (input.faded || input.dazed) {
    return { state: "idle", direction: directionFromAngle(input.towardPlayer) };
  }
  const enraged = input.hp / input.maxHp < LICH.wardBelow[1]!;
  const { degreesPerSecond } = enraged ? LICH.finalSpiral : LICH.spiral;
  // Same way round as the spiral: clockwise on screen.
  const spin = ((degreesPerSecond * Math.PI) / 180) * input.seconds;
  return { state: "attacking", direction: directionFromAngle(spin) };
}
