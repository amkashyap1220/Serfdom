import {
  PLAYER_BODY,
  PLAYER_SPEED,
  stepMovement,
  TICK_SECONDS,
  type Rect,
  type Vec2,
} from "@serfdom/shared";

export interface PendingInput {
  seq: number;
  move: Vec2;
}

/** Keep at most this many unacknowledged inputs (2 s at 60 Hz) if the server stops answering. */
const MAX_PENDING = 120;

/**
 * Client-side prediction for the local player (T-023).
 *
 * The server is the authority on position, but waiting a round trip before
 * moving would feel sluggish. So each tick the client:
 *   1. applies its own input immediately with the same shared movement rule
 *      the server uses ("prediction"), and
 *   2. remembers that input as pending until the server acknowledges it.
 *
 * When a snapshot arrives saying "you are at P after input #ack", the client
 * jumps to P, forgets inputs up to #ack, and re-applies the still-pending
 * ones on top ("reconciliation"). Because both sides run identical
 * deterministic code, the replayed result normally equals what was already
 * shown, so nothing visibly moves; any difference (dropped input, server
 * correction) is fixed within one snapshot.
 */
export class MovementPredictor {
  private current: Vec2;
  private pending: PendingInput[] = [];
  private nextSeq = 0;
  private readonly walls: readonly Rect[];
  /** Distance the last reconciliation moved the player (0 = prediction was exact). */
  lastCorrection = 0;

  constructor(start: Vec2, walls: readonly Rect[]) {
    this.current = { ...start };
    this.walls = walls;
  }

  get position(): Vec2 {
    return this.current;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Applies one tick of movement locally and returns the input to send to the server. */
  predict(move: Vec2): PendingInput {
    const input = { seq: this.nextSeq++, move: { ...move } };
    this.current = this.step(this.current, input.move);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return input;
  }

  /** Accepts the server's authoritative position after it applied inputs up to `ack`. */
  reconcile(serverPosition: Vec2, ack: number): void {
    this.pending = this.pending.filter((p) => p.seq > ack);
    let replayed = { ...serverPosition };
    for (const p of this.pending) replayed = this.step(replayed, p.move);
    this.lastCorrection = Math.hypot(
      replayed.x - this.current.x,
      replayed.y - this.current.y,
    );
    this.current = replayed;
  }

  /** Starts over from a known position (e.g. after reconnecting). Sequence numbers keep increasing. */
  reset(position: Vec2): void {
    this.current = { ...position };
    this.pending = [];
    this.lastCorrection = 0;
  }

  private step(from: Vec2, move: Vec2): Vec2 {
    return stepMovement(
      from,
      move,
      PLAYER_BODY,
      this.walls,
      TICK_SECONDS,
      PLAYER_SPEED,
    );
  }
}
