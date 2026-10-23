import { MAX_PARTY_SIZE, type DungeonId } from "@serfdom/shared";

interface Waiting {
  playerId: number;
  dungeon: DungeonId;
  /** Server tick at which they joined the queue. */
  sinceTick: number;
}

export interface StartingRun {
  dungeon: DungeonId;
  players: number[];
}

/**
 * The open dungeon queue (D-051, T-030). Players pick a dungeon and wait;
 * a run starts as soon as `MAX_PARTY_SIZE` players are waiting for the same
 * dungeon, or when the longest-waiting player has waited `waitTicks`, with
 * whoever is there (so solo play never waits more than that). First come,
 * first served. Pure bookkeeping: time is the server's tick count, passed
 * in, so tests control it exactly.
 */
export class Matchmaker {
  private waiting: Waiting[] = [];
  private readonly waitTicks: number;

  constructor(waitTicks: number) {
    if (!Number.isInteger(waitTicks) || waitTicks < 0) {
      throw new RangeError(`waitTicks must be a whole number >= 0`);
    }
    this.waitTicks = waitTicks;
  }

  has(playerId: number): boolean {
    return this.waiting.some((w) => w.playerId === playerId);
  }

  dungeonOf(playerId: number): DungeonId | null {
    return this.waiting.find((w) => w.playerId === playerId)?.dungeon ?? null;
  }

  /** Players waiting for `dungeon`, longest-waiting first. */
  queuedFor(dungeon: DungeonId): number[] {
    return this.waiting
      .filter((w) => w.dungeon === dungeon)
      .map((w) => w.playerId);
  }

  /** Everyone waiting, longest-waiting first. */
  get waitingPlayers(): { playerId: number; dungeon: DungeonId }[] {
    return this.waiting.map(({ playerId, dungeon }) => ({ playerId, dungeon }));
  }

  join(playerId: number, dungeon: DungeonId, tick: number): void {
    if (this.has(playerId)) throw new Error(`player ${playerId} is queued`);
    this.waiting.push({ playerId, dungeon, sinceTick: tick });
  }

  /** Returns the dungeon they were waiting for, or null if they were not queued. */
  leave(playerId: number): DungeonId | null {
    const dungeon = this.dungeonOf(playerId);
    this.waiting = this.waiting.filter((w) => w.playerId !== playerId);
    return dungeon;
  }

  /** Ticks until `dungeon`'s next run starts if nobody else joins (0 = now). */
  ticksUntilStart(dungeon: DungeonId, tick: number): number {
    return this.ticksUntilStartOf(
      this.waiting.filter((w) => w.dungeon === dungeon),
      tick,
    );
  }

  /** Removes and returns every run that should start at `tick`. */
  takeReady(tick: number): StartingRun[] {
    const runs: StartingRun[] = [];
    const dungeons = [...new Set(this.waiting.map((w) => w.dungeon))];
    for (const dungeon of dungeons) {
      let queue = this.waiting.filter((w) => w.dungeon === dungeon);
      while (
        queue.length >= MAX_PARTY_SIZE ||
        (queue.length > 0 && this.ticksUntilStartOf(queue, tick) === 0)
      ) {
        const party = queue.slice(0, MAX_PARTY_SIZE).map((w) => w.playerId);
        runs.push({ dungeon, players: party });
        this.waiting = this.waiting.filter((w) => !party.includes(w.playerId));
        queue = queue.slice(MAX_PARTY_SIZE);
      }
    }
    return runs;
  }

  private ticksUntilStartOf(queue: readonly Waiting[], tick: number): number {
    const first = queue[0];
    return first ? Math.max(0, first.sinceTick + this.waitTicks - tick) : 0;
  }
}
