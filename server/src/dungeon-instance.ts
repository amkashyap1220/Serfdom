import {
  type Rect,
  type Vec2,
  SizedNavigator,
  arrowVolleys,
  activeBlades,
  dropBoulders,
  fireArrows,
  fireJets,
  FORGEMASTER,
  burstRunes,
  runeBursts,
  runeWarnings,
  sludgePools,
  lavaPools,
  tidePools,
  windChannels,
  WHIRLPOOL,
  trapWarnings,
  isDazed,
  rockfallDrops,
  seededRandom,
  type HazardKind,
  addPlayer,
  applyPlayerInput,
  blockingWalls,
  closedDoorIds,
  createSimState,
  layoutFor,
  findPlayer,
  isPlayerAlive,
  isTelegraphing,
  isPile,
  isVenting,
  isFaded,
  MAX_PARTY_SIZE,
  PORTAL_RADIUS,
  requiredRoomsCleared,
  newRunProgress,
  newRunStats,
  recordRunEvents,
  removePlayer,
  roundCoord,
  SERF_BASE,
  spawnEnemies,
  stepRooms,
  stepWorld,
  TICK_SECONDS,
  type DungeonId,
  type EnemyKind,
  type DungeonLayout,
  type PlayerInput,
  type RunProgress,
  type RunResult,
  type RunStats,
  type SnapshotMessage,
  type SimState,
  type SimEvent,
  type SnapshotBlast,
  type SnapshotSwing,
  type SnapshotChain,
  type SnapshotPlayer,
  type Loadout,
  PLAYER_BUFF_KEYS,
  type ArtifactId,
} from "@serfdom/shared";
import {
  newInputQueue,
  queueInput,
  takeInputsForTick,
  type InputQueue,
  type QueueResult,
} from "./input-queue.ts";

interface Member {
  inputs: InputQueue;
  stats: RunStats;
}

/** A fresh Serf with nothing equipped. */
const FRESH: Loadout = {
  stats: SERF_BASE,
  weaponTier: null,
  weaponType: null,
  ability: null,
};

/** One player's run is over; the caller sends them `runEnded` and back to the menu. */
export interface RunEnd {
  playerId: number;
  result: RunResult;
  stats: RunStats;
  /** Kind of the enemy whose hit killed them (deaths only). */
  killedBy: EnemyKind | HazardKind | null;
}

/**
 * One dungeon run (Phase 6a). Owns its own simulation, so separate parties
 * never see or hit each other. New players may join only during the first
 * `joinWindowTicks` of the run while there is room (D-052); after that the
 * party is locked. A player who leaves, dies, or disconnects is out of this
 * run for good, even inside the window.
 *
 * Each tick: apply each member's queued inputs (the move-credit rule in
 * input-queue.ts) against the walls plus closed doors, advance the world
 * once, update run stats from the events, advance the rooms (wake, spawn
 * waves, clear, open doors; dungeon-run.ts), then end the runs of players
 * who died (D-050) and, once every required room is cleared, of every
 * survivor (completed; T-031).
 */

/** Far enough for a trap arrow to cross any room (walls stop it first). */
const ARROW_RANGE = 1200;

export class DungeonInstance {
  readonly id: number;
  readonly dungeon: DungeonId;
  /** Sent with runStarted so every client builds the same layout. */
  readonly seed: number;
  readonly layout: DungeonLayout;
  private sim: SimState;
  /** Blasts landed since the last snapshot (drawing only). */
  private readonly blastsToSend: SnapshotBlast[] = [];
  /** Melee swings since the last snapshot (D-141). */
  private readonly swingsToSend: SnapshotSwing[] = [];
  /** Chain Lightning paths since the last snapshot (drawing only). */
  private readonly chainsToSend: SnapshotChain[] = [];
  private rooms: RunProgress;
  private readonly members = new Map<number, Member>();
  /** Everyone who was ever in this run, so nobody rejoins it. */
  private readonly everJoined = new Set<number>();
  /** Artifacts used up this tick (the Resurrection Necklace, D-153). */
  private spent: { playerId: number; artifact: ArtifactId }[] = [];
  private peak = 0;
  private readonly maxQueuedInputs: number;
  private readonly joinWindowTicks: number;
  /** Ticks this run has been running. */
  private age = 0;
  /** Where this run's boulders fall (D-110). */
  private readonly rockRandom: () => number;
  private navigator: SizedNavigator | null = null;
  private navigatorKey = "";

