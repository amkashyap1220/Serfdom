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
export {
  DUMMY_ENEMY,
  ENEMY_RING_ATTACK,
  PLAYER_HEALTH,
  PLAYER_WEAPON,
} from "./combat-config.ts";
export { applyDamage } from "./health.ts";
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
export {
  damageEnemy,
  isAlive,
  ringDirections,
  stepRespawn,
  type EnemyState,
} from "./enemy.ts";
export {
  aimTargets,
  createSimState,
  isPlayerAlive,
  stepSim,
  type PlayerState,
  type SimEvent,
  type SimState,
  type TickInput,
} from "./sim.ts";
export {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  MAX_SERVER_MESSAGE_BYTES,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ParseResult,
  type ServerMessage,
  type SnapshotPlayer,
} from "./protocol.ts";
export {
  DUMMY_POSITIONS,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "./test-world.ts";
