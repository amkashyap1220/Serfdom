import {
  normalizeSerfName,
  serfNameProblem,
  addStats,
  canEquip,
  CLASS_ABILITY_ITEM,
  itemName,
  slotsFor,
  type EquipSlot,
  luckOf,
  rollChestItem,
  type LootDrop,
  potionProblem,
  type PotionDrop,
  rollPotions,
  applyGains,
  CLASS_CHOICE_LEVEL,
  classBonus,
  className,
  clearExp,
  dungeonInfo,
  normalizeLeaderboardQuery,
  type LeaderboardQuery,
  type ArtifactId,
  rollLevelGains,
  zeroStats,
  type Stats,
  totalExpForLevel,
  type ClassId,
  type DungeonId,
  type LeaderboardEntry,
  type RunResult,
  type RunStats,
  type SerfSummary,
  capacityOf,
  nextPrice,
  UPGRADES,
  type UpgradeKind,
  EXCHANGE,
  filterListings,
  isValidPrice,
  type ExchangeQuery,
  type Listing,
  type Sale,
  parseMarketKey,
  type BuyOrder,
  type Item,
  type MarketKey,
  type Potion,
  type PriceWindow,
  type RollWish,
} from "@serfdom/shared";
import type {
  Death,
  ExchangeDeal,
  ExchangeRefusal,
  SerfRepo,
  Stash,
} from "./serf-repo.ts";

/** PROVISIONAL: how many serfs the leaderboard shows. */
export const LEADERBOARD_SIZE = 20;

export type SerfResult =
  { ok: true; serf: SerfSummary } | { ok: false; reason: string };

/**
 * Serf rules (Phase 7b): create within the slot limit (D-061) with a valid,
 * living-unique name (D-063, D-064); play only your own living serf; a
 * finished run adds to the serf's life, and a death ends it for good
 * (D-062). The client is untrusted: names are re-validated here.
 */
export class SerfService {
  private readonly repo: SerfRepo;
  private readonly slots: number;
  /** Stat rolls (D-074); injectable so tests are deterministic. */
  private readonly random: () => number;

  constructor(
    repo: SerfRepo,
    /** Serf slots before any are bought (D-061; tests may give fewer). */
    slots: number = UPGRADES.serfSlots.base,
    random: () => number = Math.random,
  ) {
    this.repo = repo;
    this.slots = slots;
    this.random = random;
  }

  /** This account's capacity of each upgradable thing (D-154). */
  async capacity(accountId: number, kind: UpgradeKind): Promise<number> {
    const bought = (await this.repo.upgrades(accountId))[kind];
    return kind === "serfSlots"
      ? this.slots + UPGRADES.serfSlots.step * bought
      : capacityOf(kind, bought);
  }

  /** Living serfs this account may have at once (2, plus those bought). */
  slotsFor(accountId: number): Promise<number> {
    return this.capacity(accountId, "serfSlots");
  }

  /**
   * Buys the next step of an upgrade with gold (D-154): the price and the
   * balance are checked in the same write, so a repeated or stale request
   * cannot buy twice or for less.
   */
  async buyUpgrade(
    accountId: number,
    kind: UpgradeKind,
  ): Promise<{ ok: true; price: number } | { ok: false; reason: string }> {
    const bought = (await this.repo.upgrades(accountId))[kind];
    const price = nextPrice(kind, bought);
    if (price === null) {
      return {
        ok: false,
        reason: `${UPGRADES[kind].name}s are at their most.`,
      };
    }
    const done = await this.repo.buyUpgrade(accountId, kind, bought, price);
    if (!done)
      return { ok: false, reason: `Not enough gold: it costs ${price}.` };
    return { ok: true, price };
  }

  list(accountId: number): Promise<SerfSummary[]> {
    return this.repo.list(accountId);
  }

