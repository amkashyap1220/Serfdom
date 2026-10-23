import {
  addRunToLife,
  isClassId,
  levelForExp,
  newLifeStats,
  SERF_BASE,
  STAT_KEYS,
  type Stats,
  type ClassId,
  type LeaderboardEntry,
  type LifeStats,
  type RunResult,
  type RunStats,
  type SerfSummary,
} from "@serfdom/shared";
import type pg from "pg";

export interface Death {
  dungeon: string;
  killedBy: string | null;
}

export type CreateResult = SerfSummary | "slotsFull" | "nameTaken";

/** How many fallen serfs a serf list shows (most recent first). */
export const FALLEN_SHOWN = 10;

/**
 * Storage for serfs. Every call names the owning account, and a serf that
 * belongs to another account is treated as not existing (authorization in
 * the query, not only in the caller). `PgSerfRepo` is the real one;
 * `MemorySerfRepo` behaves the same for database-free tests.
 */
export interface SerfRepo {
  /** Living serfs (oldest first), then up to FALLEN_SHOWN dead ones (most recent first). */
  list(accountId: number): Promise<SerfSummary[]>;
  /** Atomic: checks the slot limit and name uniqueness together with the insert. */
  create(
    accountId: number,
    name: string,
    maxLiving: number,
  ): Promise<CreateResult>;
  /** The account's serf, or null if it does not exist or is someone else's. */
  find(accountId: number, serfId: number): Promise<SerfSummary | null>;
  /**
   * Adds a finished run to a living serf and, if `death` is given, kills it
   * for good. Null (and no change) if the serf is not this account's or is
   * already dead, so a run can never be recorded twice onto a corpse.
   * `expGained` is added to lifetime EXP in the same statement.
   */
  recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    expGained: number,
  ): Promise<SerfSummary | null>;
  /** All serfs, living and dead, by lifetime EXP (ties: older serf first). */
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
  /**
   * Sets a serf's permanent class, only if it is this account's, alive,
   * classless, and has at least `minExp` lifetime EXP, all checked in the
   * same write. Null if any of those fails (the class never changes).
   */
  chooseClass(
    accountId: number,
    serfId: number,
    classId: ClassId,
    minExp: number,
    stats: Stats,
    statsLevel: number,
  ): Promise<SerfSummary | null>;
  /** The serf plus the level its stats have been rolled up to. */
  findWithStatsLevel(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; statsLevel: number } | null>;
  /**
   * Saves stats rolled up to `toLevel`, only if they are still at
   * `fromLevel` and the serf is alive: a level is never rolled twice.
   */
  saveStats(
    accountId: number,
    serfId: number,
    stats: Stats,
    fromLevel: number,
    toLevel: number,
  ): Promise<SerfSummary | null>;
}

const UNIQUE_VIOLATION = "23505";

interface SerfRow {
  id: string;
  name: string;
  exp: string;
  class_id: string | null;
  stats: unknown;
  stats_level: number;
  died_at: Date | null;
  death_dungeon: string | null;
  killed_by: string | null;
  runs: number;
  clears: number;
  seconds: number;
  shots_fired: string;
  shots_hit: string;
  damage_dealt: string;
  enemies_defeated: string;
  damage_taken: string;
}

function fromRow(r: SerfRow): SerfSummary {
  const alive = r.died_at === null;
  const exp = Number(r.exp);
  return {
    id: Number(r.id),
    name: r.name,
    level: levelForExp(exp),
    exp,
    classId: classFromRow(r.class_id),
    stats: statsFromRow(r.stats),
    alive,
    life: {
      runs: r.runs,
      clears: r.clears,
      seconds: r.seconds,
      shotsFired: Number(r.shots_fired),
      shotsHit: Number(r.shots_hit),
      damageDealt: Number(r.damage_dealt),
      enemiesDefeated: Number(r.enemies_defeated),
      damageTaken: Number(r.damage_taken),
    },
    death: alive
      ? null
      : { dungeon: r.death_dungeon ?? "", killedBy: r.killed_by },
  };
}

/** A stored class the code no longer knows is a bug, not a Serf. */
function classFromRow(v: string | null): ClassId | null {
  if (v === null) return null;
  if (!isClassId(v)) throw new Error(`unknown class in database: ${v}`);
  return v;
}

/** Null is a fresh Serf; anything malformed is a bug, not a Serf. */
function statsFromRow(v: unknown): Stats {
  if (v === null) return { ...SERF_BASE };
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error("bad stats in database");
  }
  const raw = v as Record<string, unknown>;
  const stats = { ...SERF_BASE };
  for (const key of STAT_KEYS) {
    const n = raw[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new Error(`bad stat ${key} in database`);
    }
    stats[key] = n;
  }
  return stats;
}

