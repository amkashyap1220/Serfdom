import {
  PLAYER_BODY,
  PLAYER_SPEED,
  stepMovement,
  type Rect,
  type Vec2,
} from "@serfdom/shared";

/**
 * Server-side movement state for one connected player (T-023). The server
 * never accepts a position from a client: it queues movement *intents* and
 * applies at most one per simulation tick, so a client cannot move faster
 * than PLAYER_SPEED by sending more messages.
 *
 * Mutated in place: this is per-session server state, owned by GameServer.
 */
export interface PlayerMovement {
  position: Vec2;
  queue: { seq: number; move: Vec2 }[];
  /** Highest seq received (accepted or dropped); -1 before the first input. */
  lastReceivedSeq: number;
  /** Highest seq actually applied; sent back as `ack` in snapshots. */
  ack: number;
}

export type QueueResult =
  | { kind: "queued" }
  | { kind: "dropped" }
  | { kind: "rejected"; reason: string };

export function newPlayerMovement(spawn: Vec2): PlayerMovement {
  return { position: { ...spawn }, queue: [], lastReceivedSeq: -1, ack: -1 };
}

/**
 * Queues one input. Seq numbers must strictly increase (replays and
 * reordering are rejected). If the queue is full the input is dropped but
 * still counts as received; the client's prediction is corrected by the
 * next snapshot.
 */
export function queueInput(
  pm: PlayerMovement,
  seq: number,
  move: Vec2,
  maxQueued: number,
): QueueResult {
  if (seq <= pm.lastReceivedSeq) {
    return { kind: "rejected", reason: "input seq must increase" };
  }
  pm.lastReceivedSeq = seq;
  if (pm.queue.length >= maxQueued) return { kind: "dropped" };
  pm.queue.push({ seq, move: clampToUnit(move) });
  return { kind: "queued" };
}

/** Applies the oldest queued input for one tick; with no input, the player stands still. */
export function applyNextInput(
  pm: PlayerMovement,
  walls: readonly Rect[],
  dtSeconds: number,
): void {
  const input = pm.queue.shift();
  if (!input) return;
  pm.position = stepMovement(
    pm.position,
    input.move,
    PLAYER_BODY,
    walls,
    dtSeconds,
    PLAYER_SPEED,
  );
  pm.ack = input.seq;
}

/**
 * The protocol parser allows a hair over length 1 for JSON rounding;
 * normalize anything longer so the movement rule can never see a vector
 * that would exceed full speed.
 */
export function clampToUnit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 1 ? { x: v.x / len, y: v.y / len } : { x: v.x, y: v.y };
}