  constructor(
    id: number,
    dungeon: DungeonId,
    playerIds: readonly number[],
    options: {
      maxQueuedInputs: number;
      joinWindowTicks: number;
      /** Each starting player's loadout (D-077, D-083); a fresh Serf's if absent. */
      loadoutFor?: (playerId: number) => Loadout;
      /** This run's layout seed (D-104); 0, the fixed layout, if absent. */
      seed?: number;
    },
  ) {
    this.id = id;
    this.dungeon = dungeon;
    this.seed = options.seed ?? 0;
    // Its own stream, so the same seed drops the same boulders (D-110).
    this.rockRandom = seededRandom((this.seed ^ 0x2545f491) >>> 0);
    this.layout = layoutFor(dungeon, this.seed);
    this.maxQueuedInputs = options.maxQueuedInputs;
    this.joinWindowTicks = options.joinWindowTicks;
    // Enemies come from room waves and stay dead (no respawn).
    // Sludge slows players everywhere in this run (D-113).
    this.sim = {
      ...createSimState([], { respawnSeconds: null }),
      sludge: sludgePools(this.layout),
      lava: lavaPools(this.layout),
      tides: tidePools(this.layout),
      winds: windChannels(this.layout),
      clock: 0,
    };
    this.rooms = newRunProgress(this.layout);
    for (const playerId of playerIds) {
      this.join(playerId, options.loadoutFor?.(playerId) ?? FRESH);
    }
  }

  /** Whether `playerId` may join now: inside the join window, room left, never in this run before. */
  canJoin(playerId: number): boolean {
    return (
      this.age < this.joinWindowTicks &&
      this.members.size > 0 &&
      this.members.size < MAX_PARTY_SIZE &&
      !this.everJoined.has(playerId)
    );
  }

  /**
   * Adds a player at the spawn with full HP, simulated with their serf's
   * stats and gear (D-077, D-083). Enemies rescale on the next tick (D-045).
   */
  join(playerId: number, loadout: Loadout = FRESH): void {
    if (this.everJoined.has(playerId)) {
      throw new Error(`player ${playerId} was already in run ${this.id}`);
    }
    this.everJoined.add(playerId);
    this.sim = addPlayer(
      this.sim,
      playerId,
      this.layout.spawn,
      loadout.stats,
      loadout.weaponTier,
      loadout.ability,
      loadout.weaponType,
      loadout.artifacts ?? [],
    );
    this.members.set(playerId, {
      inputs: newInputQueue(),
      stats: newRunStats(),
    });
    this.peak = Math.max(this.peak, this.members.size);
  }

  /** The most players this run has held: a clear's party size (D-148). */
  get peakPlayers(): number {
    return this.peak;
  }

  get playerIds(): number[] {
    return [...this.members.keys()];
  }

  get isEmpty(): boolean {
    return this.members.size === 0;
  }

  /** The authoritative simulation (tests and diagnostics). */
  get state(): SimState {
    return this.sim;
  }

  /** The rooms this run has woken, and which are cleared (the minimap, D-147). */
  get roomsSeen(): { seen: string[]; cleared: string[] } {
    const seen: string[] = [];
    const cleared: string[] = [];
    this.layout.rooms.forEach((room, i) => {
      const status = this.rooms[i]?.status ?? "dormant";
      if (status !== "dormant") seen.push(room.id);
      if (status === "cleared") cleared.push(room.id);
    });
    return { seen, cleared };
  }

