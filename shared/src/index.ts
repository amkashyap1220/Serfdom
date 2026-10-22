export { rotateVec, type Rect, type Size, type Vec2 } from "./geometry.ts";
export { boxAround, segmentHitTime } from "./collision.ts";
export { consumeFixedSteps, type FixedStepResult } from "./fixed-step.ts";
export {
  directionFromInput,
  worldDirectionFromInput,
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
export { DUMMY_ENEMY, PLAYER_WEAPON } from "./combat-config.ts";
export {
  stepProjectile,
  type HitTarget,
  type Projectile,
  type ProjectileOutcome,
} from "./projectile.ts";
export {
  aimDirection,
  closestTargetInRange,
  FIRE_MODE_LABELS,
  FIRE_MODES,
  NO_FIRE,
  nextFireMode,
  resolveFireIntent,
  stepFireCooldown,
  type AimTarget,
  type FireIntent,
  type FireMode,
  type PointerState,
} from "./weapon.ts";
export { damageEnemy, isAlive, stepRespawn, type EnemyState } from "./enemy.ts";
export {
  aimTargets,
  createSimState,
  stepSim,
  type SimEvent,
  type SimState,
  type TickInput,
} from "./sim.ts";
