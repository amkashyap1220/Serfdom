import type { PlayerInput, Vec2 } from "@serfdom/shared";

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
 * (ticks elapsed + MAX_MOVE_CREDIT) inputs — so never faster movement or
 * fire rate than allowed, however many messages they send.
 */
export const MAX_MOVE_CREDIT = 4;

/**
 * Per-player queue of intents (T-023, D-043). The server never accepts a
 * position or a hit from a client; it decides here which of the player's
 * inputs to apply this tick, then runs them through the shared sim.
 *
 * Mutated in place: per-session server state, owned by GameServer.
 */
export interface InputQueue {
  pending: { seq: number; input: PlayerInput }[];
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

export function newInputQueue(): InputQueue {
  return { pending: [], lastReceivedSeq: -1, ack: -1, credit: 0 };
}

/**
 * Queues one input. Seq numbers must strictly increase (replays and
 * reordering are rejected). If the queue is full the input is dropped but
 * still counts as received.
 */
export function queueInput(
  q: InputQueue,
  seq: number,
  input: PlayerInput,
  maxQueued: number,
): QueueResult {
  if (seq <= q.lastReceivedSeq) {
    return { kind: "rejected", reason: "input seq must increase" };
  }
  q.lastReceivedSeq = seq;
  if (q.pending.length >= maxQueued) return { kind: "dropped" };
  q.pending.push({
    seq,
    input: {
      move: clampToUnit(input.move),
      fire: {
        trigger: input.fire.trigger,
        aim: input.fire.aim ? normalize(input.fire.aim) : null,
      },
    },
  });
  return { kind: "queued" };
}

/**
 * One server tick for one player: earn a credit, take queued inputs while
 * credit lasts (oldest first), then drop any backlog beyond
 * MAX_INPUT_BACKLOG. Returns the inputs to apply, in order. With nothing
 * queued the player simply does nothing this tick (no extrapolation).
 */
export function takeInputsForTick(q: InputQueue): {
  apply: PlayerInput[];
  dropped: number;
} {
  q.credit = Math.min(q.credit + 1, MAX_MOVE_CREDIT);
  const apply: PlayerInput[] = [];
  while (q.credit >= 1 && q.pending.length > 0) {
    const next = q.pending.shift()!;
    apply.push(next.input);
    q.ack = next.seq;
    q.credit -= 1;
  }
  let dropped = 0;
  while (q.pending.length > MAX_INPUT_BACKLOG) {
    q.ack = q.pending.shift()!.seq;
    dropped++;
  }
  return { apply, dropped };
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

/** Exactly unit length (the parser already checked it is within 1e-6 of 1). */
function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return { x: v.x / len, y: v.y / len };
}