  async create(accountId: number, rawName: string): Promise<SerfResult> {
    const name = normalizeSerfName(rawName);
    const problem = serfNameProblem(name);
    if (problem) return { ok: false, reason: problem };
    const slots = await this.slotsFor(accountId);
    const created = await this.repo.create(accountId, name, slots);
    if (created === "slotsFull") {
      return {
        ok: false,
        reason: `You already have ${slots} living serfs.`,
      };
    }
    if (created === "nameTaken") {
      return { ok: false, reason: "A living serf already has that name." };
    }
    return { ok: true, serf: created };
  }

  /** The serf this account may play as: its own and alive. */
  async choose(accountId: number, serfId: number): Promise<SerfResult> {
    const serf = await this.repo.find(accountId, serfId);
    // Someone else's serf looks exactly like one that does not exist.
    if (!serf) return { ok: false, reason: "No such serf." };
    if (!serf.alive) return { ok: false, reason: `${serf.name} is dead.` };
    // Serfs from before Phase 8c (or given EXP by hand) catch up here,
    // and classed serfs from before 10a get their ability item.
    const settled = await this.settle(accountId, serfId);
    const current = settled?.serf ?? serf;
    if (current.classId && (await this.grantAbilityItem(accountId, current))) {
      const fresh = await this.repo.find(accountId, serfId);
      return { ok: true, serf: fresh ?? current };
    }
    return { ok: true, serf: current };
  }

  /**
   * Records a finished run on the serf and awards its EXP: only on
   * completion (D-069), scaled down when the serf is above the dungeon's
   * level range (D-071). Null if the serf is missing or already dead.
   */
  async recordRun(
    accountId: number,
    serfId: number,
    dungeon: DungeonId,
    result: RunResult,
    run: RunStats,
    death: Death | null,
    /** The most players the run held, for its clear record (D-148). */
    partySize = 1,
  ): Promise<{
    serf: SerfSummary;
    expGained: number;
    statGains: Stats;
    loot: LootDrop[];
    potions: PotionDrop[];
  } | null> {
    // The level is read before the update. A serf plays one run at a time
    // (it is fixed for the run, one connection per account), so no other
    // write can change its EXP in between.
    const before = await this.repo.find(accountId, serfId);
    if (!before?.alive) return null;
    const expGained =
      result === "completed" ? clearExp(dungeon, before.level) : 0;
    const serf = await this.repo.recordRun(
      accountId,
      serfId,
      result,
      run,
      death,
      expGained,
      // Fastest clears count listed dungeons only (D-148).
      result === "completed" && dungeonInfo(dungeon).listed
        ? { dungeon, partySize }
        : null,
    );
    if (!serf) return null;
    if (result !== "completed" || !serf.alive) {
      return { serf, expGained, statGains: zeroStats(), loot: [], potions: [] };
    }
    const settled = await this.settle(accountId, serfId);
    const loot = await this.rollLoot(accountId, before, dungeon);
    const potions = await this.rollPotions(accountId, before, dungeon);
    // Read once more so the serf comes back with its new items.
    const latest = await this.repo.find(accountId, serfId);
    return {
      serf: latest ?? settled?.serf ?? serf,
      expGained,
      statGains: settled?.gains ?? zeroStats(),
      loot,
      potions,
    };
  }

  /**
   * One potion chance per Luck point (D-089), like the chests, in a
   * dungeon that gives potions (D-118): into the rack while it has room,
   * else pending for this serf.
   */
  private async rollPotions(
    accountId: number,
    serf: SerfSummary,
    dungeon: DungeonId,
  ): Promise<PotionDrop[]> {
    const rolls = luckOf(serf.items.filter((i) => i.equipped !== null));
    const won = rollPotions(dungeon, rolls, this.random);
    if (won.length === 0) return [];
    const drops = await this.repo.addPotions(
      accountId,
      serf.id,
      won,
      await this.capacity(accountId, "rack"),
    );
    return drops ?? [];
  }

