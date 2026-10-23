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
  PLAYER_REGEN,
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
  DUMMY,
  ENEMY_KINDS,
  ENEMY_STATS,
  BRUTE,
  GRUNT,
  isEnemyKind,
  SLINGER,
  WARLORD,
  type EnemyKind,
} from "./enemy-config.ts";
export {
  enemyAct,
  isTelegraphing,
  overlaps,
  toward,
  type AiTarget,
} from "./enemy-ai.ts";
export {
  damageEnemy,
  isAlive,
  newEnemy,
  ringDirections,
  scaleEnemyForParty,
  stepRespawn,
  type EnemyAi,
  type EnemyState,
} from "./enemy.ts";
export {
  dungeonInfo,
  DUNGEONS,
  isDungeonId,
  LISTED_DUNGEONS,
  MAX_PARTY_SIZE,
  type DungeonId,
  type DungeonInfo,
} from "./dungeons.ts";
export {
  contains,
  PORTAL_RADIUS,
  roomAt,
  validateLayout,
  wallsAroundRooms,
  WALL_THICKNESS,
  type DoorDef,
  type DungeonLayout,
  type EnemySpawnDef,
  type RoomDef,
} from "./dungeon-layout.ts";
export {
  blockingWalls,
  closedDoorIds,
  requiredRoomsCleared,
  newRunProgress,
  stepRooms,
  type RoomEvent,
  type RoomProgress,
  type RoomStatus,
  type RunProgress,
} from "./dungeon-run.ts";
export { GOBLIN_WARRENS } from "./goblin-warrens.ts";
export {
  newRunStats,
  recordRunEvents,
  RUN_RESULTS,
  type RunResult,
  type RunStats,
} from "./run-stats.ts";
export {
  addPlayer,
  aimTargets,
  applyPlayerInput,
  createSimState,
  findPlayer,
  isPlayerAlive,
  newPlayer,
  removePlayer,
  spawnEnemies,
  stepSim,
  stepWorld,
  type EnemySpawn,
  type Hazard,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type SimOptions,
  type SimState,
} from "./sim.ts";
export {
  EXTRA_PLAYER_HP_FACTOR,
  partyHpMultiplier,
  rescaleHp,
  scaledMaxHp,
} from "./party-scaling.ts";
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
  roundCoord,
  type FireInput,
  type SnapshotEnemy,
  type SnapshotHazard,
  type SnapshotPlayer,
  type SnapshotProjectile,
} from "./protocol.ts";
export {
  DUMMY_POSITIONS,
  PLAYER_START,
  TEST_WALLS,
  TEST_WORLD,
} from "./test-world.ts";
export {
  isValidRoll,
  PLACEHOLDER_ROLL_MAX,
  type PlaceholderReward,
} from "./reward.ts";
export {
  EMAIL_MAX,
  emailProblem,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
} from "./account-rules.ts";
