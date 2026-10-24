import {
  FORGEMASTER,
  layoutFor,
  sludgePools,
  tidePools,
  tideAt,
  surgeBand,
  SURGE,
  TIDES,
  WHIRLPOOL,
  type DungeonLayout,
  type ServerMessage,
  blockingWalls,
  boxAround,
  combatFor,
  type AbilityLoadout,
  weaponDamage,
  SERF_BASE,
  TICK_SECONDS,
  type BlastKind,
  WARCHIEF,
  KNIGHT,
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
  serverProjectilesToDraw,
  slitViews,
  runeViews,
  type AuraView,
  type BlastView,
  type ChainView,
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

/** How long a blast stays on screen: the sweep's warning lasts its whole windup. */
function blastShowMs(kind: BlastKind): number {
  if (kind === "sweepWarning") return WARCHIEF.sweep.windupSeconds * 1000;
  if (kind === "slamWarning") return KNIGHT.slam.windupSeconds * 1000;
  return BLAST_SHOW_MS;
}

/** How far into the tide cycle's rising stretch `clock` is (0 → 1), for the glow. */
function riseAt(clock: number): number {
  const t = clock % TIDES.periodSeconds;
  const from = TIDES.periodSeconds - TIDES.deepSeconds - TIDES.warnSeconds;
  return Math.min(1, Math.max(0, (t - from) / TIDES.warnSeconds));
}

export class NetSync {
  readonly connection: Connection;
  private predictor: PlayerPredictor | null = null;
  private predictorId: number | null = null;
  private readonly remotes = new RemoteInterpolator();
  private readonly shots = new LocalShots();
  /** Static walls of the current dungeon plus its closed doors. */
  private walls: readonly Rect[] = [];
  private currentDungeon: DungeonId | null = null;
  /** This run's layout, built from the server's seed (D-104). */
  private currentLayout: DungeonLayout | null = null;
  private currentSeed: number | null = null;
  /** Your stats this run, from runStarted (prediction must match the server). */
  private myStats: Stats = SERF_BASE;
  private myWeaponTier: number | null = null;
  /** What Space casts this run, from runStarted (D-092); null = nothing. */
  myAbility: AbilityLoadout | null = null;
  private latest: { snapshot: SnapshotMessage; receivedAtMs: number } | null =
    null;
  private self: SnapshotPlayer | null = null;
  private synced = false;
  private inRun = false;
  /** Blasts the server reported, kept briefly so they can be drawn fading. */
  private blasts: {
    kind: BlastKind;
    x: number;
    y: number;
    radius: number;
    atMs: number;
  }[] = [];
  private chains: { points: { x: number; y: number }[]; atMs: number }[] = [];
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
          this.currentSeed = message.seed;
          this.currentLayout = layoutFor(message.dungeon, message.seed);
          this.myStats = message.stats;
          this.myWeaponTier = message.weaponTier;
          this.myAbility = message.ability;
          // Until the first snapshot says otherwise, every door is closed.
          const layout = this.currentLayout;
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
    this.chains = [];
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

  /** The current run's layout (generated from its seed), or null outside a run. */
  get layout(): DungeonLayout | null {
    return this.inRun ? this.currentLayout : null;
  }

  /** The current run's layout seed, for bug reports (D-104). */
  get seed(): number | null {
    return this.inRun ? this.currentSeed : null;
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
    // Faded ghosts let shots through (D-122), as on the server.
    const targets = this.enemies
      .filter((e) => e.hp > 0 && !e.faded)
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
    projectiles.push(
      ...serverProjectilesToDraw(latest.snapshot.projectiles, selfId, age),
    );
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
      chains: this.chainViews(nowMs),
      auras: this.auraViews(latest.snapshot, nowMs),
      slits: slitViews(this.layout, latest.snapshot.traps),
      runes: runeViews(this.layout, latest.snapshot.runes),
      fires: latest.snapshot.fires.map((f) => ({
        ...f,
        remaining: Math.max(0, f.remaining - age),
      })),
      zones: latest.snapshot.zones.map((z) => ({
        ...z,
        remaining: Math.max(0, z.remaining - age),
      })),
      beams: latest.snapshot.beams.map((b) => ({
        ...b,
        remaining: Math.max(0, b.remaining - age),
      })),
      // Grown on to "now", like projectiles are moved on.
      waves: latest.snapshot.waves.map((w) => {
        const late = Math.max(0, age - w.startsIn);
        const clip = this.layout?.rooms.find((r) => {
          const b = r.bounds;
          return (
            w.x >= b.x &&
            w.x <= b.x + b.width &&
            w.y >= b.y &&
            w.y <= b.y + b.height
          );
        })?.bounds;
        return {
          ...w,
          startsIn: Math.max(0, w.startsIn - age),
          radius: w.radius + FORGEMASTER.wave.speed * late,
          ...(clip ? { clip } : {}),
        };
      }),
      plates: latest.snapshot.plates.map((p) => ({ ...p })),
      // The water, at the clock of "now" (D-135).
      ...this.waterViews(latest.snapshot, age),
      // Frost and breath cones (D-136).
      frost: latest.snapshot.frost.filter((f) => {
        const clock = latest.snapshot.clock + age;
        return clock >= f.from && clock < f.until;
      }),
      cones: latest.snapshot.cones.map((c) => ({
        ...c,
        startsIn: Math.max(0, c.startsIn - age),
      })),
    };
  }

  /** Players currently vanished (drawn faded, D-100). */
  vanishedPlayers(): ReadonlySet<number> {
    const ids = new Set<number>();
    for (const p of this.latest?.snapshot.players ?? []) {
      if (p.buffs.includes("vanish")) ids.add(p.id);
    }
    return ids;
  }

  /** Buffed players' glows at the positions they are drawn at (D-098). */
  private auraViews(snapshot: SnapshotMessage, nowMs: number): AuraView[] {
    const remotes = this.remotePositions(nowMs);
    const auras: AuraView[] = [];
    for (const p of snapshot.players) {
      if (p.buffs.length === 0 || p.hp <= 0) continue;
      const at = p.id === this.self?.id ? this.position : remotes.get(p.id);
      if (at) auras.push({ x: at.x, y: at.y, buffs: p.buffs });
    }
    return auras;
  }

  /** Chain Lightning paths younger than BLAST_SHOW_MS, fading. */
  private chainViews(nowMs: number): ChainView[] {
    this.chains = this.chains.filter((c) => nowMs - c.atMs < BLAST_SHOW_MS);
    return this.chains.map((c) => ({
      points: c.points,
      fade: Math.max(0, (nowMs - c.atMs) / BLAST_SHOW_MS),
    }));
  }

  /**
   * The Sunken Temple's water at "now" (D-135): the snapshot's clock moved
   * on by its age. Tide pools come from the map; whirlpools, surges, and
   * tethers from the snapshot.
   */
  private waterViews(
    snapshot: Extract<ServerMessage, { type: "snapshot" }>,
    age: number,
  ): Pick<CombatViewModel, "tides" | "whirlpools" | "surges" | "tethers"> {
    const clock = snapshot.clock + age;
    const state = tideAt(clock);
    const tides = (this.layout ? tidePools(this.layout) : []).map((r) => ({
      ...r,
      state,
      rise: state === "rising" ? riseAt(clock) : state === "deep" ? 1 : 0,
    }));
    const whirlpools = snapshot.whirlpools.map((w) => ({
      x: w.x,
      y: w.y,
      radius: w.radius,
      warn: Math.min(
        1,
        Math.max(0, 1 - (w.from - clock) / WHIRLPOOL.warnSeconds),
      ),
      active: clock >= w.from && clock < w.until,
    }));
    const surges = snapshot.surges.map((s) => {
      const area = { x: s.x, y: s.y, width: s.width, height: s.height };
      const waiting = s.startsIn - age > 0;
      const pos = waiting
        ? s.pos
        : s.pos + s.dir * SURGE.speed * Math.max(0, age - s.startsIn);
      return {
        band: waiting
          ? null
          : surgeBand({ area, axis: s.axis, dir: s.dir, pos, gaps: s.gaps }),
        axis: s.axis,
        edge: s.pos,
        gaps: s.gaps,
      };
    });
    const me = this.predictor?.position;
    const tethers = snapshot.players
      .filter((p) => p.pull && p.hp > 0)
      .map((p) => {
        const self = this.self?.id === p.id && me;
        return {
          x1: self ? me.x : p.x,
          y1: self ? me.y : p.y,
          x2: p.pull!.x,
          y2: p.pull!.y,
          pulling: clock >= p.pull!.from,
        };
      });
    return { tides, whirlpools, surges, tethers };
  }

  /** Blasts still showing, with how far each has faded. */
  private blastViews(nowMs: number): BlastView[] {
    this.blasts = this.blasts.filter(
      (b) => nowMs - b.atMs < blastShowMs(b.kind),
    );
    return this.blasts.map((b) => ({
      kind: b.kind,
      x: b.x,
      y: b.y,
      radius: b.radius,
      fade: Math.max(0, (nowMs - b.atMs) / blastShowMs(b.kind)),
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
    for (const c of snapshot.chains) {
      this.chains.push({ points: c.points, atMs: receivedAtMs });
    }
    for (const b of snapshot.blasts) {
      this.blasts.push({
        kind: b.kind,
        x: b.x,
        y: b.y,
        radius: b.radius,
        atMs: receivedAtMs,
      });
    }
    if (this.currentLayout) {
      // Doors open during a run: predict against what the server says now.
      this.walls = blockingWalls(this.currentLayout, snapshot.closedDoors);
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
            this.currentLayout ? sludgePools(this.currentLayout) : [],
            this.currentLayout ? tidePools(this.currentLayout) : [],
          );
          this.predictorId = p.id;
          this.synced = false;
        }
        this.predictor.setWater(
          snapshot.clock,
          snapshot.whirlpools.map((w) => ({
            at: { x: w.x, y: w.y },
            radius: w.radius,
            from: w.from,
            until: w.until,
          })),
          snapshot.frost.map((f) => ({
            at: { x: f.x, y: f.y },
            radius: f.radius,
            from: f.from,
            until: f.until,
          })),
        );
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
