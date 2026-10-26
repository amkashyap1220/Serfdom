import { MAX_PARTY_SIZE, type DungeonId } from "@serfdom/shared";

/** One place in the queue: a solo player, or a party that must share a run (D-143). */
interface Waiting {
  players: number[];
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
 * first served. A party (14b, D-143) waits as one place and always goes
 * into the same run; a party that does not fit the run being filled waits
 * for the next one. Pure bookkeeping: time is the server's tick count,
 * passed in, so tests control it exactly.
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
    return this.placeOf(playerId) !== undefined;
  }

  dungeonOf(playerId: number): DungeonId | null {
    return this.placeOf(playerId)?.dungeon ?? null;
  }

  /** Players waiting for `dungeon`, longest-waiting first. */
  queuedFor(dungeon: DungeonId): number[] {
    return this.waiting
      .filter((w) => w.dungeon === dungeon)
      .flatMap((w) => w.players);
  }

  /** Every place in the queue (a solo player or a party), longest-waiting first. */
  get waitingGroups(): { players: number[]; dungeon: DungeonId }[] {
    return this.waiting.map(({ players, dungeon }) => ({
      players: [...players],
      dungeon,
    }));
  }

  join(playerId: number, dungeon: DungeonId, tick: number): void {
    this.joinGroup([playerId], dungeon, tick);
  }

  /** Queues a party as one place: they will share a run (D-143). */
  joinGroup(
    players: readonly number[],
    dungeon: DungeonId,
    tick: number,
  ): void {
    if (players.length === 0 || players.length > MAX_PARTY_SIZE) {
      throw new RangeError(`a group has 1 to ${MAX_PARTY_SIZE} players`);
    }
    for (const id of players) {
      if (this.has(id)) throw new Error(`player ${id} is queued`);
    }
    this.waiting.push({ players: [...players], dungeon, sinceTick: tick });
  }

  /**
   * Takes a player's whole place out of the queue: a party waits together,
   * so it leaves together. Returns who left and for which dungeon, or null
   * if they were not queued.
   */
  leave(playerId: number): { dungeon: DungeonId; players: number[] } | null {
    const place = this.placeOf(playerId);
    if (!place) return null;
    this.waiting = this.waiting.filter((w) => w !== place);
    return { dungeon: place.dungeon, players: [...place.players] };
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
      while (queue.length > 0) {
        // Fill a run in queue order, skipping parties that would overflow it.
        const taken: Waiting[] = [];
        let size = 0;
        for (const w of queue) {
          if (size + w.players.length > MAX_PARTY_SIZE) continue;
          taken.push(w);
          size += w.players.length;
        }
        if (size < MAX_PARTY_SIZE && this.ticksUntilStartOf(queue, tick) > 0) {
          break;
        }
        runs.push({ dungeon, players: taken.flatMap((w) => w.players) });
        this.waiting = this.waiting.filter((w) => !taken.includes(w));
        queue = queue.filter((w) => !taken.includes(w));
      }
    }
    return runs;
  }

  private placeOf(playerId: number): Waiting | undefined {
    return this.waiting.find((w) => w.players.includes(playerId));
  }

  private ticksUntilStartOf(queue: readonly Waiting[], tick: number): number {
    const first = queue[0];
    return first ? Math.max(0, first.sinceTick + this.waitTicks - tick) : 0;
  }
}
