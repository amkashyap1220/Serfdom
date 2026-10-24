import {
  applyPlayerInput,
  combatFor,
  SERF_BASE,
  TICK_SECONDS,
  type PlayerCombat,
  type PlayerInput,
  type PlayerState,
  type Projectile,
  type Rect,
  type SimState,
  type SnapshotPlayer,
  type Vec2,
  type WhirlpoolShape,
  type FrostPatch,
} from "@serfdom/shared";

export interface PendingInput {
  seq: number;
  input: PlayerInput;
}

/** Keep at most this many unacknowledged inputs (2 s at 60 Hz) if the server stops answering. */
const MAX_PENDING = 120;

/**
 * Client-side prediction for the local player (T-023, D-043).
 *
 * The server is the authority on position, HP, and shots, but waiting a
 * round trip before moving or shooting would feel sluggish. So each tick
 * the client:
 *   1. applies its own input immediately with the same shared rule the
 *      server uses (`applyPlayerInput`: movement + fire cooldown), which
 *      also tells it whether a shot fires and from where ("prediction");
 *   2. remembers that input as pending until the server acknowledges it.
 *
 * When a snapshot arrives saying "after input #ack you are here, with this
 * cooldown and HP", the client adopts that, forgets inputs up to #ack, and
 * re-applies the still-pending ones on top ("reconciliation"). Both sides
 * run identical deterministic code, so normally nothing visibly changes.
 * Replayed inputs never spawn shots again; those were drawn the first time.
 */
export class PlayerPredictor {
  private me: PlayerState;
  private pending: PendingInput[] = [];
  private nextSeq = 0;
  private walls: readonly Rect[];
  /**
   * Your speed and fire rate, from the stats in runStarted: the same
   * numbers the server simulates you with (D-077), or prediction drifts.
   */
  private readonly combat: PlayerCombat;
  /** Distance the last reconciliation moved the player (0 = prediction was exact). */
  lastCorrection = 0;
  /**
   * The run clock the server will apply the next input at (D-135): the
   * latest snapshot's clock plus a tick for each input still pending.
   */
  private clock = 0;
  /** The Tide Priest's whirlpools, as the latest snapshot has them. */
  private whirlpools: readonly WhirlpoolShape[] = [];

  /** Frost on the floor (D-136), as the latest snapshot has it. */
  private frost: readonly FrostPatch[] = [];

  /** The latest snapshot's clock, whirlpools, and frost; call before `reconcile` or `reset`. */
  setWater(
    clock: number,
    whirlpools: readonly WhirlpoolShape[],
    frost: readonly FrostPatch[] = [],
  ): void {
    this.snapshotClock = clock;
    this.whirlpools = whirlpools;
    this.frost = frost;
  }
  private snapshotClock = 0;

  constructor(
    id: number,
    start: Vec2,
    walls: readonly Rect[],
    combat: PlayerCombat = combatFor(SERF_BASE),
    /** Sludge pools (D-113): the same slowdown the server applies. */
    private readonly sludge: readonly Rect[] = [],
    /** Tide pools (D-135): deep on the run's tide cycle. */
    private readonly tides: readonly Rect[] = [],
  ) {
    this.combat = combat;
    this.me = {
      id,
      position: { ...start },
      fireCooldown: 0,
      hp: 1,
      maxHp: 1,
      mp: 0,
      combat,
      ability: null,
      abilityCooldown: 0,
      buffs: {},
      velocity: { x: 0, y: 0 },
    };
    this.walls = walls;
  }

  get position(): Vec2 {
    return this.me.position;
  }

  /** Walls to collide with from now on (closed doors open during a run). */
  setWalls(walls: readonly Rect[]): void {
    this.walls = walls;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Applies one tick locally; returns the input to send and the shot it fired, if any. */
  predict(input: PlayerInput): { seq: number; shot: Projectile | null } {
    const seq = this.nextSeq++;
    const { player, shot } = this.step(this.me, input, this.clock);
    this.clock += TICK_SECONDS;
    this.me = player;
    this.pending.push({ seq, input });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return { seq, shot };
  }

  /** Accepts the server's authoritative state for this player after it processed inputs up to `ack`. */
  reconcile(server: SnapshotPlayer): void {
    this.pending = this.pending.filter((p) => p.seq > server.ack);
    let replayed = fromSnapshot(server, this.combat);
    // The input after #ack is applied at the snapshot's clock, the next a
    // tick later, and so on.
    let clock = this.snapshotClock;
    for (const p of this.pending) {
      replayed = this.step(replayed, p.input, clock).player;
      clock += TICK_SECONDS;
    }
    this.clock = clock;
    this.lastCorrection = Math.hypot(
      replayed.position.x - this.me.position.x,
      replayed.position.y - this.me.position.y,
    );
    this.me = replayed;
  }

  /** Adopts the server's state outright (first contact, or after reconnecting). Seq numbers keep increasing. */
  reset(server: SnapshotPlayer): void {
    this.me = fromSnapshot(server, this.combat);
    this.pending = [];
    this.lastCorrection = 0;
    this.clock = this.snapshotClock;
  }

  private step(
    from: PlayerState,
    input: PlayerInput,
    clock: number,
  ): { player: PlayerState; shot: Projectile | null } {
    const solo: SimState = {
      players: [from],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: this.sludge,
      fires: [],
      clock,
      tides: this.tides,
      frost: this.frost,
      whirlpools: this.whirlpools.map((w) => ({
        ...w,
        nextTick: w.from,
        damage: 0,
        ownerId: 0,
      })),
    };
    const r = applyPlayerInput(solo, from.id, input, this.walls, TICK_SECONDS);
    return {
      player: r.state.players[0] ?? from,
      shot: r.state.projectiles[0] ?? null,
    };
  }
}

function fromSnapshot(p: SnapshotPlayer, combat: PlayerCombat): PlayerState {
  return {
    id: p.id,
    position: { x: p.x, y: p.y },
    fireCooldown: p.cooldown,
    hp: p.hp,
    maxHp: p.maxHp,
    mp: p.mp,
    combat,
    // Casting is the server's alone; prediction only moves and shoots.
    ability: null,
    abilityCooldown: 0,
    buffs: {},
    velocity: { x: 0, y: 0 },
    // The pull is the server's; prediction only follows it (D-135).
    ...(p.pull
      ? {
          pull: {
            to: { x: p.pull.x, y: p.pull.y },
            from: p.pull.from,
            speed: p.pull.speed,
            left: p.pull.left,
            by: 0,
          },
        }
      : {}),
  };
}