  /**
   * One chest per Luck point (D-065, D-068), counting only what the serf
   * had equipped for the run; each chest is one item from the dungeon's
   * pool (D-080), into the stash while it has room, else pending (D-086,
   * D-088).
   */
  private async rollLoot(
    accountId: number,
    serf: SerfSummary,
    dungeon: DungeonId,
  ): Promise<LootDrop[]> {
    const chests = luckOf(serf.items.filter((i) => i.equipped !== null));
    // An endgame chest may hold an Artifact; any item may be Shiny (D-152).
    const items = Array.from({ length: chests }, () =>
      rollChestItem(dungeon, this.random),
    );
    const drops = await this.repo.addLoot(
      accountId,
      serf.id,
      items,
      await this.capacity(accountId, "stash"),
    );
    return drops ?? [];
  }

  /** The account's stash, gold, pending rewards (D-085–D-088), and potion rack (D-118). */
  async stash(
    accountId: number,
  ): Promise<Stash & { capacity: number; rackCapacity: number }> {
    return {
      ...(await this.repo.stash(accountId)),
      capacity: await this.capacity(accountId, "stash"),
      rackCapacity: await this.capacity(accountId, "rack"),
    };
  }

  /**
   * One of the account's serfs drinks one of its potions (D-118): alive,
   * classed, and below that stat's class max (D-075). The repo checks
   * again in the same write. Reasons are safe to show.
   */
  async drink(
    accountId: number,
    serfId: number,
    potionId: number,
  ): Promise<{ ok: true; serf: SerfSummary } | { ok: false; reason: string }> {
    const serf = await this.repo.find(accountId, serfId);
    // Someone else's serf or potion looks exactly like one that does not exist.
    if (!serf) return { ok: false, reason: "No such serf." };
    const stash = await this.repo.stash(accountId);
    const potion = [
      ...stash.rack,
      ...stash.pendingPotions.map((p) => p.potion),
    ].find((p) => p.id === potionId);
    if (!potion) return { ok: false, reason: "No such potion in your rack." };
    const problem = potionProblem(serf, potion.stat);
    if (problem) return { ok: false, reason: problem };
    const done = await this.repo.drinkPotion(
      accountId,
      serfId,
      potionId,
      await this.capacity(accountId, "rack"),
    );
    if (!done) return { ok: false, reason: "No such potion in your rack." };
    if ("refused" in done) return { ok: false, reason: done.refused };
    return { ok: true, serf: done.serf };
  }

  /** Pours out one of the account's potions (D-118); it is gone. */
  async pour(
    accountId: number,
    potionId: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const poured = await this.repo.pourPotion(
      accountId,
      potionId,
      await this.capacity(accountId, "rack"),
    );
    return poured
      ? { ok: true }
      : { ok: false, reason: "No such potion in your rack." };
  }

  /** Sells a stash or pending item for gold (D-087); reasons are safe to show. */
  async sell(
    accountId: number,
    itemId: number,
  ): Promise<{ ok: true; price: number } | { ok: false; reason: string }> {
    const sold = await this.repo.sell(
      accountId,
      itemId,
      await this.capacity(accountId, "stash"),
    );
    // Someone else's item looks exactly like one that does not exist.
    return sold
      ? { ok: true, price: sold.price }
      : { ok: false, reason: "No such item in your stash." };
  }

  /**
   * Puts a stash or pending item on one of the account's living serfs
   * (D-086): the slot must fit the item, and the serf's class must be
   * able to use it (D-081). What it replaces goes to the stash, or waits
   * when the stash is full. Reasons are safe to show.
   */
  async equip(
    accountId: number,
    serfId: number,
    itemId: number,
    slot: EquipSlot,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const serf = await this.repo.find(accountId, serfId);
    if (!serf) return { ok: false, reason: "No such serf." };
    if (!serf.alive) return { ok: false, reason: `${serf.name} is dead.` };
    const stash = await this.repo.stash(accountId);
    const item = [...stash.items, ...stash.pending.map((p) => p.item)].find(
      (i) => i.id === itemId,
    );
    if (!item) return { ok: false, reason: "No such item in your stash." };
    if (!slotsFor(item.slot).includes(slot)) {
      return { ok: false, reason: `A ${itemName(item)} does not go there.` };
    }
    if (!canEquip(item, serf.classId)) {
      return {
        ok: false,
        reason: serf.classId
          ? `A ${className(serf.classId)} cannot use a ${itemName(item)}.`
          : `Before choosing a class, ${serf.name} can only wear T0 weapons and armor.`,
      };
    }
    const done = await this.repo.equip(
      accountId,
      serfId,
      itemId,
      slot,
      await this.capacity(accountId, "stash"),
    );
    return done
      ? { ok: true }
      : { ok: false, reason: "Could not equip that. Please try again." };
  }

