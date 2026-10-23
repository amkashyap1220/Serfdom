import {
  addPlayer,
  applyPlayerInput,
  blockingWalls,
  closedDoorIds,
  createSimState,
  dungeonInfo,
  findPlayer,
  isPlayerAlive,
  isTelegraphing,
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
  type ServerMessage,
  type SimState,
  BUFF_KINDS,
  type SimEvent,
  type SnapshotBlast,
  type SnapshotChain,
  type SnapshotPlayer,
  type Loadout,
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
const FRESH: Loadout = { stats: SERF_BASE, weaponTier: null, ability: null };

/** One player's run is over; the caller sends them `runEnded` and back to the menu. */
export interface RunEnd {
  playerId: number;
  result: RunResult;
  stats: RunStats;
  /** Kind of the enemy whose hit killed them (deaths only). */
  killedBy: EnemyKind | null;
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
export class DungeonInstance {
  readonly id: number;
  readonly dungeon: DungeonId;
  readonly layout: DungeonLayout;
  private sim: SimState;
  /** Blasts landed since the last snapshot (drawing only). */
  private readonly blastsToSend: SnapshotBlast[] = [];
  /** Chain Lightning paths since the last snapshot (drawing only). */
  private readonly chainsToSend: SnapshotChain[] = [];
  private rooms: RunProgress;
  private readonly members = new Map<number, Member>();
  /** Everyone who was ever in this run, so nobody rejoins it. */
  private readonly everJoined = new Set<number>();
  private readonly maxQueuedInputs: number;
  private readonly joinWindowTicks: number;
  /** Ticks this run has been running. */
  private age = 0;

  constructor(
    id: number,
    dungeon: DungeonId,
    playerIds: readonly number[],
    options: {
      maxQueuedInputs: number;
      joinWindowTicks: number;
      /** Each starting player's loadout (D-077, D-083); a fresh Serf's if absent. */
      loadoutFor?: (playerId: number) => Loadout;
    },
  ) {
    this.id = id;
    this.dungeon = dungeon;
    this.layout = dungeonInfo(dungeon).layout;
    this.maxQueuedInputs = options.maxQueuedInputs;
    this.joinWindowTicks = options.joinWindowTicks;
    // Enemies come from room waves and stay dead (no respawn).
    this.sim = createSimState([], { respawnSeconds: null });
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
    );
    this.members.set(playerId, {
      inputs: newInputQueue(),
      stats: newRunStats(),
    });
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

  /** Room states, in layout order (tests and diagnostics). */
  get roomProgress(): RunProgress {
    return this.rooms;
  }

  /** Doors still closed right now. */
  get closedDoors(): string[] {
    return closedDoorIds(this.rooms, this.layout);
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
      if (e.type === "blast") {
        this.blastsToSend.push({
          kind: e.kind,
          by: e.playerId,
          x: roundCoord(e.at.x),
          y: roundCoord(e.at.y),
          radius: e.radius,
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
  tick(): { ended: RunEnd[]; faulted: number[] } {
    this.age++;
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
    const world = stepWorld(this.sim, walls, TICK_SECONDS);
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
      let killer: EnemyKind | null = null;
      for (let i = world.events.length - 1; i >= 0; i--) {
        const h = world.events[i];
        if (h?.type === "playerHit" && h.playerId === e.playerId) {
          killer = kinds.get(h.enemyId) ?? null;
          break;
        }
      }
      const end = this.end(e.playerId, "died", killer);
      if (end) ended.push(end);
    }

    const rooms = stepRooms(this.rooms, this.sim, this.layout);
    this.rooms = rooms.progress;
    this.sim = spawnEnemies(this.sim, rooms.spawns);

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
    return { ended, faulted };
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
        buffs: BUFF_KINDS.filter((b) => p.buffs[b] !== undefined),
        cooldown: p.fireCooldown,
      });
    }
    return out;
  }

  snapshot(tick: number): ServerMessage {
    return {
      type: "snapshot",
      tick,
      players: this.snapshotPlayers(),
      enemies: this.sim.enemies.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: e.position.x,
        y: e.position.y,
        size: e.size,
        hp: e.hp,
        maxHp: e.maxHp,
        respawnIn: e.respawnIn,
        alert: isTelegraphing(e),
        cursed: e.curse !== undefined,
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
      })),
      closedDoors: this.closedDoors,
      hazards: this.sim.hazards.map((h) => ({
        x: roundCoord(h.position.x),
        y: roundCoord(h.position.y),
        radius: h.radius,
        landsIn: h.landsIn,
      })),
      portalOpen: this.portalOpen,
      // Each blast goes out in exactly one snapshot.
      blasts: this.blastsToSend.splice(0),
      chains: this.chainsToSend.splice(0),
      zones: this.sim.zones.map((z) => ({
        x: roundCoord(z.at.x),
        y: roundCoord(z.at.y),
        radius: z.radius,
        remaining: roundCoord(z.remaining),
      })),
    };
  }

  private end(
    playerId: number,
    result: RunResult,
    killedBy: EnemyKind | null = null,
  ): RunEnd | null {
    const member = this.members.get(playerId);
    if (!member) return null;
    this.members.delete(playerId);
    // Out of the sim, so enemies rescale for the survivors (D-045).
    this.sim = removePlayer(this.sim, playerId);
    return { playerId, result, stats: member.stats, killedBy };
  }
}
