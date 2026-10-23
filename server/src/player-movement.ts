import {
  PLAYER_BODY,
  PLAYER_SPEED,
  stepMovement,
  type Rect,
  type Vec2,
} from "@serfdom/shared";

/**
 * Most inputs a player may have waiting after a tick. Anything older is
 * dropped: a waiting input only adds delay for everyone watching (D-042),
 * and the sender's prediction corrects itself from the next snapshot.
 *
 * 1, not 2: client and server tick at the same rate, so nothing drains a
 * backlog except this limit; measured in 4c, a limit of 2 let the queue
 * ratchet up to 2 (~33 ms of permanent extra delay).
 */
export const MAX_INPUT_BACKLOG = 1;

/**
 * Catch-up allowance. Each tick earns one "move credit" (saved up to this
 * many); applying an input spends one. After a hiccup (a tick with no input
 * followed by two at once) the server can apply both and keep up, yet over
 * any stretch of time a player can never be applied more than
 * (ticks elapsed + MAX_MOVE_CREDIT) inputs — i.e. never faster than
 * PLAYER_SPEED, however many messages they send.
 */
export const MAX_MOVE_CREDIT = 4;

/**
 * Server-side movement state for one connected player (T-023). The server
 * never accepts a position from a client: it queues movement *intents* and
 * applies them with the shared movement rule.
 *
 * Mutated in place: this is per-session server state, owned by GameServer.
 */
export interface PlayerMovement {
  position: Vec2;
  queue: { seq: number; move: Vec2 }[];
  /** Highest seq received (accepted or dropped); -1 before the first input. */
  lastReceivedSeq: number;
  /**
   * Every input with seq <= ack has been processed (applied or dropped).
   * Sent back as `ack` in snapshots so the client knows what to stop replaying.
   */
  ack: number;
  /** Unspent move credit (see MAX_MOVE_CREDIT). */
  credit: number;
}

export type QueueResult =
  | { kind: "queued" }
  | { kind: "dropped" }
  | { kind: "rejected"; reason: string };

export function newPlayerMovement(spawn: Vec2): PlayerMovement {
  return {
    position: { ...spawn },
    queue: [],
    lastReceivedSeq: -1,
    ack: -1,
    credit: 0,
  };
}

/**
 * Queues one input. Seq numbers must strictly increase (replays and
 * reordering are rejected). If the queue is full the input is dropped but
 * still counts as received.
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

/**
 * One server tick for one player: earn a move credit, apply queued inputs
 * while credit lasts, then drop any backlog beyond MAX_INPUT_BACKLOG.
 * With no input queued the player stands still (no extrapolation).
 */
export function applyInputsForTick(
  pm: PlayerMovement,
  walls: readonly Rect[],
  dtSeconds: number,
): { applied: number; dropped: number } {
  pm.credit = Math.min(pm.credit + 1, MAX_MOVE_CREDIT);
  let applied = 0;
  while (pm.credit >= 1 && pm.queue.length > 0) {
    const input = pm.queue.shift()!;
    pm.position = stepMovement(
      pm.position,
      input.move,
      PLAYER_BODY,
      walls,
      dtSeconds,
      PLAYER_SPEED,
    );
    pm.ack = input.seq;
    pm.credit -= 1;
    applied++;
  }
  let dropped = 0;
  while (pm.queue.length > MAX_INPUT_BACKLOG) {
    pm.ack = pm.queue.shift()!.seq;
    dropped++;
  }
  return { applied, dropped };
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