  /** Takes a worn item off into the stash, if it has room. */
  async unequip(
    accountId: number,
    serfId: number,
    slot: EquipSlot,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const done = await this.repo.unequip(
      accountId,
      serfId,
      slot,
      await this.capacity(accountId, "stash"),
    );
    if (done === "ok") return { ok: true };
    return {
      ok: false,
      reason:
        done === "full"
          ? "Your stash is full: sell something first."
          : "Nothing is worn there.",
    };
  }

  /** Rewards wait for this serf: it may not start a dungeon (D-088). */
  hasPending(accountId: number, serfId: number): Promise<boolean> {
    return this.repo.hasPending(accountId, serfId);
  }

  /**
   * Rolls the stats for every level the serf has reached but not yet rolled
   * (D-074): Serf ranges to level 5, class ranges after. A classless serf
   * stops at level 5 until it chooses (D-073). The save is guarded on the
   * old stats level, so if another write got there first, its rolls stand
   * and these are dropped. Null if the serf is not this account's.
   */
  private async settle(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; gains: Stats; statsLevel: number } | null> {
    const found = await this.repo.findWithStatsLevel(accountId, serfId);
    if (!found) return null;
    const { serf, statsLevel } = found;
    const target =
      serf.classId === null
        ? Math.min(serf.level, CLASS_CHOICE_LEVEL)
        : serf.level;
    if (!serf.alive || target <= statsLevel) {
      return { serf, gains: zeroStats(), statsLevel };
    }
    let stats = serf.stats;
    let gains = zeroStats();
    for (let level = statsLevel + 1; level <= target; level++) {
      const rolled = rollLevelGains(stats, level, serf.classId, this.random);
      stats = applyGains(
        stats,
        rolled,
        level > CLASS_CHOICE_LEVEL ? serf.classId : null,
      );
      gains = addStats(gains, rolled);
    }
    const saved = await this.repo.saveStats(
      accountId,
      serfId,
      stats,
      statsLevel,
      target,
    );
    if (saved) return { serf: saved, gains, statsLevel: target };
    const again = await this.repo.findWithStatsLevel(accountId, serfId);
    return again ? { ...again, gains: zeroStats() } : null;
  }

  /**
   * Gives one of the account's serfs its permanent class (D-073): it must
   * be alive, classless, and at least level 5. The reasons are safe to show.
   */
  async chooseClass(
    accountId: number,
    serfId: number,
    classId: ClassId,
  ): Promise<SerfResult> {
    const serf = await this.repo.find(accountId, serfId);
    if (!serf) return { ok: false, reason: "No such serf." };
    if (!serf.alive) return { ok: false, reason: `${serf.name} is dead.` };
    if (serf.classId !== null) {
      return {
        ok: false,
        reason: `${serf.name} is already a ${className(serf.classId)}; a class is permanent.`,
      };
    }
    if (serf.level < CLASS_CHOICE_LEVEL) {
      return {
        ok: false,
        reason: `${serf.name} picks a class at level ${CLASS_CHOICE_LEVEL}.`,
      };
    }
    // The checks above give good messages; the write re-checks them all at
    // once, so a concurrent pick or death cannot slip between.
    // Roll any Serf levels still owed (up to 5), then give the class bonus
    // in the same write as the class, so it lands exactly once.
    const settled = await this.settle(accountId, serfId);
    if (!settled) return { ok: false, reason: "No such serf." };
    const chosen = await this.repo.chooseClass(
      accountId,
      serfId,
      classId,
      totalExpForLevel(CLASS_CHOICE_LEVEL),
      applyGains(settled.serf.stats, classBonus(classId), classId),
      settled.statsLevel,
    );
    if (!chosen) return { ok: false, reason: "Could not choose a class." };
    // A serf already past level 5 rolls its class levels now.
    await this.settle(accountId, serfId);
    // D-092: the class comes with a T0 ability item, worn at once.
    const withClass = (await this.repo.find(accountId, serfId)) ?? chosen;
    await this.grantAbilityItem(accountId, withClass);
    return {
      ok: true,
      serf: (await this.repo.find(accountId, serfId)) ?? withClass,
    };
  }