  /** Room states, in layout order (tests and diagnostics). */
  get roomProgress(): RunProgress {
    return this.rooms;
  }

  /** Doors still closed right now. */
  get closedDoors(): string[] {
    return closedDoorIds(this.rooms, this.layout, this.sim.players);
  }

  /** Replaces the simulation (tests only). */
  setStateForTest(state: SimState): void {
    this.sim = state;
  }

  has(playerId: number): boolean {
    return this.members.has(playerId);
  }

  queuedInputs(playerId: number): number {
    return this.members.get(playerId)?.inputs.pending.length ?? 0;
  }

  queueInput(playerId: number, seq: number, input: PlayerInput): QueueResult {
    const member = this.members.get(playerId);
    if (!member) throw new Error(`player ${playerId} is not in this run`);
    return queueInput(member.inputs, seq, input, this.maxQueuedInputs);
  }

  /**
   * Remembers the ability effects to draw (blasts, rings, curses, chains),
   * from either timeline: casts happen on a player's inputs, Arcane Blasts
   * land in the world step. Each goes out in exactly one snapshot.
   */
  private collectEffects(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "artifactSpent") {
        this.spent.push({ playerId: e.playerId, artifact: e.artifact });
      } else if (e.type === "blast") {
        this.blastsToSend.push({
          kind: e.kind,
          by: e.playerId,
          x: roundCoord(e.at.x),
          y: roundCoord(e.at.y),
          radius: e.radius,
        });
      } else if (e.type === "swing") {
        this.swingsToSend.push({
          by: e.playerId,
          x: roundCoord(e.at.x),
          y: roundCoord(e.at.y),
          angle: Math.round(e.angle * 1000) / 1000,
          arcDegrees: e.arcDegrees,
          reach: e.reach,
        });
      } else if (e.type === "chain") {
        this.chainsToSend.push({
          by: e.playerId,
          points: e.points.map((p) => ({
            x: roundCoord(p.x),
            y: roundCoord(p.y),
          })),
        });
      }
    }
  }

  /** Removes a player (R or disconnect). Returns their final stats, or null if not a member. */
  leave(playerId: number): RunEnd | null {
    return this.end(playerId, "left");
  }

  /**
   * Advances the run one tick. Returns the players whose runs ended, and
   * any player whose input made the shared rules throw (should be
   * impossible after validation; the caller drops them).
   */
  tick(): {
    ended: RunEnd[];
    faulted: number[];
    spent: { playerId: number; artifact: ArtifactId }[];
  } {
    this.age++;
    this.spent = [];
    const walls = blockingWalls(this.layout, this.closedDoors);
    const faulted: number[] = [];
    for (const [id, member] of this.members) {
      const { apply } = takeInputsForTick(member.inputs);
      try {
        for (const input of apply) {
          const r = applyPlayerInput(this.sim, id, input, walls, TICK_SECONDS);
          this.sim = r.state;
          member.stats = recordRunEvents(member.stats, id, r.events);
          this.collectEffects(r.events);
        }
      } catch {
        faulted.push(id);
      }
    }
    for (const id of faulted) this.end(id, "left");

    // Known before the tick, since a dead enemy may be gone after it.
    const kinds = new Map(this.sim.enemies.map((e) => [e.id, e.kind]));
    // Blade arms turn in fighting rooms only (D-137).
    this.sim = {
      ...this.sim,
      roomBlades: activeBlades(this.rooms, this.layout),
    };
    const world = stepWorld(
      this.sim,
      walls,
      TICK_SECONDS,
      this.navigatorFor(walls),
      this.holesOf,
      this.boundsOf,
    );
    this.sim = world.state;
    this.collectEffects(world.events);
    for (const e of this.sim.enemies) kinds.set(e.id, e.kind);
    for (const [id, member] of this.members) {
      member.stats = recordRunEvents(member.stats, id, world.events);
      member.stats = {
        ...member.stats,
        seconds: member.stats.seconds + TICK_SECONDS,
      };
    }

    const ended: RunEnd[] = [];
    for (const e of world.events) {
      if (e.type !== "playerDied") continue;
      // The killing blow is this player's last hit in this tick.
      let killer: EnemyKind | HazardKind | null = null;
      for (let i = world.events.length - 1; i >= 0; i--) {
        const h = world.events[i];
        if (h?.type === "playerHit" && h.playerId === e.playerId) {
          killer = kinds.get(h.enemyId) ?? null;
          break;
        }
        if (h?.type === "hazardHit" && h.playerId === e.playerId) {
          killer = h.hazard;
          break;
        }
      }
      const end = this.end(e.playerId, "died", killer);
      if (end) ended.push(end);
    }

    const rooms = stepRooms(this.rooms, this.sim, this.layout);
    this.rooms = rooms.progress;
    this.sim = spawnEnemies(this.sim, rooms.spawns);
    // Boulders in fighting rockfall rooms (D-110), from this run's stream.
    const fall = rockfallDrops(
      this.rooms,
      this.layout,
      this.sim.players,
      this.rockRandom,
    );
    this.rooms = fall.progress;
    this.sim = dropBoulders(this.sim, fall.drops);
    // Arrow traps in fighting rooms (D-113); arrows fly the room across.
    const volley = arrowVolleys(this.rooms, this.layout, this.rockRandom);
    this.rooms = volley.progress;
    this.sim = fireArrows(
      this.sim,
      volley.shots.filter((s) => !s.jet),
      ARROW_RANGE,
    );
    // Fire jets (D-133): beams across the room, stopped by walls and obstacles.
    this.sim = fireJets(
      this.sim,
      volley.shots.filter((s) => s.jet),
      walls,
    );
    // Cursed runes burst column by column (D-123).
    const runes = runeBursts(this.rooms, this.layout);
    this.rooms = runes.progress;
    this.sim = burstRunes(this.sim, runes.bursts);

    // Completion (D-057): with a portal, each living player completes by
    // stepping into it once it is open; without one, everyone at once.
    if (this.portalOpen) {
      const portal = this.layout.exitPortal;
      for (const p of this.sim.players) {
        const inPortal =
          portal === null ||
          Math.hypot(p.position.x - portal.x, p.position.y - portal.y) <=
            PORTAL_RADIUS;
        if (!isPlayerAlive(p) || !inPortal) continue;
        const end = this.end(p.id, "completed");
        if (end) ended.push(end);
      }
    }
    return { ended, faulted, spent: this.spent };
  }

  /**
   * The grid goblins find their way with (D-114), rebuilt only when doors
   * open or shut (the walls change).
   */
  /** A room's holes (the Warchief's war cry, D-117). */
  private readonly holesOf = (roomId: string): readonly Vec2[] =>
    this.layout.rooms.find((r) => r.id === roomId)?.holes ?? [];

  /** A room's floor (the Forgemaster's arena, D-134). */
  private readonly boundsOf = (roomId: string): Rect | undefined =>
    this.layout.rooms.find((r) => r.id === roomId)?.bounds;

  private navigatorFor(walls: readonly Rect[]): SizedNavigator {
    const key = this.closedDoors.join(",");
    if (!this.navigator || this.navigatorKey !== key) {
      // Enemies path round lava (D-130).
      this.navigator = new SizedNavigator([...walls, ...(this.sim.lava ?? [])]);
      this.navigatorKey = key;
    }
    return this.navigator;
  }

  /** The exit portal is open (every required room cleared). */
  get portalOpen(): boolean {
    return requiredRoomsCleared(this.rooms, this.layout);
  }

  snapshotPlayers(): SnapshotPlayer[] {
    const out: SnapshotPlayer[] = [];
    for (const [id, member] of this.members) {
      const p = findPlayer(this.sim, id);
      if (!p) continue;
      out.push({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        ack: member.inputs.ack,
        hp: p.hp,
        maxHp: p.maxHp,
        mp: roundCoord(p.mp),
        maxMp: p.combat.maxMp,
        // Buffs, then the Artifacts' glows (D-153).
        buffs: [
          ...PLAYER_BUFF_KEYS.filter((b) => p.buffs[b] !== undefined),
          ...(p.shield || p.mantle ? (["shielded"] as const) : []),
          ...((p.invulnerable ?? 0) > 0 ? (["phased"] as const) : []),
        ],
        cooldown: p.fireCooldown,
        abilityCooldown: roundCoord(p.abilityCooldown),
        // Exact: prediction moves with it (D-153).
        boost: p.hideBoost ?? 0,
        // Exact, like the position: prediction must pull the same way.
        pull: p.pull
          ? {
              x: p.pull.to.x,
              y: p.pull.to.y,
              from: p.pull.from,
              speed: p.pull.speed,
              left: p.pull.left,
            }
          : null,
      });
    }
    return out;
  }

  snapshot(tick: number): SnapshotMessage {
    return {
      type: "snapshot",
      tick,
      players: this.snapshotPlayers(),
      enemies: this.sim.enemies.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: roundCoord(e.position.x),
        y: roundCoord(e.position.y),
        size: e.size,
        hp: e.hp,
        maxHp: e.maxHp,
        respawnIn: e.respawnIn,
        alert: isTelegraphing(e),
        cursed: e.curse !== undefined,
        leads: e.leads,
        dazed: isDazed(e),
        chanted: (e.chant ?? 0) > 0,
        pile: isPile(e),
        faded: isFaded(e),
        facing:
          e.ai.kind === "knight" || e.ai.kind === "sentry"
            ? Math.round(Math.atan2(e.ai.facing.y, e.ai.facing.x) * 100) / 100
            : e.ai.kind === "lich"
              ? Math.round((e.ai.firing ? e.ai.spin : e.ai.look) * 100) / 100
              : null,
        spinning: e.ai.kind === "lich" && e.ai.firing,
        vented: isVenting(e),
      })),
      projectiles: this.sim.projectiles.map((p) => ({
        id: p.id,
        owner: p.owner,
        by: p.ownerId,
        x: roundCoord(p.position.x),
        y: roundCoord(p.position.y),
        dx: p.direction.x,
        dy: p.direction.y,
        speed: p.speed,
        size: p.size,
        ability: p.fromAbility === true,
        trap: p.hazard === "arrows",
        fireball: p.hazard === "braziers",
      })),
      closedDoors: this.closedDoors,
      // Rune bursts are drawn from `runes`, not as falling hazards (D-123).
      hazards: this.sim.hazards
        .filter((h) => h.hazard !== "runes")
        .map((h) => ({
          x: roundCoord(h.position.x),
          y: roundCoord(h.position.y),
          radius: h.radius,
          landsIn: h.landsIn,
          kind: h.rune
            ? ("rune" as const)
            : h.meteor
              ? ("slag" as const)
              : h.hazard === "icicles"
                ? ("icicle" as const)
                : h.hazard === "slag"
                  ? ("slag" as const)
                  : h.fire
                    ? ("bomb" as const)
                    : ("boulder" as const),
        })),
      fires: this.sim.fires.map((f) => ({
        x: roundCoord(f.position.x),
        y: roundCoord(f.position.y),
        radius: f.radius,
        remaining: roundCoord(f.remaining),
      })),
      beams: (this.sim.beams ?? []).map((b) => ({
        x1: roundCoord(b.from.x),
        y1: roundCoord(b.from.y),
        x2: roundCoord(b.to.x),
        y2: roundCoord(b.to.y),
        width: b.width,
        remaining: roundCoord(b.remaining),
        startsIn: roundCoord(b.startsIn ?? 0),
        arc: b.ownerId !== undefined,
      })),
      waves: (this.sim.waves ?? []).map((w) => ({
        x: roundCoord(w.at.x),
        y: roundCoord(w.at.y),
        radius: roundCoord(w.radius),
        gap: Math.round(w.gap * 1000) / 1000,
        startsIn: roundCoord(w.startsIn),
      })),
      plates: (this.sim.plates ?? []).map((p) => ({
        x: p.area.x,
        y: p.area.y,
        width: p.area.width,
        height: p.area.height,
        lane: p.lane,
        warn: roundCoord(
          Math.min(1, 1 - p.burstsIn / FORGEMASTER.plates.warnSeconds),
        ),
        burning: p.burstsIn <= 1e-9,
      })),
      // Exact: the client keys its prediction of the water to it.
      clock: this.sim.clock ?? 0,
      whirlpools: (this.sim.whirlpools ?? []).map((w) => ({
        x: roundCoord(w.at.x),
        y: roundCoord(w.at.y),
        radius: w.radius,
        from: w.from,
        until: w.until,
        dragSpeed: w.dragSpeed ?? WHIRLPOOL.dragSpeed,
      })),
      surges: (this.sim.surges ?? []).map((s) => ({
        x: s.area.x,
        y: s.area.y,
        width: s.area.width,
        height: s.area.height,
        axis: s.axis,
        dir: s.dir,
        pos: roundCoord(s.pos),
        gaps: s.gaps.map((g) => ({
          from: roundCoord(g.from),
          to: roundCoord(g.to),
        })),
        startsIn: roundCoord(s.startsIn),
      })),
      // Exact: prediction slows the player on it (D-136).
      frost: (this.sim.frost ?? []).map((f) => ({
        x: f.at.x,
        y: f.at.y,
        radius: f.radius,
        from: f.from,
        until: f.until,
      })),
      blades: (this.sim.blades ?? []).map((b) => ({
        x: roundCoord(b.pivot.x),
        y: roundCoord(b.pivot.y),
        length: b.length,
        angle: Math.round(b.angle * 1000) / 1000,
        speed: Math.round(b.speed * 1000) / 1000,
        laser: b.ownerId >= 0,
      })),
      cones: (this.sim.cones ?? []).map((c) => ({
        x: roundCoord(c.at.x),
        y: roundCoord(c.at.y),
        angle: Math.round(c.angle * 1000) / 1000,
        range: c.range,
        halfAngle: Math.round(c.halfAngle * 1000) / 1000,
        startsIn: roundCoord(c.startsIn),
      })),
      traps: trapWarnings(this.rooms, this.layout),
      runes: runeWarnings(this.rooms, this.layout),
      portalOpen: this.portalOpen,
      // Each blast goes out in exactly one snapshot.
      blasts: this.blastsToSend.splice(0),
      swings: this.swingsToSend.splice(0),
      chains: this.chainsToSend.splice(0),
      zones: [
        ...this.sim.zones.map((z) => ({
          x: roundCoord(z.at.x),
          y: roundCoord(z.at.y),
          radius: z.radius,
          remaining: roundCoord(z.remaining),
        })),
        // Artifact areas (D-153): decoys while their Rogue hides, fields.
        ...(this.sim.decoys ?? []).map((d) => ({
          x: roundCoord(d.at.x),
          y: roundCoord(d.at.y),
          radius: 16,
          remaining: 1,
          kind: "decoy" as const,
        })),
        ...(this.sim.fields ?? []).map((f) => ({
          x: roundCoord(f.at.x),
          y: roundCoord(f.at.y),
          radius: f.radius,
          remaining: roundCoord(f.remaining),
          kind: "field" as const,
        })),
      ],
    };
  }

  private end(
    playerId: number,
    result: RunResult,
    killedBy: EnemyKind | HazardKind | null = null,
  ): RunEnd | null {
    const member = this.members.get(playerId);
    if (!member) return null;
    this.members.delete(playerId);
    // Out of the sim, so enemies rescale for the survivors (D-045).
    this.sim = removePlayer(this.sim, playerId);
    return { playerId, result, stats: member.stats, killedBy };
  }
}
