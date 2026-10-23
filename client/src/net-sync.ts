import {
  boxAround,
  TICK_SECONDS,
  type PlayerInput,
  type Rect,
  type SnapshotEnemy,
  type SnapshotPlayer,
  type Vec2,
} from "@serfdom/shared";
import type { CombatViewModel, ProjectileView } from "./combat-view-model";
import { RemoteInterpolator } from "./interpolation";
import { LocalShots } from "./local-shots";
import { Connection, type SnapshotMessage } from "./net";
import { PlayerPredictor } from "./prediction";

/**
 * Server projectiles are drawn at their estimated *current* position
 * (D-044), extrapolated along their straight path from the last snapshot.
 * Cap the extrapolation so a stalled connection never flings bullets far.
 */
const MAX_EXTRAPOLATION_S = 0.1;

/**
 * Glue between the network and the game loop:
 * - the local player (position, fire timing) comes from the predictor,
 *   corrected by the server; HP always comes from the server;
 * - own shots are drawn locally the moment they fire (D-043);
 * - other players are interpolated; enemies and other projectiles come
 *   from the latest snapshot.
 *
 * "Online" means connected *and* the server has told us about ourselves at
 * least once; before that the game runs its local offline sim.
 */
export class NetSync {
  readonly connection: Connection;
  private predictor: PlayerPredictor | null = null;
  private predictorId: number | null = null;
  private readonly remotes = new RemoteInterpolator();
  private readonly shots = new LocalShots();
  private readonly walls: readonly Rect[];
  private latest: { snapshot: SnapshotMessage; receivedAtMs: number } | null =
    null;
  private self: SnapshotPlayer | null = null;
  private synced = false;
  /** Size of recent snapshots, for the HUD (bytes) and a 1 s bandwidth average. */
  lastSnapshotBytes = 0;
  private bytesWindow: { atMs: number; bytes: number }[] = [];

  constructor(walls: readonly Rect[]) {
    this.walls = walls;
    this.connection = new Connection({
      onSnapshot: (s, t, bytes) => this.onSnapshot(s, t, bytes),
      onDisconnect: () => {
        this.synced = false;
        this.latest = null;
        this.self = null;
        this.remotes.clear();
        this.shots.clear();
      },
    });
  }

  get online(): boolean {
    return (
      this.synced &&
      this.predictor !== null &&
      this.connection.snapshot.status.kind === "connected"
    );
  }

  /** Predicted local position (only meaningful while online). */
  get position(): Vec2 {
    return this.predictor?.position ?? { x: 0, y: 0 };
  }

  get pendingCount(): number {
    return this.predictor?.pendingCount ?? 0;
  }

  get lastCorrection(): number {
    return this.predictor?.lastCorrection ?? 0;
  }

  /** Our authoritative HP etc. from the latest snapshot. */
  get selfState(): SnapshotPlayer | null {
    return this.self;
  }

  get enemies(): readonly SnapshotEnemy[] {
    return this.latest?.snapshot.enemies ?? [];
  }

  /** Received bytes per second over the last second. */
  get bytesPerSecond(): number {
    return this.bytesWindow.reduce((sum, b) => sum + b.bytes, 0);
  }

  /**
   * One tick while online and alive: predict movement and fire locally,
   * tell the server. Returns true if a (predicted) shot fired.
   */
  tick(input: PlayerInput): boolean {
    if (!this.predictor) return false;
    const { seq, shot } = this.predictor.predict(input);
    if (shot) this.shots.add(shot);
    this.connection.sendInput(seq, input);
    return shot !== null;
  }

  /** Advances our own locally drawn shots one tick (they vanish on walls and enemies). */
  stepLocalShots(): void {
    const targets = this.enemies
      .filter((e) => e.hp > 0)
      .map((e) => ({ id: e.id, box: boxAround({ x: e.x, y: e.y }, e.size) }));
    this.shots.step(TICK_SECONDS, this.walls, targets);
  }

  playAgain(): void {
    this.connection.sendPlayAgain();
  }

  /** Where to draw other players right now. */
  remotePositions(nowMs: number): Map<number, Vec2> {
    return this.online ? this.remotes.sample(nowMs) : new Map();
  }

  /** Enemies and projectiles to draw right now. */
  viewModel(nowMs: number): CombatViewModel {
    const latest = this.latest;
    if (!latest) return { enemies: [], projectiles: [] };
    const selfId = this.self?.id;
    const age = Math.min(
      Math.max((nowMs - latest.receivedAtMs) / 1000, 0),
      MAX_EXTRAPOLATION_S,
    );
    const projectiles: ProjectileView[] = [];
    for (const p of latest.snapshot.projectiles) {
      // Our own shots are drawn from local prediction instead.
      if (p.owner === "player" && p.by === selfId) continue;
      projectiles.push({
        owner: p.owner,
        x: p.x + p.dx * p.speed * age,
        y: p.y + p.dy * p.speed * age,
        size: p.size,
      });
    }
    for (const s of this.shots.list) {
      projectiles.push({
        owner: "player",
        x: s.position.x,
        y: s.position.y,
        size: s.size,
      });
    }
    return { enemies: [...latest.snapshot.enemies], projectiles };
  }

  private onSnapshot(
    snapshot: SnapshotMessage,
    receivedAtMs: number,
    bytes: number,
  ): void {
    const status = this.connection.snapshot.status;
    if (status.kind !== "connected") return;
    this.latest = { snapshot, receivedAtMs };
    this.lastSnapshotBytes = bytes;
    this.bytesWindow.push({ atMs: receivedAtMs, bytes });
    while (
      this.bytesWindow[0] &&
      this.bytesWindow[0].atMs < receivedAtMs - 1000
    ) {
      this.bytesWindow.shift();
    }

    const others = new Map<number, Vec2>();
    for (const p of snapshot.players) {
      if (p.id === status.playerId) {
        this.self = p;
        // A reconnect gets a new guest id, so a new predictor (and fresh seqs).
        if (!this.predictor || this.predictorId !== p.id) {
          this.predictor = new PlayerPredictor(
            p.id,
            { x: p.x, y: p.y },
            this.walls,
          );
          this.predictorId = p.id;
          this.synced = false;
        }
        if (this.synced) {
          this.predictor.reconcile(p);
        } else {
          // First word from the server: adopt its state outright.
          this.predictor.reset(p);
          this.synced = true;
        }
      } else if (p.hp > 0) {
        others.set(p.id, { x: p.x, y: p.y });
      }
    }
    this.remotes.push(receivedAtMs, others);
  }
}
