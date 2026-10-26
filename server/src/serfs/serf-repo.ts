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
  drinkPotionTally,
  zeroStats,
  type ArtifactId,
  NO_UPGRADES,
  type UpgradeKind,
  type Upgrades,
  exchangeFee,
  type Listing,
  type Sale,
  fitsOrder,
  listingName,
  marketKeyOf,
  type BuyOrder,
  type MarketKey,
  type PriceWindow,
  type RollWish,
  isFreeTier0,
  type Wear,
  EXCHANGE,
  filterListings,
  usableKinds,
  type ExchangeQuery,
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
    /** What it wears from the start (D-157's Tier 0 set). */
    wear?: readonly Wear[],
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
   * The Exchange (D-155, D-156). Every change runs one at a time. Listing
   * a stash item or rack potion sells it at once to the best fitting buy
   * order (at the order's price), else lists it; ordering buys the
   * cheapest fitting listing at once (at its price), else sets the gold
   * aside. Bought things wait in the buyer's collection box.
   */
  listOnExchange(
    accountId: number,
    what: { itemId: number } | { potionId: number },
    price: number,
    maxListings: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "listed" }>;
  cancelListing(
    accountId: number,
    listingId: number,
    room: { stash: number; rack: number },
  ): Promise<"ok" | "notYours" | "noRoom">;
  buyListing(
    buyerId: number,
    listingId: number,
  ): Promise<ExchangeDeal | ExchangeRefusal>;
  placeOrder(
    buyerId: number,
    key: MarketKey,
    rolls: readonly RollWish[],
    price: number,
    maxOrders: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "placed" }>;
  cancelOrder(buyerId: number, orderId: number): Promise<boolean>;
  sellToOrder(
    sellerId: number,
    orderId: number,
    what: { itemId: number } | { potionId: number },
  ): Promise<ExchangeDeal | ExchangeRefusal>;
  /** Moves the collection box into the stash and rack, as far as they have room; returns what is left. */
  collect(
    accountId: number,
    room: { stash: number; rack: number },
  ): Promise<number>;
  collection(accountId: number): Promise<{ items: Item[]; potions: Potion[] }>;
  /** Every listing on the Exchange, with its seller (tests and tools; the game pages instead). */
  allListings(): Promise<(Listing & { sellerId: number })[]>;
  /** Every buy order, with its buyer (tests and tools). */
  allOrders(): Promise<(BuyOrder & { buyerId: number })[]>;
  /**
   * One page of the Exchange for a viewer (D-156): exactly
   * `filterListings` over every listing, but done by the storage, so only
   * the page is loaded. The viewer's own listings are marked.
   */
  browse(
    viewerId: number,
    query: ExchangeQuery,
  ): Promise<{ total: number; listings: Listing[] }>;
  /** This seller's listings, oldest first. */
  listingsOf(sellerId: number): Promise<Listing[]>;
  /** This buyer's orders, best first. */
  ordersOf(buyerId: number): Promise<BuyOrder[]>;
  /** The best `limit` orders for one kind of item, best first; the viewer's marked. */
  ordersFor(
    key: MarketKey,
    viewerId: number,
    limit: number,
  ): Promise<BuyOrder[]>;
  /** The average sale price of one kind of item over the windows (D-156). */
  priceWindows(key: MarketKey): Promise<PriceWindow[]>;
  /** An account's latest sales and purchases, newest first. */
  sales(accountId: number, limit: number): Promise<Sale[]>;
  /** How many of each upgrade the account has bought (D-154). */
  upgrades(accountId: number): Promise<Upgrades>;
  /** Adds gold to an account (tests and admin scripts; play earns it by selling). */
  addGold(accountId: number, amount: number): Promise<void>;
  /**
   * Buys one more of `kind` for `price` gold, only if the account still has
   * `expected` of it and enough gold, in one write. False if not.
   */
  buyUpgrade(
    accountId: number,
    kind: UpgradeKind,
    expected: number,
    price: number,
  ): Promise<boolean>;
  /** Deletes the worn item that is this Artifact (D-153); false if there is none. */
  destroyWorn(
    accountId: number,
    serfId: number,
    artifact: ArtifactId,
  ): Promise<boolean>;
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
   * Once per serf (D-157): answers the free Tier 0 class set offer of this
   * living, classed serf. Deletes the listed worn Tier 0 items (`dropIds`;
   * anything else is kept), then creates and wears `wear`, each piece only
   * where its slot is empty, all in one transaction. False if it was
   * answered before (or the serf is not this account's, dead, or classless).
   */
  answerClassSet(
    accountId: number,
    serfId: number,
    wear: readonly Wear[],
    dropIds: readonly number[],
  ): Promise<boolean>;
  /** Creates `item` in the account's stash if it has room (a free Tier 0 item, D-157). */
  addToStash(
    accountId: number,
    item: ItemSpec,
    capacity: number,
  ): Promise<Item | "full">;
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
  ability_granted: boolean;
  id: string;
  name: string;
  exp: string;
  class_id: string | null;
  stats: unknown;
  potion_stats: unknown;
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
  const classId = classFromRow(r.class_id);
  const exp = Number(r.exp);
  return {
    id: Number(r.id),
    name: r.name,
    level: levelForExp(exp),
    exp,
    classId,
    stats: statsFromRow(r.stats),
    potionStats: statsFromRow(r.potion_stats),
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
    // The class set waits until answered (D-157; the 008 flag).
    classSetOffered: alive && classId !== null && !r.ability_granted,
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
  artifact: string | null;
  shiny: boolean;
}

/** A stored item the rules would never allow is a bug, not an item. */
function itemFromRow(r: ItemRow): Item {
  const spec = {
    slot: r.slot,
    type: r.type,
    tier: r.tier,
    rolls: r.rolls,
    luck: r.luck,
    // Only on Artifacts and Shiny items (D-152): absent otherwise.
    ...(r.artifact !== null ? { artifact: r.artifact } : {}),
    ...(r.shiny ? { shiny: true } : {}),
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
    wear: readonly Wear[] = [],
  ): Promise<CreateResult> {
    const client = await this.pool.connect();
    let row: SerfRow;
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
      const inserted = r.rows[0];
      if (!inserted) throw new Error("insert returned no row");
      row = inserted;
      await insertWorn(client, accountId, Number(row.id), wear);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) return "nameTaken";
      throw err;
    } finally {
      client.release();
    }
    // Read what it wears only after giving the connection back: asking the
    // pool for a second one while holding this one can starve the pool
    // when many serfs are made at once.
    const [made] = await this.withItems([fromRow(row)]);
    return made!;
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
          `insert into items (account_id, serf_id, location, slot, type, tier, rolls, luck, artifact, shiny)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [
            accountId,
            pending ? serfId : null,
            pending ? "pending" : "stash",
            spec.slot,
            spec.type,
            spec.tier,
            JSON.stringify(spec.rolls),
            spec.luck,
            spec.artifact ?? null,
            spec.shiny === true,
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
      "select * from items where account_id = $1 and location in ('stash', 'pending') order by id",
      [accountId],
    );
    const potions = await this.pool.query<PotionRow>(
      "select * from potions where account_id = $1 and location in ('rack', 'pending') order by id",
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
        "select * from potions where id = $1 and account_id = $2 and location in ('rack', 'pending')",
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
      // The stat and the potion tally (D-151) change together.
      const drunk = await client.query<SerfRow>(
        `update serfs set stats = $3, potion_stats = $4
         where id = $1 and account_id = $2 and died_at is null returning *`,
        [
          serfId,
          accountId,
          JSON.stringify(drinkPotion(serf.stats, serf.classId, stat)),
          JSON.stringify(
            drinkPotionTally(serf.potionStats, serf.stats, serf.classId, stat),
          ),
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
        "delete from potions where id = $1 and account_id = $2 and location in ('rack', 'pending')",
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
        "delete from items where id = $1 and account_id = $2 and location in ('stash', 'pending') returning *",
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

  async answerClassSet(
    accountId: number,
    serfId: number,
    wear: readonly Wear[],
    dropIds: readonly number[],
  ): Promise<boolean> {
    const done = await this.inAccount(accountId, async (client) => {
      const r = await client.query(
        `update serfs set ability_granted = true
         where id = $1 and account_id = $2 and died_at is null
           and class_id is not null and not ability_granted
         returning id`,
        [serfId, accountId],
      );
      if (r.rowCount === 0) return null;
      // Only worn Tier 0 pieces go: they are free (D-157).
      await client.query(
        `delete from items where id = any($1::bigint[]) and serf_id = $2
           and location = 'equipped' and tier = 0 and artifact is null`,
        [[...dropIds], serfId],
      );
      await insertWorn(client, accountId, serfId, wear);
      return true;
    });
    return done === true;
  }

  async addToStash(
    accountId: number,
    item: ItemSpec,
    capacity: number,
  ): Promise<Item | "full"> {
    const made = await this.inAccount(accountId, async (client) => {
      if ((await stashCount(client, accountId)) >= capacity) {
        return "full" as const;
      }
      const r = await client.query<ItemRow>(
        `insert into items (account_id, location, slot, type, tier, rolls, luck)
         values ($1, 'stash', $2, $3, $4, $5, $6) returning *`,
        [
          accountId,
          item.slot,
          item.type,
          item.tier,
          JSON.stringify(item.rolls),
          item.luck,
        ],
      );
      return itemFromRow(r.rows[0]!);
    });
    return made ?? "full";
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
        "select location from items where id = $1 and account_id = $2 and location in ('stash', 'pending')",
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

  /**
   * One Exchange change (D-156): a transaction holding the one Exchange
   * lock, so trades run one at a time: matching never races or deadlocks.
   */
  private async exchangeTx<T>(
    work: (client: pg.PoolClient) => Promise<{ value: T; commit: boolean }>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [EXCHANGE_LOCK]);
      const { value, commit } = await work(client);
      await client.query(commit ? "commit" : "rollback");
      return value;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** A listed, stashed, or racked thing by its row, as the Exchange sees it. */
  private async thingOf(
    client: pg.PoolClient,
    ref: { itemId: string | number | null; potionId: string | number | null },
  ): Promise<{ item: Item | null; potion: Potion | null } | null> {
    if (ref.itemId !== null) {
      const r = await client.query<ItemRow>(
        "select * from items where id = $1",
        [ref.itemId],
      );
      return r.rows[0] ? { item: itemFromRow(r.rows[0]), potion: null } : null;
    }
    const r = await client.query<PotionRow>(
      "select * from potions where id = $1",
      [ref.potionId],
    );
    return r.rows[0] ? { item: null, potion: potionFromRow(r.rows[0]) } : null;
  }

  /** Hands a thing to the buyer's collection box, pays the seller less the fee, records the sale. */
  private async settle(
    client: pg.PoolClient,
    deal: {
      sellerId: number;
      buyerId: number;
      thing: { item: Item | null; potion: Potion | null };
      price: number;
      /** Gold the buyer pays now (0 when an order already set it aside). */
      buyerPays: number;
    },
  ): Promise<ExchangeDeal> {
    const { sellerId, buyerId, thing, price } = deal;
    if (thing.item) {
      await client.query(
        "update items set account_id = $2, serf_id = null, location = 'collect' where id = $1",
        [thing.item.id, buyerId],
      );
    } else if (thing.potion) {
      await client.query(
        "update potions set account_id = $2, serf_id = null, location = 'collect' where id = $1",
        [thing.potion.id, buyerId],
      );
    }
    const fee = exchangeFee(price);
    if (deal.buyerPays > 0) {
      await client.query("update accounts set gold = gold - $2 where id = $1", [
        buyerId,
        deal.buyerPays,
      ]);
    }
    await client.query("update accounts set gold = gold + $2 where id = $1", [
      sellerId,
      price - fee,
    ]);
    const what = listingName(thing);
    const key = marketKeyOfThing(thing);
    await client.query(
      "insert into sales (seller_id, buyer_id, what, price, fee, market_key) values ($1, $2, $3, $4, $5, $6)",
      [sellerId, buyerId, what, price, fee, key],
    );
    return { kind: "deal", sellerId, buyerId, what, price, fee };
  }

  async listOnExchange(
    accountId: number,
    what: { itemId: number } | { potionId: number },
    price: number,
    maxListings: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "listed" }> {
    return this.exchangeTx<ExchangeDeal | ExchangeRefusal | { kind: "listed" }>(
      async (client) => {
        const owned =
          "itemId" in what
            ? await client.query(
                "select id from items where id = $1 and account_id = $2 and location = 'stash'",
                [what.itemId, accountId],
              )
            : await client.query(
                "select id from potions where id = $1 and account_id = $2 and location = 'rack'",
                [what.potionId, accountId],
              );
        if ((owned.rowCount ?? 0) === 0)
          return { value: refusal("notYours"), commit: false };
        const thing = (await this.thingOf(client, {
          itemId: "itemId" in what ? what.itemId : null,
          potionId: "potionId" in what ? what.potionId : null,
        }))!;
        if (thing.item && isFreeTier0(thing.item)) {
          return { value: refusal("free"), commit: false };
        }
        const key = marketKeyOfThing(thing);
        // The best fitting order pays its own price (it was there first).
        const orders = await client.query<OrderRow>(
          "select * from orders where market_key = $1 and price >= $2 and buyer_id <> $3 order by price desc, placed_at, id",
          [key, price, accountId],
        );
        const order = orders.rows.find((o) =>
          fitsOrder(thing, { key, rolls: o.rolls as RollWish[] }),
        );
        if (order) {
          await client.query("delete from orders where id = $1", [order.id]);
          const deal = await this.settle(client, {
            sellerId: accountId,
            buyerId: Number(order.buyer_id),
            thing,
            price: order.price,
            buyerPays: 0,
          });
          return { value: deal, commit: true };
        }
        const n = await client.query<{ n: string }>(
          "select count(*) n from listings where seller_id = $1",
          [accountId],
        );
        if (Number(n.rows[0]?.n ?? 0) >= maxListings)
          return { value: refusal("tooMany"), commit: false };
        if (thing.item) {
          await client.query(
            "update items set location = 'listed' where id = $1",
            [thing.item.id],
          );
        } else {
          await client.query(
            "update potions set location = 'listed' where id = $1",
            [thing.potion!.id],
          );
        }
        await client.query(
          "insert into listings (seller_id, item_id, potion_id, price, market_key) values ($1, $2, $3, $4, $5)",
          [
            accountId,
            thing.item?.id ?? null,
            thing.potion?.id ?? null,
            price,
            key,
          ],
        );
        return { value: { kind: "listed" as const }, commit: true };
      },
    );
  }

  async cancelListing(
    accountId: number,
    listingId: number,
    room: { stash: number; rack: number },
  ): Promise<"ok" | "notYours" | "noRoom"> {
    return this.exchangeTx(async (client) => {
      const l = await client.query<ListingRow>(
        "select * from listings where id = $1 and seller_id = $2",
        [listingId, accountId],
      );
      const row = l.rows[0];
      if (!row) return { value: "notYours" as const, commit: false };
      if (row.item_id !== null) {
        if ((await stashCount(client, accountId)) >= room.stash)
          return { value: "noRoom" as const, commit: false };
        await client.query(
          "update items set location = 'stash' where id = $1",
          [row.item_id],
        );
      } else {
        if ((await rackCount(client, accountId)) >= room.rack)
          return { value: "noRoom" as const, commit: false };
        await client.query(
          "update potions set location = 'rack' where id = $1",
          [row.potion_id],
        );
      }
      await client.query("delete from listings where id = $1", [listingId]);
      return { value: "ok" as const, commit: true };
    });
  }

  async buyListing(
    buyerId: number,
    listingId: number,
  ): Promise<ExchangeDeal | ExchangeRefusal> {
    return this.exchangeTx<ExchangeDeal | ExchangeRefusal>(async (client) => {
      const l = await client.query<ListingRow>(
        "select * from listings where id = $1",
        [listingId],
      );
      const row = l.rows[0];
      if (!row) return { value: refusal("gone"), commit: false };
      if (Number(row.seller_id) === buyerId)
        return { value: refusal("own"), commit: false };
      if ((await goldOf(client, buyerId)) < Number(row.price))
        return { value: refusal("gold"), commit: false };
      const thing = (await this.thingOf(client, {
        itemId: row.item_id,
        potionId: row.potion_id,
      }))!;
      await client.query("delete from listings where id = $1", [listingId]);
      const deal = await this.settle(client, {
        sellerId: Number(row.seller_id),
        buyerId,
        thing,
        price: Number(row.price),
        buyerPays: Number(row.price),
      });
      return { value: deal, commit: true };
    });
  }

  async placeOrder(
    buyerId: number,
    key: MarketKey,
    rolls: readonly RollWish[],
    price: number,
    maxOrders: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "placed" }> {
    return this.exchangeTx<ExchangeDeal | ExchangeRefusal | { kind: "placed" }>(
      async (client) => {
        // The cheapest fitting listing sells at its own price (it was there first).
        const listings = await client.query<ListingRow>(
          "select * from listings where market_key = $1 and price <= $2 and seller_id <> $3 order by price, listed_at, id",
          [key, price, buyerId],
        );
        for (const row of listings.rows) {
          const thing = await this.thingOf(client, {
            itemId: row.item_id,
            potionId: row.potion_id,
          });
          if (!thing || !fitsOrder(thing, { key, rolls: [...rolls] })) continue;
          if ((await goldOf(client, buyerId)) < Number(row.price)) {
            return { value: refusal("gold"), commit: false };
          }
          await client.query("delete from listings where id = $1", [row.id]);
          const deal = await this.settle(client, {
            sellerId: Number(row.seller_id),
            buyerId,
            thing,
            price: Number(row.price),
            buyerPays: Number(row.price),
          });
          return { value: deal, commit: true };
        }
        const n = await client.query<{ n: string }>(
          "select count(*) n from orders where buyer_id = $1",
          [buyerId],
        );
        if (Number(n.rows[0]?.n ?? 0) >= maxOrders)
          return { value: refusal("tooMany"), commit: false };
        if ((await goldOf(client, buyerId)) < price)
          return { value: refusal("gold"), commit: false };
        // The gold is set aside now; a cancel gives it back.
        await client.query(
          "update accounts set gold = gold - $2 where id = $1",
          [buyerId, price],
        );
        await client.query(
          "insert into orders (buyer_id, market_key, rolls, price) values ($1, $2, $3, $4)",
          [buyerId, key, [...rolls], price],
        );
        return { value: { kind: "placed" as const }, commit: true };
      },
    );
  }

  async cancelOrder(buyerId: number, orderId: number): Promise<boolean> {
    return this.exchangeTx(async (client) => {
      const gone = await client.query<OrderRow>(
        "delete from orders where id = $1 and buyer_id = $2 returning *",
        [orderId, buyerId],
      );
      const row = gone.rows[0];
      if (!row) return { value: false, commit: false };
      await client.query("update accounts set gold = gold + $2 where id = $1", [
        buyerId,
        row.price,
      ]);
      return { value: true, commit: true };
    });
  }

  async sellToOrder(
    sellerId: number,
    orderId: number,
    what: { itemId: number } | { potionId: number },
  ): Promise<ExchangeDeal | ExchangeRefusal> {
    return this.exchangeTx<ExchangeDeal | ExchangeRefusal>(async (client) => {
      const o = await client.query<OrderRow>(
        "select * from orders where id = $1",
        [orderId],
      );
      const order = o.rows[0];
      if (!order) return { value: refusal("gone"), commit: false };
      if (Number(order.buyer_id) === sellerId)
        return { value: refusal("own"), commit: false };
      const owned =
        "itemId" in what
          ? await client.query(
              "select id from items where id = $1 and account_id = $2 and location = 'stash'",
              [what.itemId, sellerId],
            )
          : await client.query(
              "select id from potions where id = $1 and account_id = $2 and location = 'rack'",
              [what.potionId, sellerId],
            );
      if ((owned.rowCount ?? 0) === 0)
        return { value: refusal("notYours"), commit: false };
      const thing = (await this.thingOf(client, {
        itemId: "itemId" in what ? what.itemId : null,
        potionId: "potionId" in what ? what.potionId : null,
      }))!;
      if (thing.item && isFreeTier0(thing.item)) {
        return { value: refusal("free"), commit: false };
      }
      if (
        !fitsOrder(thing, {
          key: order.market_key,
          rolls: order.rolls as RollWish[],
        })
      ) {
        return { value: refusal("noFit"), commit: false };
      }
      await client.query("delete from orders where id = $1", [orderId]);
      const deal = await this.settle(client, {
        sellerId,
        buyerId: Number(order.buyer_id),
        thing,
        price: order.price,
        buyerPays: 0,
      });
      return { value: deal, commit: true };
    });
  }

  async collect(
    accountId: number,
    room: { stash: number; rack: number },
  ): Promise<number> {
    const left = await this.inAccount(accountId, async (client) => {
      const stashRoom = Math.max(
        0,
        room.stash - (await stashCount(client, accountId)),
      );
      const rackRoom = Math.max(
        0,
        room.rack - (await rackCount(client, accountId)),
      );
      await client.query(
        `update items set location = 'stash' where id in (
           select id from items where account_id = $1 and location = 'collect' order by id limit $2)`,
        [accountId, stashRoom],
      );
      await client.query(
        `update potions set location = 'rack' where id in (
           select id from potions where account_id = $1 and location = 'collect' order by id limit $2)`,
        [accountId, rackRoom],
      );
      const n = await client.query<{ n: string }>(
        `select (select count(*) from items where account_id = $1 and location = 'collect')
               + (select count(*) from potions where account_id = $1 and location = 'collect') n`,
        [accountId],
      );
      return Number(n.rows[0]?.n ?? 0);
    });
    return left ?? 0;
  }

  async collection(
    accountId: number,
  ): Promise<{ items: Item[]; potions: Potion[] }> {
    const items = await this.pool.query<ItemRow>(
      "select * from items where account_id = $1 and location = 'collect' order by id",
      [accountId],
    );
    const potions = await this.pool.query<PotionRow>(
      "select * from potions where account_id = $1 and location = 'collect' order by id",
      [accountId],
    );
    return {
      items: items.rows.map(itemFromRow),
      potions: potions.rows.map(potionFromRow),
    };
  }

  async allListings(): Promise<(Listing & { sellerId: number })[]> {
    const r = await this.pool.query<ListingRow>(
      "select * from listings order by id",
    );
    return this.hydrate(r.rows);
  }

  async browse(
    viewerId: number,
    q: ExchangeQuery,
  ): Promise<{ total: number; listings: Listing[] }> {
    // Each filter as SQL, the same rules as filterListings (shared).
    const args: unknown[] = [];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    const where: string[] = [];
    if (q.slot === "potion") where.push("l.potion_id is not null");
    else if (q.slot !== null) where.push(`i.slot = ${arg(q.slot)}`);
    if (q.type !== null)
      where.push(`coalesce(i.type, p.stat) = ${arg(q.type)}`);
    // Potions have no tier, Shine, or rolls: those filters pass items only.
    if (q.tier === "artifact") where.push("i.artifact is not null");
    else if (q.tier !== null) {
      where.push(`i.artifact is null and i.tier = ${arg(q.tier)}`);
    }
    if (q.shiny) where.push("i.shiny");
    if (q.classId !== null) {
      const kinds = usableKinds(q.classId);
      where.push(
        `(l.potion_id is not null or i.slot in ('ring', 'necklace', 'cape')
          or (i.slot, i.type) in (select * from unnest(${arg(kinds.map((k) => k.slot))}::text[], ${arg(kinds.map((k) => k.type))}::text[])))`,
      );
    }
    for (const w of q.rolls) {
      where.push(
        w === "luck"
          ? "i.luck > 0"
          : `exists (select 1 from jsonb_array_elements(i.rolls) r
               where r->>'stat' = ${arg(w)} and (r->>'amount')::int > 0)`,
      );
    }
    const from = `from listings l
      left join items i on i.id = l.item_id
      left join potions p on p.id = l.potion_id
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}`;
    const order =
      q.sort === "cheapest"
        ? "l.price,"
        : q.sort === "dearest"
          ? "l.price desc,"
          : "";
    const total = await this.pool.query<{ n: string }>(
      `select count(*) n ${from}`,
      args,
    );
    const page = await this.pool.query<ListingRow>(
      `select l.* ${from}
       order by ${order} l.listed_at desc, l.id desc
       limit ${arg(EXCHANGE.pageSize)} offset ${arg(q.page * EXCHANGE.pageSize)}`,
      args,
    );
    const listings = await this.hydrate(page.rows);
    return {
      total: Number(total.rows[0]?.n ?? 0),
      listings: listings.map(({ sellerId, ...l }) => ({
        ...l,
        mine: sellerId === viewerId,
      })),
    };
  }

  async listingsOf(sellerId: number): Promise<Listing[]> {
    const r = await this.pool.query<ListingRow>(
      "select * from listings where seller_id = $1 order by id",
      [sellerId],
    );
    return (await this.hydrate(r.rows)).map(({ sellerId: seller, ...l }) => ({
      ...l,
      mine: seller === sellerId,
    }));
  }

  async ordersOf(buyerId: number): Promise<BuyOrder[]> {
    const r = await this.pool.query<OrderRow>(
      "select * from orders where buyer_id = $1 order by price desc, placed_at, id",
      [buyerId],
    );
    return r.rows.map((o) => ({ ...orderFromRow(o), mine: true }));
  }

  async ordersFor(
    key: MarketKey,
    viewerId: number,
    limit: number,
  ): Promise<BuyOrder[]> {
    const r = await this.pool.query<OrderRow>(
      "select * from orders where market_key = $1 order by price desc, placed_at, id limit $2",
      [key, limit],
    );
    return r.rows.map((o) => ({
      ...orderFromRow(o),
      mine: Number(o.buyer_id) === viewerId,
    }));
  }

  /** Listing rows with their items and potions (two queries, any number of rows). */
  private async hydrate(
    rows: ListingRow[],
  ): Promise<(Listing & { sellerId: number })[]> {
    const r = { rows };
    if (r.rows.length === 0) return [];
    const items = await this.pool.query<ItemRow>(
      "select * from items where id = any($1)",
      [r.rows.flatMap((x) => (x.item_id !== null ? [x.item_id] : []))],
    );
    const potions = await this.pool.query<PotionRow>(
      "select * from potions where id = any($1)",
      [r.rows.flatMap((x) => (x.potion_id !== null ? [x.potion_id] : []))],
    );
    const itemOf = new Map(
      items.rows.map((i) => [String(i.id), itemFromRow(i)]),
    );
    const potionOf = new Map(
      potions.rows.map((p) => [String(p.id), potionFromRow(p)]),
    );
    return r.rows.map((x) => ({
      id: Number(x.id),
      sellerId: Number(x.seller_id),
      price: Number(x.price),
      listedAt: x.listed_at.getTime(),
      item: x.item_id !== null ? (itemOf.get(String(x.item_id)) ?? null) : null,
      potion:
        x.potion_id !== null
          ? (potionOf.get(String(x.potion_id)) ?? null)
          : null,
      mine: false,
    }));
  }

  async allOrders(): Promise<(BuyOrder & { buyerId: number })[]> {
    const r = await this.pool.query<OrderRow>(
      "select * from orders order by price desc, placed_at, id",
    );
    return r.rows.map((o) => ({
      ...orderFromRow(o),
      buyerId: Number(o.buyer_id),
    }));
  }

  async priceWindows(key: MarketKey): Promise<PriceWindow[]> {
    const r = await this.pool.query<Record<string, string | null>>(
      `select
         count(*) filter (where sold_at > now() - interval '1 day') n1,
         avg(price) filter (where sold_at > now() - interval '1 day') a1,
         count(*) filter (where sold_at > now() - interval '7 days') n7,
         avg(price) filter (where sold_at > now() - interval '7 days') a7,
         count(*) filter (where sold_at > now() - interval '30 days') n30,
         avg(price) filter (where sold_at > now() - interval '30 days') a30,
         count(*) nall, avg(price) aall
       from sales where market_key = $1`,
      [key],
    );
    const row = r.rows[0] ?? {};
    const w = (
      window: PriceWindow["window"],
      n: string,
      a: string,
    ): PriceWindow => ({
      window,
      sales: Number(row[n] ?? 0),
      average:
        row[a] === null || row[a] === undefined
          ? null
          : Math.round(Number(row[a])),
    });
    return [
      w("24h", "n1", "a1"),
      w("7d", "n7", "a7"),
      w("30d", "n30", "a30"),
      w("all", "nall", "aall"),
    ];
  }

  async sales(accountId: number, limit: number): Promise<Sale[]> {
    const r = await this.pool.query<{
      seller_id: string;
      what: string;
      market_key: string | null;
      price: number;
      fee: number;
      sold_at: Date;
    }>(
      `select seller_id, what, market_key, price, fee, sold_at from sales
       where seller_id = $1 or buyer_id = $1 order by sold_at desc, id desc limit $2`,
      [accountId, limit],
    );
    return r.rows.map((x) => {
      const sold = Number(x.seller_id) === accountId;
      return {
        what: x.what,
        key: x.market_key,
        price: x.price,
        fee: sold ? x.fee : 0,
        at: x.sold_at.getTime(),
        role: sold ? "sold" : "bought",
      };
    });
  }

  async upgrades(accountId: number): Promise<Upgrades> {
    const r = await this.pool.query<{
      serf_slots_bought: number;
      stash_bought: number;
      rack_bought: number;
    }>(
      "select serf_slots_bought, stash_bought, rack_bought from accounts where id = $1",
      [accountId],
    );
    const row = r.rows[0];
    return row
      ? {
          serfSlots: row.serf_slots_bought,
          stash: row.stash_bought,
          rack: row.rack_bought,
        }
      : { ...NO_UPGRADES };
  }

  async addGold(accountId: number, amount: number): Promise<void> {
    await this.pool.query(
      "update accounts set gold = gold + $2 where id = $1",
      [accountId, amount],
    );
  }

  async buyUpgrade(
    accountId: number,
    kind: UpgradeKind,
    expected: number,
    price: number,
  ): Promise<boolean> {
    // A fixed column per kind: never built from the request.
    const column = UPGRADE_COLUMNS[kind];
    const r = await this.pool.query(
      `update accounts set gold = gold - $3, ${column} = ${column} + 1
       where id = $1 and ${column} = $2 and gold >= $3`,
      [accountId, expected, price],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async destroyWorn(
    accountId: number,
    serfId: number,
    artifact: ArtifactId,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `delete from items where id = (
         select id from items where account_id = $1 and serf_id = $2
           and location = 'equipped' and artifact = $3 limit 1)`,
      [accountId, serfId, artifact],
    );
    return (r.rowCount ?? 0) > 0;
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

/** A trade that happened (D-156). */
export interface ExchangeDeal {
  kind: "deal";
  sellerId: number;
  buyerId: number;
  what: string;
  price: number;
  fee: number;
}

export interface ExchangeRefusal {
  kind: "refused";
  reason: "notYours" | "tooMany" | "gone" | "own" | "gold" | "noFit" | "free";
}

function refusal(reason: ExchangeRefusal["reason"]): ExchangeRefusal {
  return { kind: "refused", reason };
}

/** "The same item" for an Exchange thing (D-156). */
function marketKeyOfThing(thing: {
  item: Item | null;
  potion: Potion | null;
}): MarketKey {
  return thing.item
    ? marketKeyOf({ item: thing.item })
    : marketKeyOf({ potion: thing.potion! });
}

/** Creates and wears each piece where its slot on the serf is empty (D-157). */
async function insertWorn(
  client: pg.PoolClient,
  accountId: number,
  serfId: number,
  wear: readonly Wear[],
): Promise<void> {
  for (const w of wear) {
    await client.query(
      `insert into items (account_id, serf_id, location, equipped, slot, type, tier, rolls, luck)
       select $1, $2, 'equipped', $3, $4, $5, $6, $7, $8
       where not exists (
         select 1 from items where serf_id = $2 and location = 'equipped' and equipped = $3)`,
      [
        accountId,
        serfId,
        w.slot,
        w.item.slot,
        w.item.type,
        w.item.tier,
        JSON.stringify(w.item.rolls),
        w.item.luck,
      ],
    );
  }
}

/** The one Exchange lock (D-156): every Exchange change holds it. */
const EXCHANGE_LOCK = 4_201_756;

async function goldOf(
  client: pg.PoolClient,
  accountId: number,
): Promise<number> {
  const r = await client.query<{ gold: string }>(
    "select gold from accounts where id = $1",
    [accountId],
  );
  return Number(r.rows[0]?.gold ?? 0);
}

interface OrderRow {
  id: string;
  buyer_id: string;
  market_key: string;
  rolls: string[];
  price: number;
  placed_at: Date;
}

function orderFromRow(o: OrderRow): BuyOrder {
  return {
    id: Number(o.id),
    key: o.market_key,
    rolls: o.rolls as RollWish[],
    price: o.price,
    placedAt: o.placed_at.getTime(),
    mine: false,
  };
}

interface ListingRow {
  id: string;
  seller_id: string;
  item_id: string | null;
  potion_id: string | null;
  price: number;
  listed_at: Date;
}

/** Where each upgrade's purchases are stored (migration 014). */
const UPGRADE_COLUMNS: Record<UpgradeKind, string> = {
  serfSlots: "serf_slots_bought",
  stash: "stash_bought",
  rack: "rack_bought",
};

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
    location: "stash" | "equipped" | "pending" | "listed" | "collect";
    item: Item;
  }[] = [];
  private readonly gold = new Map<number, number>();
  private nextPotionId = 1;
  private potions: {
    accountId: number;
    serfId: number | null;
    location: "rack" | "pending" | "listed" | "collect";
    potion: Potion;
  }[] = [];

  /** A copy for the caller, with what the serf wears. */
  private out(m: MemorySerf): SerfSummary {
    const worn = this.items
      .filter((x) => x.serfId === m.summary.id && x.location === "equipped")
      .map((x) => x.item);
    return structuredClone({
      ...m.summary,
      items: worn,
      classSetOffered:
        m.summary.alive && m.summary.classId !== null && !m.abilityGranted,
    });
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
    wear: readonly Wear[] = [],
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
      potionStats: zeroStats(),
      items: [],
      alive: true,
      life: newLifeStats(),
      death: null,
      classSetOffered: false,
    };
    const made: MemorySerf = {
      accountId,
      summary,
      statsLevel: 1,
      createdSeq: ++this.seq,
      diedSeq: null,
    };
    this.serfs.push(made);
    this.memWear(accountId, summary.id, wear);
    return this.out(made);
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

  private listed: {
    id: number;
    sellerId: number;
    itemId: number | null;
    potionId: number | null;
    price: number;
    key: MarketKey;
    at: number;
  }[] = [];
  private orders: (BuyOrder & { buyerId: number })[] = [];
  private nextListingId = 1;
  private nextOrderId = 1;
  private clock = 0;
  private sold: {
    sellerId: number;
    buyerId: number;
    sale: Omit<Sale, "role">;
  }[] = [];

  private memThing(ref: { itemId: number | null; potionId: number | null }) {
    if (ref.itemId !== null) {
      const e = this.items.find((x) => x.item.id === ref.itemId);
      return e ? { entry: e, thing: { item: e.item, potion: null } } : null;
    }
    const e = this.potions.find((x) => x.potion.id === ref.potionId);
    return e ? { entry: e, thing: { item: null, potion: e.potion } } : null;
  }

  private memSettle(deal: {
    sellerId: number;
    buyerId: number;
    entry: { accountId: number; serfId: number | null; location: string };
    thing: { item: Item | null; potion: Potion | null };
    price: number;
    buyerPays: number;
  }): ExchangeDeal {
    deal.entry.accountId = deal.buyerId;
    deal.entry.serfId = null;
    deal.entry.location = "collect";
    const fee = exchangeFee(deal.price);
    if (deal.buyerPays > 0) {
      this.gold.set(
        deal.buyerId,
        (this.gold.get(deal.buyerId) ?? 0) - deal.buyerPays,
      );
    }
    this.gold.set(
      deal.sellerId,
      (this.gold.get(deal.sellerId) ?? 0) + deal.price - fee,
    );
    const what = listingName(deal.thing);
    this.sold.push({
      sellerId: deal.sellerId,
      buyerId: deal.buyerId,
      sale: {
        what,
        key: marketKeyOfThing(deal.thing),
        price: deal.price,
        fee,
        at: ++this.clock,
      },
    });
    return {
      kind: "deal",
      sellerId: deal.sellerId,
      buyerId: deal.buyerId,
      what,
      price: deal.price,
      fee,
    };
  }

  private memOwned(
    accountId: number,
    what: { itemId: number } | { potionId: number },
  ) {
    return "itemId" in what
      ? this.items.find(
          (x) =>
            x.accountId === accountId &&
            x.item.id === what.itemId &&
            x.location === "stash",
        )
      : this.potions.find(
          (x) =>
            x.accountId === accountId &&
            x.potion.id === what.potionId &&
            x.location === "rack",
        );
  }

  async listOnExchange(
    accountId: number,
    what: { itemId: number } | { potionId: number },
    price: number,
    maxListings: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "listed" }> {
    const entry = this.memOwned(accountId, what);
    if (!entry) return refusal("notYours");
    const thing =
      "item" in entry
        ? { item: entry.item, potion: null }
        : { item: null, potion: entry.potion };
    if (thing.item && isFreeTier0(thing.item)) return refusal("free");
    const key = marketKeyOfThing(thing);
    const order = this.orders
      .filter(
        (o) => o.key === key && o.price >= price && o.buyerId !== accountId,
      )
      .sort(
        (a, b) => b.price - a.price || a.placedAt - b.placedAt || a.id - b.id,
      )
      .find((o) => fitsOrder(thing, o));
    if (order) {
      this.orders = this.orders.filter((o) => o !== order);
      return this.memSettle({
        sellerId: accountId,
        buyerId: order.buyerId,
        entry,
        thing,
        price: order.price,
        buyerPays: 0,
      });
    }
    if (
      this.listed.filter((l) => l.sellerId === accountId).length >= maxListings
    )
      return refusal("tooMany");
    entry.location = "listed";
    this.listed.push({
      id: this.nextListingId++,
      sellerId: accountId,
      itemId: thing.item?.id ?? null,
      potionId: thing.potion?.id ?? null,
      price,
      key,
      at: ++this.clock,
    });
    return { kind: "listed" };
  }

  async cancelListing(
    accountId: number,
    listingId: number,
    room: { stash: number; rack: number },
  ): Promise<"ok" | "notYours" | "noRoom"> {
    const l = this.listed.find(
      (x) => x.id === listingId && x.sellerId === accountId,
    );
    if (!l) return "notYours";
    const found = this.memThing(l)!;
    if (l.itemId !== null) {
      if (this.stashOf(accountId).length >= room.stash) return "noRoom";
      found.entry.location = "stash";
    } else {
      const rack = this.potions.filter(
        (x) => x.accountId === accountId && x.location === "rack",
      );
      if (rack.length >= room.rack) return "noRoom";
      found.entry.location = "rack";
    }
    this.listed = this.listed.filter((x) => x !== l);
    return "ok";
  }

  async buyListing(
    buyerId: number,
    listingId: number,
  ): Promise<ExchangeDeal | ExchangeRefusal> {
    const l = this.listed.find((x) => x.id === listingId);
    if (!l) return refusal("gone");
    if (l.sellerId === buyerId) return refusal("own");
    if ((this.gold.get(buyerId) ?? 0) < l.price) return refusal("gold");
    const found = this.memThing(l)!;
    this.listed = this.listed.filter((x) => x !== l);
    return this.memSettle({
      sellerId: l.sellerId,
      buyerId,
      entry: found.entry,
      thing: found.thing,
      price: l.price,
      buyerPays: l.price,
    });
  }

  async placeOrder(
    buyerId: number,
    key: MarketKey,
    rolls: readonly RollWish[],
    price: number,
    maxOrders: number,
  ): Promise<ExchangeDeal | ExchangeRefusal | { kind: "placed" }> {
    const want = { key, rolls: [...rolls] };
    const l = this.listed
      .filter(
        (x) => x.key === key && x.price <= price && x.sellerId !== buyerId,
      )
      .sort((a, b) => a.price - b.price || a.at - b.at || a.id - b.id)
      .find((x) => {
        const found = this.memThing(x);
        return found !== null && fitsOrder(found.thing, want);
      });
    if (l) {
      if ((this.gold.get(buyerId) ?? 0) < l.price) return refusal("gold");
      const found = this.memThing(l)!;
      this.listed = this.listed.filter((x) => x !== l);
      return this.memSettle({
        sellerId: l.sellerId,
        buyerId,
        entry: found.entry,
        thing: found.thing,
        price: l.price,
        buyerPays: l.price,
      });
    }
    if (this.orders.filter((o) => o.buyerId === buyerId).length >= maxOrders)
      return refusal("tooMany");
    if ((this.gold.get(buyerId) ?? 0) < price) return refusal("gold");
    this.gold.set(buyerId, (this.gold.get(buyerId) ?? 0) - price);
    this.orders.push({
      id: this.nextOrderId++,
      buyerId,
      key,
      rolls: [...rolls],
      price,
      placedAt: ++this.clock,
      mine: false,
    });
    return { kind: "placed" };
  }

  async cancelOrder(buyerId: number, orderId: number): Promise<boolean> {
    const o = this.orders.find(
      (x) => x.id === orderId && x.buyerId === buyerId,
    );
    if (!o) return false;
    this.orders = this.orders.filter((x) => x !== o);
    this.gold.set(buyerId, (this.gold.get(buyerId) ?? 0) + o.price);
    return true;
  }

  async sellToOrder(
    sellerId: number,
    orderId: number,
    what: { itemId: number } | { potionId: number },
  ): Promise<ExchangeDeal | ExchangeRefusal> {
    const order = this.orders.find((x) => x.id === orderId);
    if (!order) return refusal("gone");
    if (order.buyerId === sellerId) return refusal("own");
    const entry = this.memOwned(sellerId, what);
    if (!entry) return refusal("notYours");
    const thing =
      "item" in entry
        ? { item: entry.item, potion: null }
        : { item: null, potion: entry.potion };
    if (thing.item && isFreeTier0(thing.item)) return refusal("free");
    if (!fitsOrder(thing, order)) return refusal("noFit");
    this.orders = this.orders.filter((x) => x !== order);
    return this.memSettle({
      sellerId,
      buyerId: order.buyerId,
      entry,
      thing,
      price: order.price,
      buyerPays: 0,
    });
  }

  async collect(
    accountId: number,
    room: { stash: number; rack: number },
  ): Promise<number> {
    let stashRoom = room.stash - this.stashOf(accountId).length;
    let rackRoom =
      room.rack -
      this.potions.filter(
        (x) => x.accountId === accountId && x.location === "rack",
      ).length;
    for (const e of this.items) {
      if (
        e.accountId === accountId &&
        e.location === "collect" &&
        stashRoom > 0
      ) {
        e.location = "stash";
        stashRoom--;
      }
    }
    for (const e of this.potions) {
      if (
        e.accountId === accountId &&
        e.location === "collect" &&
        rackRoom > 0
      ) {
        e.location = "rack";
        rackRoom--;
      }
    }
    return (
      this.items.filter(
        (x) => x.accountId === accountId && x.location === "collect",
      ).length +
      this.potions.filter(
        (x) => x.accountId === accountId && x.location === "collect",
      ).length
    );
  }

  async collection(
    accountId: number,
  ): Promise<{ items: Item[]; potions: Potion[] }> {
    return structuredClone({
      items: this.items
        .filter((x) => x.accountId === accountId && x.location === "collect")
        .map((x) => x.item),
      potions: this.potions
        .filter((x) => x.accountId === accountId && x.location === "collect")
        .map((x) => x.potion),
    });
  }

  async allListings(): Promise<(Listing & { sellerId: number })[]> {
    return this.listed.map((l) => {
      const found = this.memThing(l);
      return {
        id: l.id,
        sellerId: l.sellerId,
        price: l.price,
        listedAt: l.at,
        item: structuredClone(found?.thing.item ?? null),
        potion: structuredClone(found?.thing.potion ?? null),
        mine: false,
      };
    });
  }

  async browse(
    viewerId: number,
    q: ExchangeQuery,
  ): Promise<{ total: number; listings: Listing[] }> {
    const all = (await this.allListings()).map(({ sellerId, ...l }) => ({
      ...l,
      mine: sellerId === viewerId,
    }));
    return filterListings(all, q);
  }

  async listingsOf(sellerId: number): Promise<Listing[]> {
    return (await this.allListings())
      .filter((l) => l.sellerId === sellerId)
      .map(({ sellerId: seller, ...l }) => ({
        ...l,
        mine: seller === sellerId,
      }));
  }

  async ordersOf(buyerId: number): Promise<BuyOrder[]> {
    return (await this.allOrders())
      .filter((o) => o.buyerId === buyerId)
      .map(({ buyerId: buyer, ...o }) => ({ ...o, mine: buyer === buyerId }));
  }

  async ordersFor(
    key: MarketKey,
    viewerId: number,
    limit: number,
  ): Promise<BuyOrder[]> {
    return (await this.allOrders())
      .filter((o) => o.key === key)
      .slice(0, limit)
      .map(({ buyerId, ...o }) => ({ ...o, mine: buyerId === viewerId }));
  }

  async allOrders(): Promise<(BuyOrder & { buyerId: number })[]> {
    return structuredClone(
      [...this.orders].sort(
        (a, b) => b.price - a.price || a.placedAt - b.placedAt || a.id - b.id,
      ),
    );
  }

  async priceWindows(key: MarketKey): Promise<PriceWindow[]> {
    // In memory every sale is recent: all windows hold them all.
    const all = this.sold
      .filter((x) => x.sale.key === key)
      .map((x) => x.sale.price);
    const average =
      all.length > 0
        ? Math.round(all.reduce((a, b) => a + b, 0) / all.length)
        : null;
    return (["24h", "7d", "30d", "all"] as const).map((window) => ({
      window,
      average,
      sales: all.length,
    }));
  }

  async sales(accountId: number, limit: number): Promise<Sale[]> {
    return this.sold
      .filter((x) => x.sellerId === accountId || x.buyerId === accountId)
      .reverse()
      .slice(0, limit)
      .map((x) =>
        x.sellerId === accountId
          ? { ...x.sale, role: "sold" as const }
          : { ...x.sale, fee: 0, role: "bought" as const },
      );
  }

  private readonly bought = new Map<number, Upgrades>();

  async addGold(accountId: number, amount: number): Promise<void> {
    this.gold.set(accountId, (this.gold.get(accountId) ?? 0) + amount);
  }

  async upgrades(accountId: number): Promise<Upgrades> {
    return { ...(this.bought.get(accountId) ?? NO_UPGRADES) };
  }

  async buyUpgrade(
    accountId: number,
    kind: UpgradeKind,
    expected: number,
    price: number,
  ): Promise<boolean> {
    const now = this.bought.get(accountId) ?? { ...NO_UPGRADES };
    const gold = this.gold.get(accountId) ?? 0;
    if (now[kind] !== expected || gold < price) return false;
    this.gold.set(accountId, gold - price);
    this.bought.set(accountId, { ...now, [kind]: now[kind] + 1 });
    return true;
  }

  async destroyWorn(
    accountId: number,
    serfId: number,
    artifact: ArtifactId,
  ): Promise<boolean> {
    const i = this.items.findIndex(
      (x) =>
        x.accountId === accountId &&
        x.serfId === serfId &&
        x.location === "equipped" &&
        x.item.artifact === artifact,
    );
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
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
      (x) =>
        x.accountId === accountId &&
        x.potion.id === potionId &&
        (x.location === "rack" || x.location === "pending"),
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
      potionStats: drinkPotionTally(
        s.summary.potionStats,
        s.summary.stats,
        s.summary.classId,
        stat,
      ),
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
      (x) =>
        !(
          x.accountId === accountId &&
          x.potion.id === potionId &&
          (x.location === "rack" || x.location === "pending")
        ),
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
        (x.location === "stash" || x.location === "pending"),
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

  /** Creates and wears each piece where its slot on the serf is empty. */
  private memWear(accountId: number, serfId: number, wear: readonly Wear[]) {
    for (const w of wear) {
      const taken = this.items.some(
        (x) =>
          x.serfId === serfId &&
          x.location === "equipped" &&
          x.item.equipped === w.slot,
      );
      if (taken) continue;
      this.items.push({
        accountId,
        serfId,
        location: "equipped",
        item: {
          ...structuredClone(w.item),
          id: this.nextItemId++,
          equipped: w.slot,
        },
      });
    }
  }

  async answerClassSet(
    accountId: number,
    serfId: number,
    wear: readonly Wear[],
    dropIds: readonly number[],
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
    this.items = this.items.filter(
      (x) =>
        !(
          dropIds.includes(x.item.id) &&
          x.serfId === serfId &&
          x.location === "equipped" &&
          isFreeTier0(x.item)
        ),
    );
    this.memWear(accountId, serfId, wear);
    return true;
  }

  async addToStash(
    accountId: number,
    item: ItemSpec,
    capacity: number,
  ): Promise<Item | "full"> {
    if (this.stashOf(accountId).length >= capacity) return "full";
    const made: Item = {
      ...structuredClone(item),
      id: this.nextItemId++,
      equipped: null,
    };
    this.items.push({ accountId, serfId: null, location: "stash", item: made });
    return structuredClone(made);
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
        (x.location === "stash" || x.location === "pending"),
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