export class PgSerfRepo implements SerfRepo {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async list(accountId: number): Promise<SerfSummary[]> {
    const living = await this.pool.query<SerfRow>(
      "select * from serfs where account_id = $1 and died_at is null order by created_at, id",
      [accountId],
    );
    const fallen = await this.pool.query<SerfRow>(
      "select * from serfs where account_id = $1 and died_at is not null order by died_at desc, id desc limit $2",
      [accountId, FALLEN_SHOWN],
    );
    return [...living.rows, ...fallen.rows].map(fromRow);
  }

  async create(
    accountId: number,
    name: string,
    maxLiving: number,
  ): Promise<CreateResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Locking the account row serializes concurrent creates for one
      // account, so two at once cannot both take the last slot.
      await client.query("select id from accounts where id = $1 for update", [
        accountId,
      ]);
      const count = await client.query<{ n: string }>(
        "select count(*) n from serfs where account_id = $1 and died_at is null",
        [accountId],
      );
      if (Number(count.rows[0]?.n) >= maxLiving) {
        await client.query("rollback");
        return "slotsFull";
      }
      const r = await client.query<SerfRow>(
        "insert into serfs (account_id, name) values ($1, $2) returning *",
        [accountId, name],
      );
      await client.query("commit");
      const row = r.rows[0];
      if (!row) throw new Error("insert returned no row");
      return fromRow(row);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) return "nameTaken";
      throw err;
    } finally {
      client.release();
    }
  }

  async find(accountId: number, serfId: number): Promise<SerfSummary | null> {
    const r = await this.pool.query<SerfRow>(
      "select * from serfs where id = $1 and account_id = $2",
      [serfId, accountId],
    );
    const row = r.rows[0];
    return row ? fromRow(row) : null;
  }

  async recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    expGained: number,
  ): Promise<SerfSummary | null> {
    // One statement: the "still alive" check and the update cannot be
    // separated by another write.
    const r = await this.pool.query<SerfRow>(
      `update serfs set
         runs = runs + 1,
         clears = clears + $3,
         seconds = seconds + $4,
         shots_fired = shots_fired + $5,
         shots_hit = shots_hit + $6,
         damage_dealt = damage_dealt + $7,
         enemies_defeated = enemies_defeated + $8,
         damage_taken = damage_taken + $9,
         died_at = case when $10::boolean then now() else null end,
         death_dungeon = $11,
         killed_by = $12,
         exp = exp + $13
       where id = $1 and account_id = $2 and died_at is null
       returning *`,
      [
        serfId,
        accountId,
        result === "completed" ? 1 : 0,
        run.seconds,
        run.shotsFired,
        run.shotsHit,
        Math.round(run.damageDealt),
        run.enemiesDefeated,
        Math.round(run.damageTaken),
        death !== null,
        death?.dungeon ?? null,
        death?.killedBy ?? null,
        expGained,
      ],
    );
    const row = r.rows[0];
    return row ? fromRow(row) : null;
  }

  async leaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const r = await this.pool.query<{
      name: string;
      exp: string;
      class_id: string | null;
      died_at: Date | null;
    }>(
      "select name, exp, class_id, died_at from serfs order by exp desc, id limit $1",
      [limit],
    );
    return r.rows.map((row, i) =>
      toEntry(
        i,
        row.name,
        Number(row.exp),
        classFromRow(row.class_id),
        row.died_at === null,
      ),
    );
  }

  async chooseClass(
    accountId: number,
    serfId: number,
    classId: ClassId,
    minExp: number,
    stats: Stats,
    statsLevel: number,
  ): Promise<SerfSummary | null> {
    // One statement, so two picks at once cannot both succeed, and the
    // class bonus lands with the class or not at all.
    const r = await this.pool.query<SerfRow>(
      `update serfs set class_id = $3, stats = $5
       where id = $1 and account_id = $2 and died_at is null
         and class_id is null and exp >= $4 and stats_level = $6
       returning *`,
      [serfId, accountId, classId, minExp, JSON.stringify(stats), statsLevel],
    );
    const row = r.rows[0];
    return row ? fromRow(row) : null;
  }

  async findWithStatsLevel(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; statsLevel: number } | null> {
    const r = await this.pool.query<SerfRow>(
      "select * from serfs where id = $1 and account_id = $2",
      [serfId, accountId],
    );
    const row = r.rows[0];
    return row ? { serf: fromRow(row), statsLevel: row.stats_level } : null;
  }

  async saveStats(
    accountId: number,
    serfId: number,
    stats: Stats,
    fromLevel: number,
    toLevel: number,
  ): Promise<SerfSummary | null> {
    const r = await this.pool.query<SerfRow>(
      `update serfs set stats = $3, stats_level = $5
       where id = $1 and account_id = $2 and died_at is null
         and stats_level = $4
       returning *`,
      [serfId, accountId, JSON.stringify(stats), fromLevel, toLevel],
    );
    const row = r.rows[0];
    return row ? fromRow(row) : null;
  }
}

