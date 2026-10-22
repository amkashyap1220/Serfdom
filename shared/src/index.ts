export type { Rect, Size, Vec2 } from "./geometry.ts";
export { consumeFixedSteps, type FixedStepResult } from "./fixed-step.ts";
export {
  directionFromInput,
  NO_INPUT,
  stepMovement,
  type MoveInput,
} from "./movement.ts";
export {
  MAX_FRAME_SECONDS,
  PLAYER_BODY,
  PLAYER_SPEED,
  TICK_RATE,
  TICK_SECONDS,
} from "./movement-config.ts";
