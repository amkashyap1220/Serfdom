import {
  blockingWalls,
  boxAround,
  combatFor,
  weaponDamage,
  dungeonInfo,
  SERF_BASE,
  TICK_SECONDS,
  type DungeonId,
  type PlayerInput,
  type Rect,
  type SnapshotEnemy,
  type SnapshotPlayer,
  type Stats,
  type Vec2,
} from "@serfdom/shared";
import {
  EMPTY_VIEW,
  type CombatViewModel,
  type ProjectileView,
  type BlastView,
} from "./combat-view-model";
import { RemoteInterpolator } from "./interpolation";
import { LocalShots } from "./local-shots";
import { Connection, type LobbyMessage, type SnapshotMessage } from "./net";
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
 * "Online" means connected, in a run, *and* the server has told us about
 * ourselves in that run at least once (Phase 6a: no offline play; the menu
 * screens cover the game until then). Every run starts from scratch: new
 * predictor, seq numbers from 0 (the server makes a new input queue too).
 */
/** How long a landed blast stays drawn (presentation only). */
const BLAST_SHOW_MS = 350;

export class NetSync {
  readonly connection: Connection;
  private predictor: PlayerPredictor | null = null;
  private predictorId: number | null = null;
  private readonly remotes = new RemoteInterpolator();
  private readonly shots = new LocalShots();
  /** Static walls of the current dungeon plus its closed doors. */
  private walls: readonly Rect[] = [];
  private currentDungeon: DungeonId | null = null;
  /** Your stats this run, from runStarted (prediction must match the server). */
  private myStats: Stats = SERF_BASE;
  private myWeaponTier: number | null = null;
  private latest: { snapshot: SnapshotMessage; receivedAtMs: number } | null =
    null;
  private self: SnapshotPlayer | null = null;
  private synced = false;
  private inRun = false;
  /** Blasts the server reported, kept briefly so they can be drawn fading. */
  private blasts: { x: number; y: number; radius: number; atMs: number }[] = [];
  /** Forwarded to the screen flow (set by main.ts). */
  onLobby: (message: LobbyMessage, receivedAtMs: number) => void = () => {};
  onConnected: () => void = () => {};
  onDisconnect: (reason: string) => void = () => {};
  /** Size of recent snapshots, for the HUD (bytes) and a 1 s bandwidth average. */
  lastSnapshotBytes = 0;
  private bytesWindow: { atMs: number; bytes: number }[] = [];

  constructor() {
    this.connection = new Connection({
      onSnapshot: (s, t, bytes) => this.onSnapshot(s, t, bytes),
      onDisconnect: (reason) => {
        this.resetRun(false);
        this.onDisconnect(reason);
      },
      onConnected: () => this.onConnected(),
      onLobby: (message, at) => {
        if (message.type === "runStarted") {
          this.resetRun(true);
          this.currentDungeon = message.dungeon;
          this.myStats = message.stats;
          this.myWeaponTier = message.weaponTier;
          // Until the first snapshot says otherwise, every door is closed.
          const layout = dungeonInfo(message.dungeon).layout;
          this.walls = blockingWalls(
            layout,
            layout.doors.map((d) => d.id),
          );
        }
        if (message.type === "runEnded" || message.type === "loggedOut") {
          this.resetRun(false);
        }
        this.onLobby(message, at);
      },
    });
  }

  /** Forget everything about the previous run. */
  private resetRun(inRun: boolean): void {
    this.inRun = inRun;
    this.synced = false;
    this.predictor = null;
    this.predictorId = null;
    this.latest = null;
    this.self = null;
    this.remotes.clear();
    this.shots.clear();
    this.blasts = [];
  }

  get online(): boolean {
    return (
      this.inRun &&
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

  /** The dungeon of the current run, or null outside a run. */
  get dungeon(): DungeonId | null {
    return this.inRun ? this.currentDungeon : null;
  }

  get closedDoors(): readonly string[] {
    return this.latest?.snapshot.closedDoors ?? [];
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

  /** R: leave the run (D-036). The server answers with runEnded. */
  exitDungeon(): void {
    if (this.inRun) this.connection.sendExitDungeon();
  }

  /** Where to draw other players right now. */
  remotePositions(nowMs: number): Map<number, Vec2> {
    return this.online ? this.remotes.sample(nowMs) : new Map();
  }

  /** Enemies and projectiles to draw right now. */
  viewModel(nowMs: number): CombatViewModel {
    const latest = this.latest;
    if (!latest) return EMPTY_VIEW;
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
    return {
      enemies: [...latest.snapshot.enemies],
      projectiles,
      // Count hazards down to "now", like projectiles are moved to "now".
      hazards: latest.snapshot.hazards.map((h) => ({
        ...h,
        landsIn: Math.max(0, h.landsIn - age),
      })),
      portalOpen: latest.snapshot.portalOpen,
      blasts: this.blastViews(nowMs),
    };
  }

  /** Blasts younger than BLAST_SHOW_MS, with how far each has faded. */
  private blastViews(nowMs: number): BlastView[] {
    this.blasts = this.blasts.filter((b) => nowMs - b.atMs < BLAST_SHOW_MS);
    return this.blasts.map((b) => ({
      x: b.x,
      y: b.y,
      radius: b.radius,
      fade: Math.max(0, (nowMs - b.atMs) / BLAST_SHOW_MS),
    }));
  }

  private onSnapshot(
    snapshot: SnapshotMessage,
    receivedAtMs: number,
    bytes: number,
  ): void {
    const status = this.connection.snapshot.status;
    if (status.kind !== "connected" || !this.inRun) return;
    this.latest = { snapshot, receivedAtMs };
    for (const b of snapshot.blasts) {
      this.blasts.push({
        x: b.x,
        y: b.y,
        radius: b.radius,
        atMs: receivedAtMs,
      });
    }
    if (this.currentDungeon) {
      // Doors open during a run: predict against what the server says now.
      this.walls = blockingWalls(
        dungeonInfo(this.currentDungeon).layout,
        snapshot.closedDoors,
      );
      this.predictor?.setWalls(this.walls);
    }
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
        // A new run (or a reconnect with a new guest id) gets a new
        // predictor, and so fresh seqs.
        if (!this.predictor || this.predictorId !== p.id) {
          this.predictor = new PlayerPredictor(
            p.id,
            { x: p.x, y: p.y },
            this.walls,
            combatFor(this.myStats, weaponDamage(this.myWeaponTier)),
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