function toEntry(
  index: number,
  name: string,
  exp: number,
  classId: ClassId | null,
  alive: boolean,
): LeaderboardEntry {
  return {
    rank: index + 1,
    name,
    level: levelForExp(exp),
    exp,
    classId,
    alive,
  };
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

interface MemorySerf {
  accountId: number;
  summary: SerfSummary;
  statsLevel: number;
  createdSeq: number;
  diedSeq: number | null;
}

/** In-memory twin of PgSerfRepo (game-server tests). */
export class MemorySerfRepo implements SerfRepo {
  private readonly serfs: MemorySerf[] = [];
  private seq = 0;

  async list(accountId: number): Promise<SerfSummary[]> {
    const mine = this.serfs.filter((s) => s.accountId === accountId);
    const living = mine
      .filter((s) => s.summary.alive)
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const fallen = mine
      .filter((s) => !s.summary.alive)
      .sort((a, b) => (b.diedSeq ?? 0) - (a.diedSeq ?? 0))
      .slice(0, FALLEN_SHOWN);
    return [...living, ...fallen].map((s) => structuredClone(s.summary));
  }

  async create(
    accountId: number,
    name: string,
    maxLiving: number,
  ): Promise<CreateResult> {
    const living = this.serfs.filter(
      (s) => s.accountId === accountId && s.summary.alive,
    );
    if (living.length >= maxLiving) return "slotsFull";
    const lower = name.toLowerCase();
    if (
      this.serfs.some(
        (s) => s.summary.alive && s.summary.name.toLowerCase() === lower,
      )
    ) {
      return "nameTaken";
    }
    const summary: SerfSummary = {
      id: this.serfs.length + 1,
      name,
      level: 1,
      exp: 0,
      classId: null,
      stats: { ...SERF_BASE },
      alive: true,
      life: newLifeStats(),
      death: null,
    };
    this.serfs.push({
      accountId,
      summary,
      statsLevel: 1,
      createdSeq: ++this.seq,
      diedSeq: null,
    });
    return structuredClone(summary);
  }

  async find(accountId: number, serfId: number): Promise<SerfSummary | null> {
    const s = this.serfs.find(
      (x) => x.accountId === accountId && x.summary.id === serfId,
    );
    return s ? structuredClone(s.summary) : null;
  }

  async recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    expGained: number,
  ): Promise<SerfSummary | null> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId && x.summary.id === serfId && x.summary.alive,
    );
    if (!s) return null;
    const life: LifeStats = addRunToLife(s.summary.life, result, {
      ...run,
      damageDealt: Math.round(run.damageDealt),
      damageTaken: Math.round(run.damageTaken),
    });
    const exp = s.summary.exp + expGained;
    s.summary = {
      ...s.summary,
      exp,
      level: levelForExp(exp),
      life,
      alive: death === null,
      death,
    };
    if (death) s.diedSeq = ++this.seq;
    return structuredClone(s.summary);
  }

  async leaderboard(limit: number): Promise<LeaderboardEntry[]> {
    return [...this.serfs]
      .sort(
        (a, b) => b.summary.exp - a.summary.exp || a.summary.id - b.summary.id,
      )
      .slice(0, limit)
      .map((s, i) =>
        toEntry(
          i,
          s.summary.name,
          s.summary.exp,
          s.summary.classId,
          s.summary.alive,
        ),
      );
  }

  async chooseClass(
    accountId: number,
    serfId: number,
    classId: ClassId,
    minExp: number,
    stats: Stats,
    statsLevel: number,
  ): Promise<SerfSummary | null> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId &&
        x.summary.id === serfId &&
        x.summary.alive &&
        x.summary.classId === null &&
        x.summary.exp >= minExp &&
        x.statsLevel === statsLevel,
    );
    if (!s) return null;
    s.summary = { ...s.summary, classId, stats: { ...stats } };
    return structuredClone(s.summary);
  }

  async findWithStatsLevel(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; statsLevel: number } | null> {
    const s = this.serfs.find(
      (x) => x.accountId === accountId && x.summary.id === serfId,
    );
    return s
      ? { serf: structuredClone(s.summary), statsLevel: s.statsLevel }
      : null;
  }

  async saveStats(
    accountId: number,
    serfId: number,
    stats: Stats,
    fromLevel: number,
    toLevel: number,
  ): Promise<SerfSummary | null> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId &&
        x.summary.id === serfId &&
        x.summary.alive &&
        x.statsLevel === fromLevel,
    );
    if (!s) return null;
    s.summary = { ...s.summary, stats: { ...stats } };
    s.statsLevel = toLevel;
    return structuredClone(s.summary);
  }
}
