import {
  addRunToLife,
  drinkPotion,
  potionProblem,
  type PendingPotion,
  type Potion,
  type PotionDrop,
  type StatKey,
  EQUIP_SLOTS,
  isClassId,
  isValidItemSpec,
  sellPrice,
  levelForExp,
  newLifeStats,
  SERF_BASE,
  STAT_KEYS,
  type Stats,
  type ClassId,
  type EquipSlot,
  type Item,
  type ItemSpec,
  type LootDrop,
  type PendingReward,
  type LeaderboardEntry,
  type LeaderboardQuery,
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
    clear?: Clear | null,
  ): Promise<SerfSummary | null>;
  /**
   * A leaderboard (D-148), living and dead: lifetime EXP (optionally one
   * class), clears, or enemies slain (ties: older serf first); or each
   * serf's fastest clear of a dungeon (ties: the earlier clear).
   */
  leaderboard(
    query: LeaderboardQuery,
    limit: number,
  ): Promise<LeaderboardEntry[]>;
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
  /**
   * Gives a living serf's account its chest items (D-086–D-088), in order:
   * into the stash while it has room (`capacity` items at most), the rest
   * pending for that serf. Null if the serf is not this account's or is
   * dead. Atomic per account.
   */
  addLoot(
    accountId: number,
    serfId: number,
    items: readonly ItemSpec[],
    capacity: number,
  ): Promise<LootDrop[] | null>;
  /** The account's gold, stash items, and pending rewards (oldest first). */
  stash(accountId: number): Promise<Stash>;
  /**
   * Sells one of the account's stash or pending items to the vendor for
   * `sellPrice` gold (D-087, D-090), then moves pending rewards into any
   * room it made, oldest first. Null (and no change) if the account has no
   * such unworn item. Atomic per account, so an item sells once.
   */
  sell(
    accountId: number,
    itemId: number,
    capacity: number,
  ): Promise<{ price: number } | null>;
  /** Whether rewards wait for this serf (it may not start a dungeon, D-088). */
  hasPending(accountId: number, serfId: number): Promise<boolean>;
  /**
   * Once per serf (D-092): if this living, classed serf has not had its
   * free ability item, puts `item` in its ability slot and marks it given,
   * in one transaction. False if it was given before (or the serf is not
   * this account's, dead, or classless).
   */
  grantAbilityItem(
    accountId: number,
    serfId: number,
    item: ItemSpec,
  ): Promise<boolean>;
  /**
   * Puts one of the account's stash or pending items on a living serf in
   * `slot` (the caller has checked the rules). What was worn there goes to
   * the stash if it has room, else waits as pending for that serf (D-086,
   * D-087). Null (no change) if the item or serf is not this account's,
   * the item is worn, or the serf is dead. Atomic per account.
   */
  equip(
    accountId: number,
    serfId: number,
    itemId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<{ replacedPending: boolean } | null>;
  /**
   * Takes what a living serf wears in `slot` off into the stash: "full"
   * when the stash has no room (nothing changes), null when nothing is
   * worn there or the serf is not this account's.
   */
  unequip(
    accountId: number,
    serfId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<"ok" | "full" | null>;
  /**
   * Gives a living serf's account its won potions (D-118), in order: into
   * the rack while it has room (`capacity` potions at most), the rest
   * pending for that serf. Null if the serf is not this account's or is
   * dead. Atomic per account.
   */
  addPotions(
    accountId: number,
    serfId: number,
    stats: readonly StatKey[],
    capacity: number,
  ): Promise<PotionDrop[] | null>;
  /**
   * One of the account's potions drunk by one of its serfs, checked again
   * inside the write (alive, classed, below the max: `potionProblem`):
   * the stat goes up, the potion is gone, and the oldest pending potions
   * move into any room made. `refused` (no change) with a reason safe to
   * show; null if the potion or serf is not this account's. Atomic per
   * account, so a potion is drunk once.
   */
  drinkPotion(
    accountId: number,
    serfId: number,
    potionId: number,
    capacity: number,
  ): Promise<DrinkOutcome | null>;
  /** Pours out one of the account's potions (then fills the rack); false if none. */
  pourPotion(
    accountId: number,
    potionId: number,
    capacity: number,
  ): Promise<boolean>;
}

export type DrinkOutcome =
  { serf: SerfSummary; stat: StatKey } | { refused: string };

export interface Stash {
  gold: number;
  items: Item[];
  pending: PendingReward[];
  /** The potion rack and potions waiting for room (D-118), oldest first. */
  rack: Potion[];
  pendingPotions: PendingPotion[];
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
    items: [],
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

async function rackCount(client: pg.PoolClient, accountId: number) {
  const r = await client.query<{ n: string }>(
    "select count(*) n from potions where account_id = $1 and location = 'rack'",
    [accountId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Moves the oldest pending potions into whatever room the rack has (D-118). */
async function fillRack(
  client: pg.PoolClient,
  accountId: number,
  capacity: number,
) {
  const room = capacity - (await rackCount(client, accountId));
  if (room <= 0) return;
  await client.query(
    `update potions set location = 'rack', serf_id = null
     where id in (select id from potions where account_id = $1 and location = 'pending'
                  order by id limit $2)`,
    [accountId, room],
  );
}

interface PotionRow {
  id: string;
  serf_id: string | null;
  location: string;
  stat: string;
}

/** A stored potion of a stat the code does not know is a bug, not a potion. */
function potionFromRow(r: PotionRow): Potion {
  if (!(STAT_KEYS as readonly string[]).includes(r.stat)) {
    throw new Error(`bad potion ${r.id} in database`);
  }
  return { id: Number(r.id), stat: r.stat as StatKey };
}

async function stashCount(client: pg.PoolClient, accountId: number) {
  const r = await client.query<{ n: string }>(
    "select count(*) n from items where account_id = $1 and location = 'stash'",
    [accountId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

interface ItemRow {
  id: string;
  serf_id: string | null;
  location: string;
  slot: string;
  type: string | null;
  tier: number;
  rolls: unknown;
  luck: number;
  equipped: string | null;
}

/** A stored item the rules would never allow is a bug, not an item. */
function itemFromRow(r: ItemRow): Item {
  const spec = {
    slot: r.slot,
    type: r.type,
    tier: r.tier,
    rolls: r.rolls,
    luck: r.luck,
  } as ItemSpec;
  const equippedOk =
    r.equipped === null ||
    (EQUIP_SLOTS as readonly string[]).includes(r.equipped);
  if (!Array.isArray(r.rolls) || !isValidItemSpec(spec) || !equippedOk) {
    throw new Error(`bad item ${r.id} in database`);
  }
  return {
    ...spec,
    id: Number(r.id),
    equipped: r.equipped as EquipSlot | null,
  };
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
    return this.withItems([...living.rows, ...fallen.rows].map(fromRow));
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
      return fromRow(row); // a new serf has no items
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
    return this.one(r.rows[0]);
  }

  async recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    expGained: number,
    clear: Clear | null = null,
  ): Promise<SerfSummary | null> {
    // One statement: the "still alive" check and the update cannot be
    // separated by another write. A death also deletes everything the serf
    // had (D-079), in the same transaction.
    const client = await this.pool.connect();
    let r: pg.QueryResult<SerfRow>;
    try {
      await client.query("begin");
      r = await client.query<SerfRow>(
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
      if (death && r.rows[0]) {
        await client.query(
          "delete from items where serf_id = $1 and location = 'equipped'",
          [serfId],
        );
      }
      // The clear's record lands with the run, or not at all (D-148).
      if (clear && r.rows[0]) {
        await client.query(
          "insert into clears (serf_id, dungeon, seconds, party_size) values ($1, $2, $3, $4)",
          [serfId, clear.dungeon, run.seconds, clear.partySize],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return this.one(r.rows[0]);
  }

  async addLoot(
    accountId: number,
    serfId: number,
    items: readonly ItemSpec[],
    capacity: number,
  ): Promise<LootDrop[] | null> {
    return this.inAccount(accountId, async (client) => {
      const owner = await client.query(
        "select id from serfs where id = $1 and account_id = $2 and died_at is null",
        [serfId, accountId],
      );
      if (owner.rowCount === 0) return null;
      let room = capacity - (await stashCount(client, accountId));
      const drops: LootDrop[] = [];
      for (const spec of items) {
        const pending = room <= 0;
        const inserted = await client.query<{ id: string }>(
          `insert into items (account_id, serf_id, location, slot, type, tier, rolls, luck)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [
            accountId,
            pending ? serfId : null,
            pending ? "pending" : "stash",
            spec.slot,
            spec.type,
            spec.tier,
            JSON.stringify(spec.rolls),
            spec.luck,
          ],
        );
        drops.push({
          item: { ...spec, id: Number(inserted.rows[0]?.id), equipped: null },
          pending,
        });
        if (!pending) room--;
      }
      return drops;
    });
  }

  async stash(accountId: number): Promise<Stash> {
    const gold = await this.pool.query<{ gold: string }>(
      "select gold from accounts where id = $1",
      [accountId],
    );
    const r = await this.pool.query<ItemRow>(
      "select * from items where account_id = $1 and location <> 'equipped' order by id",
      [accountId],
    );
    const potions = await this.pool.query<PotionRow>(
      "select * from potions where account_id = $1 order by id",
      [accountId],
    );
    return {
      gold: Number(gold.rows[0]?.gold ?? 0),
      items: r.rows.filter((row) => row.location === "stash").map(itemFromRow),
      pending: r.rows
        .filter((row) => row.location === "pending")
        .map((row) => ({
          item: itemFromRow(row),
          serfId: Number(row.serf_id),
        })),
      rack: potions.rows
        .filter((row) => row.location === "rack")
        .map(potionFromRow),
      pendingPotions: potions.rows
        .filter((row) => row.location === "pending")
        .map((row) => ({
          potion: potionFromRow(row),
          serfId: Number(row.serf_id),
        })),
    };
  }

  async addPotions(
    accountId: number,
    serfId: number,
    stats: readonly StatKey[],
    capacity: number,
  ): Promise<PotionDrop[] | null> {
    return this.inAccount(accountId, async (client) => {
      const owner = await client.query(
        "select id from serfs where id = $1 and account_id = $2 and died_at is null",
        [serfId, accountId],
      );
      if (owner.rowCount === 0) return null;
      let room = capacity - (await rackCount(client, accountId));
      const drops: PotionDrop[] = [];
      for (const stat of stats) {
        const pending = room <= 0;
        const inserted = await client.query<{ id: string }>(
          `insert into potions (account_id, serf_id, location, stat)
           values ($1, $2, $3, $4) returning id`,
          [
            accountId,
            pending ? serfId : null,
            pending ? "pending" : "rack",
            stat,
          ],
        );
        drops.push({
          potion: { id: Number(inserted.rows[0]?.id), stat },
          pending,
        });
        if (!pending) room--;
      }
      return drops;
    });
  }

  async drinkPotion(
    accountId: number,
    serfId: number,
    potionId: number,
    capacity: number,
  ): Promise<DrinkOutcome | null> {
    const outcome = await this.inAccount(accountId, async (client) => {
      const potion = await client.query<PotionRow>(
        "select * from potions where id = $1 and account_id = $2",
        [potionId, accountId],
      );
      const found = await client.query<SerfRow>(
        "select * from serfs where id = $1 and account_id = $2",
        [serfId, accountId],
      );
      const potionRow = potion.rows[0];
      const serfRow = found.rows[0];
      if (!potionRow || !serfRow) return null;
      const { stat } = potionFromRow(potionRow);
      const serf = fromRow(serfRow);
      const problem = potionProblem(serf, stat);
      if (problem) return { refused: problem } as const;
      const drunk = await client.query<SerfRow>(
        `update serfs set stats = $3
         where id = $1 and account_id = $2 and died_at is null returning *`,
        [
          serfId,
          accountId,
          JSON.stringify(drinkPotion(serf.stats, serf.classId, stat)),
        ],
      );
      await client.query("delete from potions where id = $1", [potionId]);
      await fillRack(client, accountId, capacity);
      return { row: drunk.rows[0], stat } as const;
    });
    if (!outcome) return null;
    if (outcome.refused !== undefined) return { refused: outcome.refused };
    const serf = await this.one(outcome.row);
    return serf ? { serf, stat: outcome.stat } : null;
  }

  async pourPotion(
    accountId: number,
    potionId: number,
    capacity: number,
  ): Promise<boolean> {
    const poured = await this.inAccount(accountId, async (client) => {
      const gone = await client.query(
        "delete from potions where id = $1 and account_id = $2",
        [potionId, accountId],
      );
      if (gone.rowCount === 0) return null;
      await fillRack(client, accountId, capacity);
      return true;
    });
    return poured === true;
  }

  async sell(
    accountId: number,
    itemId: number,
    capacity: number,
  ): Promise<{ price: number } | null> {
    return this.inAccount(accountId, async (client) => {
      const gone = await client.query<ItemRow>(
        "delete from items where id = $1 and account_id = $2 and location <> 'equipped' returning *",
        [itemId, accountId],
      );
      const row = gone.rows[0];
      if (!row) return null;
      const price = sellPrice(itemFromRow(row));
      await client.query("update accounts set gold = gold + $2 where id = $1", [
        accountId,
        price,
      ]);
      // Room made: the oldest waiting rewards move in (D-088).
      const room = capacity - (await stashCount(client, accountId));
      if (room > 0) {
        await client.query(
          `update items set location = 'stash', serf_id = null
           where id in (select id from items where account_id = $1 and location = 'pending'
                        order by id limit $2)`,
          [accountId, room],
        );
      }
      return { price };
    });
  }

  async grantAbilityItem(
    accountId: number,
    serfId: number,
    item: ItemSpec,
  ): Promise<boolean> {
    const granted = await this.inAccount(accountId, async (client) => {
      const r = await client.query(
        `update serfs set ability_granted = true
         where id = $1 and account_id = $2 and died_at is null
           and class_id is not null and not ability_granted
         returning id`,
        [serfId, accountId],
      );
      if (r.rowCount === 0) return null;
      // The ability slot is empty: only the class's own item fits there,
      // and none existed before the grant (D-096).
      await client.query(
        `insert into items (account_id, serf_id, location, equipped, slot, type, tier, rolls, luck)
         values ($1, $2, 'equipped', 'ability', $3, $4, $5, $6, $7)`,
        [
          accountId,
          serfId,
          item.slot,
          item.type,
          item.tier,
          JSON.stringify(item.rolls),
          item.luck,
        ],
      );
      return true;
    });
    return granted === true;
  }

  async hasPending(accountId: number, serfId: number): Promise<boolean> {
    // Items or potions (D-118) waiting for room.
    const r = await this.pool.query(
      `select 1 from items where account_id = $1 and serf_id = $2 and location = 'pending'
       union all
       select 1 from potions where account_id = $1 and serf_id = $2 and location = 'pending'
       limit 1`,
      [accountId, serfId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async equip(
    accountId: number,
    serfId: number,
    itemId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<{ replacedPending: boolean } | null> {
    return this.inAccount(accountId, async (client) => {
      const serf = await client.query(
        "select id from serfs where id = $1 and account_id = $2 and died_at is null",
        [serfId, accountId],
      );
      const item = await client.query<{ location: string }>(
        "select location from items where id = $1 and account_id = $2 and location <> 'equipped'",
        [itemId, accountId],
      );
      const from = item.rows[0]?.location;
      if (serf.rowCount === 0 || !from) return null;
      // Room after the new item leaves the stash (if it was there).
      const room =
        capacity -
        (await stashCount(client, accountId)) +
        (from === "stash" ? 1 : 0);
      const replaced = await client.query(
        `update items set location = $4, serf_id = $5, equipped = null
         where account_id = $1 and serf_id = $2 and location = 'equipped' and equipped = $3
         returning id`,
        [
          accountId,
          serfId,
          slot,
          room > 0 ? "stash" : "pending",
          room > 0 ? null : serfId,
        ],
      );
      await client.query(
        "update items set location = 'equipped', serf_id = $2, equipped = $3 where id = $1",
        [itemId, serfId, slot],
      );
      return { replacedPending: (replaced.rowCount ?? 0) > 0 && room <= 0 };
    });
  }

  async unequip(
    accountId: number,
    serfId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<"ok" | "full" | null> {
    return this.inAccount(accountId, async (client) => {
      const worn = await client.query<{ id: string }>(
        `select items.id from items join serfs on serfs.id = items.serf_id
         where items.account_id = $1 and items.serf_id = $2 and items.location = 'equipped'
           and items.equipped = $3 and serfs.died_at is null`,
        [accountId, serfId, slot],
      );
      const id = worn.rows[0]?.id;
      if (!id) return null;
      if ((await stashCount(client, accountId)) >= capacity) return "full";
      await client.query(
        "update items set location = 'stash', serf_id = null, equipped = null where id = $1",
        [id],
      );
      return "ok";
    });
  }

  /**
   * Runs `work` in a transaction holding the account row's lock, so every
   * stash and gold change for one account happens one at a time (no two
   * rewards take the last slot, no item sells twice). Null from `work`
   * rolls back.
   */
  private async inAccount<T>(
    accountId: number,
    work: (client: pg.PoolClient) => Promise<T | null>,
  ): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from accounts where id = $1 for update", [
        accountId,
      ]);
      const result = await work(client);
      await client.query(result === null ? "rollback" : "commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** One serf row, with its items, or null. */
  private async one(row: SerfRow | undefined): Promise<SerfSummary | null> {
    if (!row) return null;
    const [serf] = await this.withItems([fromRow(row)]);
    return serf ?? null;
  }

  /** Fills in what each living serf wears (the dead have nothing, D-079). */
  private async withItems(serfs: SerfSummary[]): Promise<SerfSummary[]> {
    const ids = serfs.filter((x) => x.alive).map((x) => x.id);
    if (ids.length === 0) return serfs;
    const r = await this.pool.query<ItemRow>(
      "select * from items where serf_id = any($1::bigint[]) and location = 'equipped' order by id",
      [ids],
    );
    const bySerf = new Map<number, Item[]>();
    for (const row of r.rows) {
      const list = bySerf.get(Number(row.serf_id)) ?? [];
      list.push(itemFromRow(row));
      bySerf.set(Number(row.serf_id), list);
    }
    return serfs.map((x) => ({ ...x, items: bySerf.get(x.id) ?? [] }));
  }

  async leaderboard(
    query: LeaderboardQuery,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    type Row = {
      name: string;
      exp: string;
      class_id: string | null;
      died_at: Date | null;
      value: string | number;
      party_size: number | null;
    };
    let r: pg.QueryResult<Row>;
    if (query.board === "fastest") {
      // Each serf's best time, then the best of those (D-148).
      r = await this.pool.query<Row>(
        `select s.name, s.exp, s.class_id, s.died_at,
                b.seconds as value, b.party_size
         from (select distinct on (serf_id) serf_id, seconds, party_size, id
               from clears
               where dungeon = $2 and (not $3::boolean or party_size = 1)
               order by serf_id, seconds, id) b
         join serfs s on s.id = b.serf_id
         order by b.seconds, b.id
         limit $1`,
        [limit, query.dungeon ?? "", query.soloOnly],
      );
    } else if (query.board === "exp") {
      r = await this.pool.query<Row>(
        `select name, exp, class_id, died_at, exp as value, null as party_size
         from serfs where ($2::text is null or class_id = $2)
         order by exp desc, id limit $1`,
        [limit, query.classId],
      );
    } else {
      // A fixed column per board: never built from the request.
      const column = query.board === "clears" ? "clears" : "enemies_defeated";
      r = await this.pool.query<Row>(
        `select name, exp, class_id, died_at, ${column} as value,
                null as party_size
         from serfs where ${column} > 0
         order by ${column} desc, id limit $1`,
        [limit],
      );
    }
    return r.rows.map((row, i) =>
      toEntry(
        i,
        row.name,
        Number(row.exp),
        classFromRow(row.class_id),
        row.died_at === null,
        Number(row.value),
        row.party_size,
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
    return this.one(r.rows[0]);
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
    const serf = await this.one(row);
    return serf && row ? { serf, statsLevel: row.stats_level } : null;
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
    return this.one(r.rows[0]);
  }
}

function toEntry(
  index: number,
  name: string,
  exp: number,
  classId: ClassId | null,
  alive: boolean,
  value: number,
  partySize: number | null,
): LeaderboardEntry {
  return {
    rank: index + 1,
    name,
    level: levelForExp(exp),
    value,
    classId,
    alive,
    partySize,
  };
}

/** A completed run, for the fastest clears (D-148). */
export interface Clear {
  dungeon: string;
  partySize: number;
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

interface MemorySerf {
  accountId: number;
  summary: SerfSummary;
  statsLevel: number;
  abilityGranted?: boolean;
  createdSeq: number;
  diedSeq: number | null;
}

/** In-memory twin of PgSerfRepo (game-server tests). */
interface MemoryClear extends Clear {
  serfId: number;
  seconds: number;
  seq: number;
}

export class MemorySerfRepo implements SerfRepo {
  private readonly serfs: MemorySerf[] = [];
  private readonly clears: MemoryClear[] = [];
  private seq = 0;
  private nextItemId = 1;
  private items: {
    accountId: number;
    serfId: number | null;
    location: "stash" | "equipped" | "pending";
    item: Item;
  }[] = [];
  private readonly gold = new Map<number, number>();
  private nextPotionId = 1;
  private potions: {
    accountId: number;
    serfId: number | null;
    location: "rack" | "pending";
    potion: Potion;
  }[] = [];

  /** A copy for the caller, with what the serf wears. */
  private out(m: MemorySerf): SerfSummary {
    const worn = this.items
      .filter((x) => x.serfId === m.summary.id && x.location === "equipped")
      .map((x) => x.item);
    return structuredClone({ ...m.summary, items: worn });
  }

  async list(accountId: number): Promise<SerfSummary[]> {
    const mine = this.serfs.filter((s) => s.accountId === accountId);
    const living = mine
      .filter((s) => s.summary.alive)
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const fallen = mine
      .filter((s) => !s.summary.alive)
      .sort((a, b) => (b.diedSeq ?? 0) - (a.diedSeq ?? 0))
      .slice(0, FALLEN_SHOWN);
    return [...living, ...fallen].map((s) => this.out(s));
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
      items: [],
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
    return s ? this.out(s) : null;
  }

  async recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    expGained: number,
    clear: Clear | null = null,
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
    if (clear) {
      this.clears.push({
        ...clear,
        serfId,
        seconds: run.seconds,
        seq: ++this.seq,
      });
    }
    if (death) {
      s.diedSeq = ++this.seq;
      // D-079: what it wore is gone; the stash and pending rewards stay.
      this.items = this.items.filter(
        (x) => !(x.serfId === serfId && x.location === "equipped"),
      );
    }
    return this.out(s);
  }

  async leaderboard(
    query: LeaderboardQuery,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const entry = (
      s: MemorySerf,
      i: number,
      value: number,
      partySize: number | null,
    ) =>
      toEntry(
        i,
        s.summary.name,
        s.summary.exp,
        s.summary.classId,
        s.summary.alive,
        value,
        partySize,
      );
    if (query.board === "fastest") {
      const best = new Map<number, MemoryClear>();
      for (const c of this.clears) {
        if (c.dungeon !== query.dungeon) continue;
        if (query.soloOnly && c.partySize !== 1) continue;
        const was = best.get(c.serfId);
        if (!was || c.seconds < was.seconds) best.set(c.serfId, c);
      }
      return [...best.values()]
        .sort((a, b) => a.seconds - b.seconds || a.seq - b.seq)
        .slice(0, limit)
        .map((c, i) => {
          const s = this.serfs.find((x) => x.summary.id === c.serfId)!;
          return entry(s, i, c.seconds, c.partySize);
        });
    }
    const score = (s: MemorySerf) =>
      query.board === "exp"
        ? s.summary.exp
        : query.board === "clears"
          ? s.summary.life.clears
          : s.summary.life.enemiesDefeated;
    return this.serfs
      .filter((s) =>
        query.board === "exp"
          ? query.classId === null || s.summary.classId === query.classId
          : score(s) > 0,
      )
      .sort((a, b) => score(b) - score(a) || a.summary.id - b.summary.id)
      .slice(0, limit)
      .map((s, i) => entry(s, i, score(s), null));
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
    return this.out(s);
  }

  async findWithStatsLevel(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; statsLevel: number } | null> {
    const s = this.serfs.find(
      (x) => x.accountId === accountId && x.summary.id === serfId,
    );
    return s ? { serf: this.out(s), statsLevel: s.statsLevel } : null;
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
    return this.out(s);
  }

  async addLoot(
    accountId: number,
    serfId: number,
    items: readonly ItemSpec[],
    capacity: number,
  ): Promise<LootDrop[] | null> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId && x.summary.id === serfId && x.summary.alive,
    );
    if (!s) return null;
    let room = capacity - this.stashOf(accountId).length;
    return items.map((spec) => {
      const pending = room <= 0;
      const item: Item = {
        ...structuredClone(spec),
        id: this.nextItemId++,
        equipped: null,
      };
      this.items.push({
        accountId,
        serfId: pending ? serfId : null,
        location: pending ? "pending" : "stash",
        item,
      });
      if (!pending) room--;
      return { item: structuredClone(item), pending };
    });
  }

  async stash(accountId: number): Promise<Stash> {
    const potions = this.potions.filter((x) => x.accountId === accountId);
    return structuredClone({
      gold: this.gold.get(accountId) ?? 0,
      items: this.stashOf(accountId).map((x) => x.item),
      pending: this.items
        .filter((x) => x.accountId === accountId && x.location === "pending")
        .map((x) => ({ item: x.item, serfId: x.serfId ?? 0 })),
      rack: potions.filter((x) => x.location === "rack").map((x) => x.potion),
      pendingPotions: potions
        .filter((x) => x.location === "pending")
        .map((x) => ({ potion: x.potion, serfId: x.serfId ?? 0 })),
    });
  }

  async addPotions(
    accountId: number,
    serfId: number,
    stats: readonly StatKey[],
    capacity: number,
  ): Promise<PotionDrop[] | null> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId && x.summary.id === serfId && x.summary.alive,
    );
    if (!s) return null;
    let room = capacity - this.rackOf(accountId).length;
    return stats.map((stat) => {
      const pending = room <= 0;
      const potion = { id: this.nextPotionId++, stat };
      this.potions.push({
        accountId,
        serfId: pending ? serfId : null,
        location: pending ? "pending" : "rack",
        potion,
      });
      if (!pending) room--;
      return { potion: { ...potion }, pending };
    });
  }

  async drinkPotion(
    accountId: number,
    serfId: number,
    potionId: number,
    capacity: number,
  ): Promise<DrinkOutcome | null> {
    const entry = this.potions.find(
      (x) => x.accountId === accountId && x.potion.id === potionId,
    );
    const s = this.serfs.find(
      (x) => x.accountId === accountId && x.summary.id === serfId,
    );
    if (!entry || !s) return null;
    const { stat } = entry.potion;
    const problem = potionProblem(s.summary, stat);
    if (problem) return { refused: problem };
    s.summary = {
      ...s.summary,
      stats: drinkPotion(s.summary.stats, s.summary.classId, stat),
    };
    this.potions = this.potions.filter((x) => x !== entry);
    this.fillRack(accountId, capacity);
    return { serf: this.out(s), stat };
  }

  async pourPotion(
    accountId: number,
    potionId: number,
    capacity: number,
  ): Promise<boolean> {
    const before = this.potions.length;
    this.potions = this.potions.filter(
      (x) => !(x.accountId === accountId && x.potion.id === potionId),
    );
    if (this.potions.length === before) return false;
    this.fillRack(accountId, capacity);
    return true;
  }

  private rackOf(accountId: number) {
    return this.potions.filter(
      (x) => x.accountId === accountId && x.location === "rack",
    );
  }

  private fillRack(accountId: number, capacity: number): void {
    let room = capacity - this.rackOf(accountId).length;
    for (const x of this.potions) {
      if (room <= 0) break;
      if (x.accountId === accountId && x.location === "pending") {
        x.location = "rack";
        x.serfId = null;
        room--;
      }
    }
  }

  async sell(
    accountId: number,
    itemId: number,
    capacity: number,
  ): Promise<{ price: number } | null> {
    const found = this.items.find(
      (x) =>
        x.accountId === accountId &&
        x.item.id === itemId &&
        x.location !== "equipped",
    );
    if (!found) return null;
    this.items = this.items.filter((x) => x !== found);
    const price = sellPrice(found.item);
    this.gold.set(accountId, (this.gold.get(accountId) ?? 0) + price);
    let room = capacity - this.stashOf(accountId).length;
    for (const x of this.items) {
      if (room <= 0) break;
      if (x.accountId === accountId && x.location === "pending") {
        x.location = "stash";
        x.serfId = null;
        room--;
      }
    }
    return { price };
  }

  async grantAbilityItem(
    accountId: number,
    serfId: number,
    item: ItemSpec,
  ): Promise<boolean> {
    const s = this.serfs.find(
      (x) =>
        x.accountId === accountId &&
        x.summary.id === serfId &&
        x.summary.alive &&
        x.summary.classId !== null &&
        !x.abilityGranted,
    );
    if (!s) return false;
    s.abilityGranted = true;
    this.items.push({
      accountId,
      serfId,
      location: "equipped",
      item: {
        ...structuredClone(item),
        id: this.nextItemId++,
        equipped: "ability",
      },
    });
    return true;
  }

  async hasPending(accountId: number, serfId: number): Promise<boolean> {
    const waits = (x: {
      accountId: number;
      serfId: number | null;
      location: string;
    }) =>
      x.accountId === accountId &&
      x.serfId === serfId &&
      x.location === "pending";
    return this.items.some(waits) || this.potions.some(waits);
  }

  async equip(
    accountId: number,
    serfId: number,
    itemId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<{ replacedPending: boolean } | null> {
    const serf = this.serfs.find(
      (x) =>
        x.accountId === accountId && x.summary.id === serfId && x.summary.alive,
    );
    const entry = this.items.find(
      (x) =>
        x.accountId === accountId &&
        x.item.id === itemId &&
        x.location !== "equipped",
    );
    if (!serf || !entry) return null;
    const room =
      capacity -
      this.stashOf(accountId).length +
      (entry.location === "stash" ? 1 : 0);
    const old = this.items.find(
      (x) =>
        x.serfId === serfId &&
        x.location === "equipped" &&
        x.item.equipped === slot,
    );
    if (old) {
      old.location = room > 0 ? "stash" : "pending";
      old.serfId = room > 0 ? null : serfId;
      old.item = { ...old.item, equipped: null };
    }
    entry.location = "equipped";
    entry.serfId = serfId;
    entry.item = { ...entry.item, equipped: slot };
    return { replacedPending: old !== undefined && room <= 0 };
  }

  async unequip(
    accountId: number,
    serfId: number,
    slot: EquipSlot,
    capacity: number,
  ): Promise<"ok" | "full" | null> {
    const alive = this.serfs.some(
      (x) =>
        x.accountId === accountId && x.summary.id === serfId && x.summary.alive,
    );
    const worn = this.items.find(
      (x) =>
        x.accountId === accountId &&
        x.serfId === serfId &&
        x.location === "equipped" &&
        x.item.equipped === slot,
    );
    if (!alive || !worn) return null;
    if (this.stashOf(accountId).length >= capacity) return "full";
    worn.location = "stash";
    worn.serfId = null;
    worn.item = { ...worn.item, equipped: null };
    return "ok";
  }

  private stashOf(accountId: number) {
    return this.items.filter(
      (x) => x.accountId === accountId && x.location === "stash",
    );
  }
}