  /** The free T0 ability item for the serf's class, once per serf (D-092). */
  private grantAbilityItem(
    accountId: number,
    serf: SerfSummary,
  ): Promise<boolean> {
    if (!serf.classId) return Promise.resolve(false);
    return this.repo.grantAbilityItem(accountId, serf.id, {
      slot: "ability",
      type: CLASS_ABILITY_ITEM[serf.classId],
      tier: 0,
      rolls: [],
      luck: 0,
    });
  }

  /**
   * Lists a stash item or rack potion on the Exchange (D-155), or sells it
   * at once to the best fitting buy order at the order's price (D-156).
   */
  async listOnExchange(
    accountId: number,
    what: { itemId: number } | { potionId: number },
    price: number,
  ): Promise<ExchangeOutcome> {
    if (!isValidPrice(price)) return refused(BAD_PRICE);
    const r = await this.repo.listOnExchange(
      accountId,
      what,
      price,
      EXCHANGE.maxListings,
    );
    if (r.kind === "listed") return { ok: true, deal: null };
    if (r.kind === "deal") return { ok: true, deal: r };
    return refused(
      r.reason === "tooMany"
        ? `You already have ${EXCHANGE.maxListings} listings.`
        : "itemId" in what
          ? "Only an item in your stash can be listed (not one a serf wears)."
          : "Only a potion in your rack can be listed.",
    );
  }

  async cancelListing(
    accountId: number,
    listingId: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const r = await this.repo.cancelListing(
      accountId,
      listingId,
      await this.room(accountId),
    );
    if (r === "notYours") return { ok: false, reason: "That listing is gone." };
    if (r === "noRoom") return { ok: false, reason: "Make room for it first." };
    return { ok: true };
  }

  /** Buys a listing; it waits in the collection box (D-156). */
  async buyListing(
    accountId: number,
    listingId: number,
  ): Promise<ExchangeOutcome> {
    const r = await this.repo.buyListing(accountId, listingId);
    if (r.kind === "deal") return { ok: true, deal: r };
    return refused(DEAL_REFUSALS[r.reason]);
  }

  /**
   * Places a buy order (D-156), or buys the cheapest fitting listing at
   * once at its own price. A waiting order sets its gold aside.
   */
  async placeOrder(
    accountId: number,
    key: MarketKey,
    rolls: RollWish[],
    price: number,
  ): Promise<ExchangeOutcome> {
    const parsed = parseMarketKey(key);
    if (!parsed) return refused("No such item.");
    if (!isValidPrice(price)) return refused(BAD_PRICE);
    if (parsed.kind === "potion" && rolls.length > 0) {
      return refused("Potions have no rolls.");
    }
    const r = await this.repo.placeOrder(
      accountId,
      key,
      [...new Set(rolls)],
      price,
      EXCHANGE.maxOrders,
    );
    if (r.kind === "placed") return { ok: true, deal: null };
    if (r.kind === "deal") return { ok: true, deal: r };
    return refused(
      r.reason === "tooMany"
        ? `You already have ${EXCHANGE.maxOrders} buy orders.`
        : DEAL_REFUSALS[r.reason],
    );
  }

