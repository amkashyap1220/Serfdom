import type { Rect, Vec2 } from "@serfdom/shared";
import { RemoteInterpolator } from "./interpolation";
import { Connection, type SnapshotMessage } from "./net";
import { MovementPredictor } from "./prediction";

/**
 * Glue between the network and the game loop (Phase 4b):
 * - the local player's position comes from the predictor, corrected by the
 *   server's snapshots;
 * - other players' positions come from the interpolator.
 *
 * "Online" means connected *and* the server has told us where we are at
 * least once; before that the game uses plain local movement.
 */
export class NetSync {
  readonly connection: Connection;
  readonly predictor: MovementPredictor;
  private readonly remotes = new RemoteInterpolator();
  private synced = false;

  constructor(start: Vec2, walls: readonly Rect[]) {
    this.predictor = new MovementPredictor(start, walls);
    this.connection = new Connection({
      onSnapshot: (s, t) => this.onSnapshot(s, t),
      onDisconnect: () => {
        this.synced = false;
        this.remotes.clear();
      },
    });
  }

  get online(): boolean {
    return this.synced && this.connection.snapshot.status.kind === "connected";
  }

  /** One simulation tick while online: move locally now, tell the server. */
  tick(move: Vec2): void {
    const input = this.predictor.predict(move);
    this.connection.sendInput(input.seq, input.move);
  }

  /** Where to draw other players right now. */
  remotePositions(nowMs: number): Map<number, Vec2> {
    return this.online ? this.remotes.sample(nowMs) : new Map();
  }

  private onSnapshot(snapshot: SnapshotMessage, receivedAtMs: number): void {
    const status = this.connection.snapshot.status;
    if (status.kind !== "connected") return;
    const others = new Map<number, Vec2>();
    for (const p of snapshot.players) {
      if (p.id === status.playerId) {
        if (this.synced) {
          this.predictor.reconcile({ x: p.x, y: p.y }, p.ack);
        } else {
          // First word from the server: adopt its position outright.
          this.predictor.reset({ x: p.x, y: p.y });
          this.synced = true;
        }
      } else {
        others.set(p.id, { x: p.x, y: p.y });
      }
    }
    this.remotes.push(receivedAtMs, others);
  }
}