  /** Cancels a buy order; its gold comes back. */
  async cancelOrder(accountId: number, orderId: number): Promise<boolean> {
    return this.repo.cancelOrder(accountId, orderId);
  }

  /** Sells a stash item or rack potion to one buy order, at its price. */
  async sellToOrder(
    accountId: number,
    orderId: number,
    what: { itemId: number } | { potionId: number },
  ): Promise<ExchangeOutcome> {
    const r = await this.repo.sellToOrder(accountId, orderId, what);
    if (r.kind === "deal") return { ok: true, deal: r };
    return refused(DEAL_REFUSALS[r.reason]);
  }

  /** Moves the collection box into the stash and rack; how many stay. */
  async collect(accountId: number): Promise<number> {
    return this.repo.collect(accountId, await this.room(accountId));
  }

  /** A page of the Exchange for this account (its own listings marked). */
  async browse(accountId: number, query: ExchangeQuery) {
    const all = (await this.repo.allListings()).map(({ sellerId, ...l }) => ({
      ...l,
      mine: sellerId === accountId,
    }));
    return filterListings(all, query);
  }

  /** One item's price history and its best buy orders (D-156). */
  async market(
    accountId: number,
    key: MarketKey,
  ): Promise<{ windows: PriceWindow[]; orders: BuyOrder[] }> {
    const orders = (await this.repo.allOrders())
      .filter((o) => o.key === key)
      .slice(0, EXCHANGE.topOrders)
      .map(({ buyerId, ...o }) => ({ ...o, mine: buyerId === accountId }));
    return { windows: await this.repo.priceWindows(key), orders };
  }

  /** This account's listings, orders, collection box, and latest trades. */
  async myExchange(accountId: number): Promise<{
    listings: Listing[];
    orders: BuyOrder[];
    collection: { items: Item[]; potions: Potion[] };
    sales: Sale[];
  }> {
    const listings = (await this.repo.allListings())
      .filter((l) => l.sellerId === accountId)
      .map(({ sellerId, ...l }) => ({ ...l, mine: sellerId === accountId }));
    const orders = (await this.repo.allOrders())
      .filter((o) => o.buyerId === accountId)
      .map(({ buyerId, ...o }) => ({ ...o, mine: buyerId === accountId }));
    return {
      listings,
      orders,
      collection: await this.repo.collection(accountId),
      sales: await this.repo.sales(accountId, EXCHANGE.history),
    };
  }

  /** How much room this account has for an item or a potion arriving. */
  private async room(
    accountId: number,
  ): Promise<{ stash: number; rack: number }> {
    return {
      stash: await this.capacity(accountId, "stash"),
      rack: await this.capacity(accountId, "rack"),
    };
  }

  /** An Artifact the serf wears used itself up (D-153): it is gone. */
  spendArtifact(
    accountId: number,
    serfId: number,
    artifact: ArtifactId,
  ): Promise<boolean> {
    return this.repo.destroyWorn(accountId, serfId, artifact);
  }

  /** A leaderboard (D-148): serf names and scores only, never account data. */
  leaderboard(query: LeaderboardQuery): Promise<LeaderboardEntry[]> {
    return this.repo.leaderboard(
      normalizeLeaderboardQuery(query),
      LEADERBOARD_SIZE,
    );
  }
}

/** What an Exchange action did (D-156): a trade happened, or it waits on the board. */
export type ExchangeOutcome =
  { ok: true; deal: ExchangeDeal | null } | { ok: false; reason: string };

function refused(reason: string): ExchangeOutcome {
  return { ok: false, reason };
}

const BAD_PRICE = `A price is a whole number from ${EXCHANGE.minPrice} to ${EXCHANGE.maxPrice.toLocaleString("en")} gold.`;

const DEAL_REFUSALS: Record<ExchangeRefusal["reason"], string> = {
  gone: "That has already gone.",
  own: "That is your own.",
  gold: "Not enough gold.",
  notYours: "Only an item in your stash or a potion in your rack can be sold.",
  noFit: "That is not what the order asks for.",
  tooMany: "Too many.",
};
