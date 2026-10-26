import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MemoryAccountRepo,
  PgAccountRepo,
  type AccountRepo,
} from "../auth/account-repo.ts";
import { AccountService } from "../auth/account-service.ts";
import { readFile } from "node:fs/promises";
import {
  isValidItemSpec,
  newRunStats,
  SERF_BASE,
  type ServerMessage,
  type LeaderboardQuery,
  zeroStats,
  rollArtifact,
} from "@serfdom/shared";
import {
  MemorySerfRepo,
  PgSerfRepo,
  type SerfRepo,
} from "../serfs/serf-repo.ts";
import { migrate } from "./migrate.ts";
import { freshTestDatabase } from "./test-db.ts";

/*
 * Integration tests against the real PostgreSQL test database
 * (TEST_DATABASE_URL). All database tests live in this one file so they
 * never wipe the database under each other.
 */

let pool: pg.Pool;
beforeAll(async () => {
  pool = await freshTestDatabase();
});
afterAll(async () => {
  await pool?.end();
});

describe("items in PostgreSQL", () => {
  it("rows: stash items have no serf; a death keeps them", async () => {
    const accounts = new PgAccountRepo(pool);
    const acc = await accounts.createAccount("items-death@b.co", "h");
    if (acc === "taken") throw new Error("taken");
    const repo = new PgSerfRepo(pool);
    const serf = await repo.create(acc.id, "Item Corpse", 2);
    if (typeof serf === "string") throw new Error(serf);
    const cape = {
      slot: "cape" as const,
      type: "speed" as const,
      tier: 0,
      rolls: [],
      luck: 0,
    };
    await repo.addLoot(acc.id, serf.id, [cape], 20);
    const rows = async () =>
      (
        await pool.query<{ location: string; serf_id: string | null }>(
          "select location, serf_id from items where account_id = $1",
          [acc.id],
        )
      ).rows;
    expect(await rows()).toEqual([{ location: "stash", serf_id: null }]);
    await repo.recordRun(
      acc.id,
      serf.id,
      "died",
      { ...newRunStats(), seconds: 1 },
      { dungeon: "x", killedBy: null },
      0,
    );
    expect(await rows()).toHaveLength(1);
  });
});

describe("migrations", () => {
  it("are recorded, and running them again applies nothing", async () => {
    const names = (
      await pool.query<{ name: string }>(
        "select name from schema_migrations order by name",
      )
    ).rows.map((r) => r.name);
    expect(names).toContain("001_accounts.sql");
    expect(await migrate(pool)).toEqual([]);
  });

  it("009 brings items rolled under the old rules in line with D-106", async () => {
    const accounts = new PgAccountRepo(pool);
    const acc = await accounts.createAccount("old-items@b.co", "h");
    if (acc === "taken") throw new Error("taken");
    // Old shapes, written directly: accessories had no base stat and a roll
    // even at T0; rolls came in below T4 and grew with the tier.
    const old = [
      ["ring", null, 0, [{ stat: "hp", amount: 1 }], 1],
      ["cape", null, 2, [{ stat: "speed", amount: 3 }], 0],
      [
        "necklace",
        null,
        7,
        [
          { stat: "attack", amount: 8 },
          { stat: "hp", amount: -20 },
          { stat: "defense", amount: 1 },
          { stat: "mp", amount: 5 },
        ],
        1,
      ],
      ["weapon", "bow", 2, [{ stat: "dexterity", amount: 3 }], 1],
      [
        "chest",
        "plate",
        6,
        [
          { stat: "vitality", amount: -7 },
          { stat: "wisdom", amount: 2 },
          { stat: "hp", amount: 21 },
        ],
        0,
      ],
    ] as const;
    for (const [slot, type, tier, rolls, luck] of old) {
      await pool.query(
        `insert into items (account_id, location, slot, type, tier, rolls, luck)
         values ($1, 'stash', $2, $3, $4, $5, $6)`,
        [acc.id, slot, type, tier, JSON.stringify(rolls), luck],
      );
    }
    const sql = await readFile(
      new URL("../../migrations/009_accessory_bases.sql", import.meta.url),
      "utf8",
    );
    await pool.query(sql);
    const stash = await new PgSerfRepo(pool).stash(acc.id);
    expect(stash.items).toHaveLength(old.length);
    for (const item of stash.items) {
      expect(isValidItemSpec(item), JSON.stringify(item)).toBe(true);
    }
    const bySlot = Object.fromEntries(stash.items.map((i) => [i.slot, i]));
    // Below T4: rolls and Luck gone. Accessories gained a base stat.
    expect(bySlot.ring).toMatchObject({ rolls: [], luck: 0 });
    expect(bySlot.weapon).toMatchObject({ type: "bow", rolls: [], luck: 0 });
    // T4 and up: the same rolls, capped at 3 (9 for HP and MP), Luck kept.
    expect(bySlot.necklace?.rolls).toEqual([
      { stat: "attack", amount: 3 },
      { stat: "hp", amount: -9 },
      { stat: "defense", amount: 1 },
      { stat: "mp", amount: 5 },
    ]);
    expect(bySlot.necklace?.luck).toBe(1);
    expect(["attack", "hp", "defense", "mp"]).not.toContain(
      bySlot.necklace?.type,
    );
    expect(bySlot.chest?.rolls).toEqual([
      { stat: "vitality", amount: -3 },
      { stat: "wisdom", amount: 2 },
      { stat: "hp", amount: 9 },
    ]);
  });

  it("created the account, serf, and item tables", async () => {
    const tables = (
      await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      )
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual([
      "accounts",
      "clears",
      "items",
      "listings",
      "orders",
      "potions",
      "sales",
      "schema_migrations",
      "serfs",
      "sessions",
    ]);
  });
});

/** The same behavior, whichever storage is behind it. */
function repoContract(name: string, makeRepo: () => AccountRepo) {
  describe(`${name} account storage`, () => {
    const token = (n: number) => Buffer.alloc(32, n);

    it("creates accounts, refuses a taken email, finds by email", async () => {
      const repo = makeRepo();
      const a = await repo.createAccount(`${name}-a@b.co`, "hash-a");
      expect(a).toMatchObject({
        email: `${name}-a@b.co`,
        passwordHash: "hash-a",
      });
      expect(await repo.createAccount(`${name}-a@b.co`, "hash-x")).toBe(
        "taken",
      );
      expect(await repo.findByEmail(`${name}-a@b.co`)).toEqual(a);
      expect(await repo.findByEmail(`${name}-missing@b.co`)).toBeNull();
    });

    it("finds a session until it expires or is deleted", async () => {
      const repo = makeRepo();
      const a = await repo.createAccount(`${name}-s@b.co`, "h");
      if (a === "taken") throw new Error("taken");
      const now = new Date("2026-10-22T12:00:00Z");
      await repo.createSession(
        a.id,
        token(1),
        new Date("2026-10-23T12:00:00Z"),
      );
      expect(await repo.findSession(token(1), now)).toEqual({
        accountId: a.id,
        email: `${name}-s@b.co`,
      });
      expect(
        await repo.findSession(token(1), new Date("2026-10-24T00:00:00Z")),
      ).toBeNull();
      expect(await repo.findSession(token(2), now)).toBeNull();
      await repo.deleteSession(token(1));
      expect(await repo.findSession(token(1), now)).toBeNull();
    });
  });
}

repoContract("memory", () => new MemoryAccountRepo());
repoContract("postgres", () => new PgAccountRepo(pool));

describe("accounts in PostgreSQL", () => {
  it("survive a new connection pool (a server restart)", async () => {
    const accounts = new AccountService(new PgAccountRepo(pool), {
      passwordCost: { log2N: 4, r: 1, p: 1 },
    });
    const reg = await accounts.register("restart@b.co", "long enough");
    if (!reg.ok) throw new Error(reg.reason);
    // A brand-new pool stands in for a restarted server process.
    const { default: pgModule } = await import("pg");
    const second = new pgModule.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    try {
      const after = new AccountService(new PgAccountRepo(second), {
        passwordCost: { log2N: 4, r: 1, p: 1 },
      });
      expect(await after.resume(reg.token)).toMatchObject({
        ok: true,
        accountId: reg.accountId,
      });
      expect(await after.login("restart@b.co", "long enough")).toMatchObject({
        ok: true,
      });
    } finally {
      await second.end();
    }
  });

  it("stores no password or token in readable form", async () => {
    const rows = (
      await pool.query<{ password_hash: string }>(
        "select password_hash from accounts",
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows)
      expect(r.password_hash).toMatch(/^scrypt\$|^hash-|^h$/);
    const plain = (
      await pool.query<{ n: string }>(
        "select count(*) n from accounts where password_hash like '%long enough%'",
      )
    ).rows[0]?.n;
    expect(plain).toBe("0");
  });

  it("deleting an account removes its sessions", async () => {
    const repo = new PgAccountRepo(pool);
    const a = await repo.createAccount("cascade@b.co", "h");
    if (a === "taken") throw new Error("taken");
    await repo.createSession(
      a.id,
      Buffer.alloc(32, 9),
      new Date(Date.now() + 60_000),
    );
    await pool.query("delete from accounts where id = $1", [a.id]);
    expect(await repo.findSession(Buffer.alloc(32, 9), new Date())).toBeNull();
  });
});

const RING = {
  slot: "ring" as const,
  type: "defense" as const,
  tier: 4,
  rolls: [
    { stat: "hp" as const, amount: -7 },
    { stat: "speed" as const, amount: 1 },
  ],
  luck: 1,
};

/** A ring no other test trades, for clean price history. */
const WISDOM_RING = { ...RING, type: "wisdom" as const };

const EXP_BOARD = {
  board: "exp",
  classId: null,
  dungeon: null,
  soloOnly: false,
} as const;

/** Serf storage behaves the same in memory and in PostgreSQL. */
function serfContract(
  name: string,
  make: () => Promise<{ repo: SerfRepo; account: () => Promise<number> }>,
) {
  describe(`${name} serf storage`, () => {
    const run = {
      ...newRunStats(),
      seconds: 30,
      enemiesDefeated: 2,
      damageTaken: 6,
    };

    it("keeps the boards (D-148): EXP by class, clears, enemies slain, each serf's fastest clear", async () => {
      const { repo, account } = await make();
      const a = await account();
      const fast = await repo.create(a, `${name}Fast`, 2);
      const slow = await repo.create(a, `${name}Slow`, 2);
      if (typeof fast === "string" || typeof slow === "string") {
        throw new Error("create failed");
      }
      const d = "dragons-roost" as const;
      const at = (seconds: number) => ({ ...run, seconds });
      await repo.recordRun(a, fast.id, "completed", at(90), null, 10, {
        dungeon: d,
        partySize: 3,
      });
      await repo.recordRun(a, fast.id, "completed", at(120), null, 10, {
        dungeon: d,
        partySize: 1,
      });
      await repo.recordRun(a, slow.id, "completed", at(100), null, 10, {
        dungeon: d,
        partySize: 1,
      });
      // A run left early records no clear.
      await repo.recordRun(a, slow.id, "left", at(5), null, 0, null);
      const mine = (e: { name: string }) =>
        e.name === `${name}Fast` || e.name === `${name}Slow`;
      const board = async (q: Partial<LeaderboardQuery>) =>
        (await repo.leaderboard({ ...EXP_BOARD, ...q }, 100))
          .filter(mine)
          .map((e) => [e.name, e.value, e.partySize]);
      // Each serf's best time only, fastest first, with its party size.
      expect(await board({ board: "fastest", dungeon: d })).toEqual([
        [`${name}Fast`, 90, 3],
        [`${name}Slow`, 100, 1],
      ]);
      expect(
        await board({ board: "fastest", dungeon: d, soloOnly: true }),
      ).toEqual([
        [`${name}Slow`, 100, 1],
        [`${name}Fast`, 120, 1],
      ]);
      expect(await board({ board: "clears" })).toEqual([
        [`${name}Fast`, 2, null],
        [`${name}Slow`, 1, null],
      ]);
      // Two enemies a run each; a tie goes to the older serf.
      expect(await board({ board: "kills" })).toEqual([
        [`${name}Fast`, 4, null],
        [`${name}Slow`, 4, null],
      ]);
      // The class filter: neither has a class.
      expect(await board({ classId: "wizard" })).toEqual([]);
      expect((await board({})).length).toBe(2);
    });

    it("creates up to the slot limit, names unique among the living (any case)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const b = await account();
      const first = await repo.create(a, `${name}Edda`, 2);
      expect(first).toMatchObject({
        name: `${name}Edda`,
        level: 1,
        alive: true,
        death: null,
      });
      expect(await repo.create(b, `${name}EDDA`, 2)).toBe("nameTaken");
      expect(await repo.create(a, `${name}Odo`, 2)).toMatchObject({
        alive: true,
      });
      expect(await repo.create(a, `${name}Maud`, 2)).toBe("slotsFull");
      expect((await repo.list(a)).map((s) => s.name)).toEqual([
        `${name}Edda`,
        `${name}Odo`,
      ]);
    });

    it("records runs; death is permanent, frees the slot and the name", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Hilda`, 1);
      if (typeof serf === "string") throw new Error(serf);
      const after = await repo.recordRun(
        a,
        serf.id,
        "completed",
        run,
        null,
        100,
      );
      expect(after).toMatchObject({ exp: 100, level: 2 });
      expect(after?.life).toMatchObject({
        runs: 1,
        clears: 1,
        seconds: 30,
        enemiesDefeated: 2,
      });
      const dead = await repo.recordRun(
        a,
        serf.id,
        "died",
        run,
        { dungeon: "goblin-warrens", killedBy: "brute" },
        0,
      );
      // The dead keep their final EXP (GDD §7).
      expect(dead).toMatchObject({ exp: 100, level: 2 });
      expect(dead).toMatchObject({
        alive: false,
        death: { dungeon: "goblin-warrens", killedBy: "brute" },
      });
      expect(dead?.life).toMatchObject({ runs: 2, clears: 1, seconds: 60 });
      // A corpse takes no more runs and cannot die twice.
      expect(
        await repo.recordRun(a, serf.id, "completed", run, null, 100),
      ).toBeNull();
      // Its slot and its name are free again; the dead stay listed after the living.
      const heir = await repo.create(a, `${name}hilda`, 1);
      expect(heir).toMatchObject({ alive: true });
      expect((await repo.list(a)).map((s) => [s.name, s.alive])).toEqual([
        [`${name}hilda`, true],
        [`${name}Hilda`, false],
      ]);
    });

    it("ranks every serf, living and dead, by lifetime EXP with names only", async () => {
      const { repo, account } = await make();
      const a = await account();
      const top = await repo.create(a, `${name}Top`, 2);
      if (typeof top === "string") throw new Error(top);
      await repo.recordRun(a, top.id, "completed", run, null, 1_000_000);
      await repo.recordRun(
        a,
        top.id,
        "died",
        run,
        { dungeon: "x", killedBy: null },
        0,
      );
      const board = await repo.leaderboard(EXP_BOARD, 3);
      expect(board[0]).toEqual({
        rank: 1,
        name: `${name}Top`,
        level: 20,
        value: 1_000_000,
        classId: null,
        alive: false,
        partySize: null,
      });
      expect(board.length).toBeLessThanOrEqual(3);
      expect(board.map((e) => e.rank)).toEqual(board.map((_, i) => i + 1));
    });

    it("sets a class once, only from enough EXP, only while alive (D-073)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Maud`, 2);
      if (typeof serf === "string") throw new Error(serf);
      expect(serf.classId).toBeNull();
      expect(
        await repo.chooseClass(
          a,
          serf.id,
          "cleric",
          500,
          { ...SERF_BASE, hp: 33 },
          1,
        ),
      ).toBeNull();
      await repo.recordRun(a, serf.id, "completed", run, null, 500);
      const chosen = await repo.chooseClass(
        a,
        serf.id,
        "cleric",
        500,
        { ...SERF_BASE, hp: 33 },
        1,
      );
      expect(chosen).toMatchObject({ classId: "cleric", exp: 500 });
      // Permanent: a second pick changes nothing.
      expect(
        await repo.chooseClass(
          a,
          serf.id,
          "rogue",
          500,
          { ...SERF_BASE, hp: 33 },
          1,
        ),
      ).toBeNull();
      expect((await repo.find(a, serf.id))?.classId).toBe("cleric");
      expect(
        (await repo.leaderboard(EXP_BOARD, 100)).find(
          (e) => e.name === `${name}Maud`,
        ),
      ).toMatchObject({ classId: "cleric" });

      const other = await account();
      const late = await repo.create(a, `${name}Late`, 2);
      if (typeof late === "string") throw new Error(late);
      await repo.recordRun(
        a,
        late.id,
        "died",
        run,
        { dungeon: "x", killedBy: null },
        500,
      );
      expect(
        await repo.chooseClass(
          a,
          late.id,
          "bard",
          500,
          { ...SERF_BASE, hp: 33 },
          1,
        ),
      ).toBeNull();
      expect(
        await repo.chooseClass(
          other,
          serf.id,
          "bard",
          0,
          { ...SERF_BASE, hp: 33 },
          1,
        ),
      ).toBeNull();
    });

    it("stores rolled stats, saved only from the expected stats level", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Rolf`, 2);
      if (typeof serf === "string") throw new Error(serf);
      expect(serf.stats).toEqual(SERF_BASE);
      expect(await repo.findWithStatsLevel(a, serf.id)).toMatchObject({
        statsLevel: 1,
      });
      const rolled = { ...SERF_BASE, hp: 24, attack: 11 };
      expect(await repo.saveStats(a, serf.id, rolled, 1, 3)).toMatchObject({
        stats: rolled,
      });
      // Already at 3: a second save of "levels 2–3" is refused.
      expect(
        await repo.saveStats(a, serf.id, { ...rolled, hp: 99 }, 1, 3),
      ).toBeNull();
      const found = await repo.findWithStatsLevel(a, serf.id);
      expect(found).toMatchObject({ statsLevel: 3, serf: { stats: rolled } });
      expect((await repo.list(a))[0]?.stats).toEqual(rolled);
      // Not someone else's, not the dead's.
      const b = await account();
      expect(await repo.saveStats(b, serf.id, SERF_BASE, 3, 4)).toBeNull();
      await repo.recordRun(
        a,
        serf.id,
        "died",
        run,
        { dungeon: "x", killedBy: null },
        0,
      );
      expect(await repo.saveStats(a, serf.id, SERF_BASE, 3, 4)).toBeNull();
    });

    it("a class pick also saves the bonus stats, guarded on the stats level", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Bonus`, 2);
      if (typeof serf === "string") throw new Error(serf);
      await repo.recordRun(a, serf.id, "completed", run, null, 500);
      const bonus = { ...SERF_BASE, hp: 40 };
      expect(
        await repo.chooseClass(a, serf.id, "druid", 500, bonus, 2),
      ).toBeNull();
      expect(
        await repo.chooseClass(a, serf.id, "druid", 500, bonus, 1),
      ).toMatchObject({
        classId: "druid",
        stats: bonus,
      });
    });

    it("puts loot in the stash, then pending when it is full (D-086, D-088)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Loot`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const drops = await repo.addLoot(a, serf.id, [RING, RING, RING], 2);
      expect(drops?.map((d) => d.pending)).toEqual([false, false, true]);
      const [first, second, third] = drops ?? [];
      expect(first?.item).toEqual({
        ...RING,
        id: first?.item.id,
        equipped: null,
      });
      expect(second!.item.id).toBeGreaterThan(first!.item.id);
      const stash = await repo.stash(a);
      expect(stash.gold).toBe(0);
      expect(stash.items.map((i) => i.id)).toEqual([
        first?.item.id,
        second?.item.id,
      ]);
      expect(stash.pending).toEqual([{ item: third?.item, serfId: serf.id }]);
      expect(await repo.hasPending(a, serf.id)).toBe(true);
      // A serf carries only what it wears: nothing yet (D-085).
      expect((await repo.find(a, serf.id))?.items).toEqual([]);
      // Not someone else's serf.
      const b = await account();
      expect(await repo.addLoot(b, serf.id, [RING], 16)).toBeNull();
    });

    it("the Exchange: list, buy, take back; gold moves once, less the fee; bought things wait to be collected (D-155, D-156)", async () => {
      const { repo, account } = await make();
      const seller = await account();
      const buyer = await account();
      const s = await repo.create(seller, `${name}Vendor`, 2);
      const b = await repo.create(buyer, `${name}Shopper`, 2);
      if (typeof s === "string" || typeof b === "string")
        throw new Error("create");
      const [drop] = (await repo.addLoot(seller, s.id, [RING], 20))!;
      const itemId = drop!.item.id;
      const room = { stash: 20, rack: 20 };
      // Only the owner's stash item can be listed; a buyer cannot take it back.
      expect(await repo.listOnExchange(buyer, { itemId }, 100, 10)).toEqual({
        kind: "refused",
        reason: "notYours",
      });
      expect(await repo.listOnExchange(seller, { itemId }, 100, 10)).toEqual({
        kind: "listed",
      });
      expect(
        (await repo.listOnExchange(seller, { itemId }, 100, 10)).kind,
      ).toBe("refused");
      expect((await repo.stash(seller)).items).toEqual([]);
      const [listing] = await repo.allListings();
      expect(listing).toMatchObject({
        sellerId: seller,
        price: 100,
        item: { id: itemId },
      });
      expect(await repo.cancelListing(buyer, listing!.id, room)).toBe(
        "notYours",
      );
      // Buying: own refused, no gold refused, then it goes.
      expect(await repo.buyListing(seller, listing!.id)).toEqual({
        kind: "refused",
        reason: "own",
      });
      expect(await repo.buyListing(buyer, listing!.id)).toEqual({
        kind: "refused",
        reason: "gold",
      });
      await repo.addGold(buyer, 150);
      expect(await repo.buyListing(buyer, listing!.id)).toEqual({
        kind: "deal",
        sellerId: seller,
        buyerId: buyer,
        what: "T4 Ring of Defense",
        price: 100,
        fee: 5,
      });
      expect(await repo.buyListing(buyer, listing!.id)).toEqual({
        kind: "refused",
        reason: "gone",
      });
      // It waits in the collection box, not the stash, until collected.
      expect((await repo.stash(buyer)).items).toEqual([]);
      expect((await repo.collection(buyer)).items.map((i) => i.id)).toEqual([
        itemId,
      ]);
      expect((await repo.stash(buyer)).gold).toBe(50);
      expect((await repo.stash(seller)).gold).toBe(95);
      expect(await repo.allListings()).toEqual([]);
      expect((await repo.sales(seller, 20))[0]).toMatchObject({
        role: "sold",
        key: "t:4:ring:defense",
        price: 100,
        fee: 5,
      });
      expect((await repo.sales(buyer, 20))[0]).toMatchObject({
        role: "bought",
        price: 100,
        fee: 0,
      });
      // Collecting needs room: none, then some.
      expect(await repo.collect(buyer, { stash: 0, rack: 20 })).toBe(1);
      expect(await repo.collect(buyer, room)).toBe(0);
      expect((await repo.stash(buyer)).items.map((i) => i.id)).toEqual([
        itemId,
      ]);
      expect((await repo.collection(buyer)).items).toEqual([]);
      // A potion goes from the rack; taking one back needs room.
      const [potion] = (await repo.addPotions(buyer, b.id, ["hp"], 20))!;
      const potionId = potion!.potion.id;
      expect(await repo.listOnExchange(buyer, { potionId }, 30, 10)).toEqual({
        kind: "listed",
      });
      expect((await repo.stash(buyer)).rack).toEqual([]);
      const [pl] = await repo.allListings();
      expect(
        await repo.cancelListing(buyer, pl!.id, { stash: 20, rack: 0 }),
      ).toBe("noRoom");
      expect(await repo.cancelListing(buyer, pl!.id, room)).toBe("ok");
      expect((await repo.stash(buyer)).rack.map((p) => p.id)).toEqual([
        potionId,
      ]);
      // At most `max` listings at once.
      expect(await repo.listOnExchange(buyer, { potionId }, 30, 0)).toEqual({
        kind: "refused",
        reason: "tooMany",
      });
    });

    it("buy orders set gold aside, fill at the first one's price, want their rolls, and refund on cancel (D-156)", async () => {
      const { repo, account } = await make();
      const seller = await account();
      const early = await account();
      const late = await account();
      const s = await repo.create(seller, `${name}Maker`, 2);
      if (typeof s === "string") throw new Error(s);
      const key = "t:4:ring:wisdom";
      await repo.addGold(early, 500);
      await repo.addGold(late, 500);
      // Gold is set aside; not more than the buyer has, nor too many orders.
      expect(await repo.placeOrder(early, key, [], 900, 10)).toEqual({
        kind: "refused",
        reason: "gold",
      });
      expect(await repo.placeOrder(early, key, [], 200, 10)).toEqual({
        kind: "placed",
      });
      expect(await repo.placeOrder(late, key, [], 200, 10)).toEqual({
        kind: "placed",
      });
      expect(await repo.placeOrder(late, key, ["dexterity"], 300, 10)).toEqual({
        kind: "placed",
      });
      expect(await repo.placeOrder(late, key, [], 1, 2)).toEqual({
        kind: "refused",
        reason: "tooMany",
      });
      expect((await repo.stash(early)).gold).toBe(300);
      expect((await repo.stash(late)).gold).toBe(0);
      const orders = await repo.allOrders();
      expect(orders.map((o) => [o.buyerId, o.price, o.rolls])).toEqual([
        [late, 300, ["dexterity"]],
        [early, 200, []],
        [late, 200, []],
      ]);
      // Listing at 150 sells at once, at the order's 200, to the earlier of
      // the two 200s: the 300 order wants a DEX roll this ring lacks.
      const [r1, r2] = (await repo.addLoot(
        seller,
        s.id,
        [WISDOM_RING, WISDOM_RING],
        20,
      ))!;
      expect(
        await repo.listOnExchange(seller, { itemId: r1!.item.id }, 150, 10),
      ).toMatchObject({ kind: "deal", buyerId: early, price: 200, fee: 10 });
      expect((await repo.stash(seller)).gold).toBe(190);
      expect((await repo.collection(early)).items.map((i) => i.id)).toEqual([
        r1!.item.id,
      ]);
      expect((await repo.stash(early)).gold).toBe(300);
      // Asking more than any order pays: it is listed instead.
      expect(
        await repo.listOnExchange(seller, { itemId: r2!.item.id }, 250, 10),
      ).toEqual({ kind: "listed" });
      // Selling straight to an order: the one that fits, not your own.
      const [dexOrder, plainOrder] = (await repo.allOrders()).filter(
        (o) => o.buyerId === late,
      );
      const [r3] = (await repo.addLoot(seller, s.id, [WISDOM_RING], 20))!;
      expect(
        await repo.sellToOrder(seller, dexOrder!.id, { itemId: r3!.item.id }),
      ).toEqual({ kind: "refused", reason: "noFit" });
      expect(
        await repo.sellToOrder(late, plainOrder!.id, { itemId: r3!.item.id }),
      ).toMatchObject({ kind: "refused" });
      expect(
        await repo.sellToOrder(seller, plainOrder!.id, {
          itemId: r3!.item.id,
        }),
      ).toMatchObject({ kind: "deal", buyerId: late, price: 200 });
      // Cancelling gives the set-aside gold back, once.
      expect(await repo.cancelOrder(early, dexOrder!.id)).toBe(false);
      expect(await repo.cancelOrder(late, dexOrder!.id)).toBe(true);
      expect(await repo.cancelOrder(late, dexOrder!.id)).toBe(false);
      expect((await repo.stash(late)).gold).toBe(300);
      // Ordering into a listing buys the cheapest fitting one at its price.
      const listed = (await repo.allListings()).find(
        (l) => l.sellerId === seller,
      )!;
      expect(await repo.placeOrder(early, key, ["luck"], 260, 10)).toEqual({
        kind: "deal",
        sellerId: seller,
        buyerId: early,
        what: "T4 Ring of Wisdom",
        price: 250,
        fee: 12,
      });
      expect((await repo.stash(early)).gold).toBe(50);
      expect(
        (await repo.collection(early)).items.map((i) => i.id).sort(),
      ).toEqual([r1!.item.id, listed.item!.id].sort());
      // Leave the board empty for the other tests.
      for (const o of await repo.allOrders()) {
        expect(await repo.cancelOrder(o.buyerId, o.id)).toBe(true);
      }
      expect(await repo.allListings()).toEqual([]);
      // Price history: three sales of this kind, averaging 217.
      const windows = await repo.priceWindows(key);
      expect(windows.map((w) => w.window)).toEqual(["24h", "7d", "30d", "all"]);
      for (const w of windows) {
        expect(w).toMatchObject({ sales: 3, average: 217 });
      }
      expect(await repo.priceWindows("p:hp")).toContainEqual({
        window: "all",
        sales: 0,
        average: null,
      });
    });

    it("a listed item cannot be sold to the vendor or worn (D-155)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Lister`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const [drop] = (await repo.addLoot(a, serf.id, [RING], 20))!;
      expect(
        await repo.listOnExchange(a, { itemId: drop!.item.id }, 10, 10),
      ).toEqual({ kind: "listed" });
      expect(await repo.sell(a, drop!.item.id, 20)).toBeNull();
      expect(
        await repo.equip(a, serf.id, drop!.item.id, "ring1", 20),
      ).toBeNull();
      // Leave the board empty for the other tests.
      const [l] = (await repo.allListings()).filter((x) => x.sellerId === a);
      expect(await repo.cancelListing(a, l!.id, { stash: 20, rack: 20 })).toBe(
        "ok",
      );
    });

    it("buys upgrades with gold, once per price, never past the max or the balance (D-154)", async () => {
      const { repo, account } = await make();
      const a = await account();
      expect(await repo.upgrades(a)).toEqual({
        serfSlots: 0,
        stash: 0,
        rack: 0,
      });
      // No gold: refused.
      expect(await repo.buyUpgrade(a, "stash", 0, 500)).toBe(false);
      await repo.addGold(a, 1200);
      expect(await repo.buyUpgrade(a, "stash", 0, 500)).toBe(true);
      // A repeat of the same purchase (stale count) is refused.
      expect(await repo.buyUpgrade(a, "stash", 0, 500)).toBe(false);
      expect(await repo.upgrades(a)).toEqual({
        serfSlots: 0,
        stash: 1,
        rack: 0,
      });
      expect((await repo.stash(a)).gold).toBe(700);
      // Not enough for the next.
      expect(await repo.buyUpgrade(a, "stash", 1, 1000)).toBe(false);
      expect((await repo.stash(a)).gold).toBe(700);
    });

    it("keeps an Artifact and a Shiny item as they dropped (D-152, D-153)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Lucky`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const axe = { ...rollArtifact("doomrend", () => 0.5), shiny: true };
      const drops = await repo.addLoot(a, serf.id, [axe, RING], 20);
      const [kept, plain] = (await repo.stash(a)).items;
      expect(kept).toEqual({ ...axe, id: drops![0]!.item.id, equipped: null });
      // An ordinary item gets neither field.
      expect(plain).toEqual({
        ...RING,
        id: drops![1]!.item.id,
        equipped: null,
      });
    });

    it("sells once for the vendor price, and room made takes in a pending reward (D-087)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Sell`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const drops = (await repo.addLoot(a, serf.id, [RING, RING], 1)) ?? [];
      const kept = drops[0]!.item;
      const waiting = drops[1]!.item;
      // T4 ring with +1 Luck: value 5 × 25 × 1.5 = 187.5, sells for 93.
      expect(await repo.sell(a, kept.id, 1)).toEqual({ price: 93 });
      expect(await repo.sell(a, kept.id, 1)).toBeNull(); // only once
      const after = await repo.stash(a);
      expect(after.gold).toBe(93);
      expect(after.items.map((i) => i.id)).toEqual([waiting.id]);
      expect(after.pending).toEqual([]);
      expect(await repo.hasPending(a, serf.id)).toBe(false);
      // Someone else cannot sell it.
      const b = await account();
      expect(await repo.sell(b, waiting.id, 1)).toBeNull();
      expect((await repo.stash(b)).gold).toBe(0);
      // A pending reward itself can be sold too.
      const more = (await repo.addLoot(a, serf.id, [RING], 1)) ?? [];
      expect(more[0]?.pending).toBe(true);
      expect(await repo.sell(a, more[0]!.item.id, 1)).toEqual({ price: 93 });
      expect((await repo.stash(a)).gold).toBe(186);
    });

    it("a death keeps the stash, gold, and pending rewards (D-079, D-085)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Corpse`, 2);
      if (typeof serf === "string") throw new Error(serf);
      await repo.addLoot(a, serf.id, [RING, RING], 1);
      await repo.recordRun(
        a,
        serf.id,
        "died",
        run,
        { dungeon: "x", killedBy: null },
        0,
      );
      const stash = await repo.stash(a);
      expect(stash.items).toHaveLength(1);
      expect(stash.pending).toHaveLength(1);
      expect(await repo.addLoot(a, serf.id, [RING], 16)).toBeNull();
    });

    it("equips from the stash or pending; what it replaces goes to the stash or waits (9b)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Gear`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const [r1, r2] = (await repo.addLoot(a, serf.id, [RING, RING], 2)) ?? [];
      expect(await repo.equip(a, serf.id, r1!.item.id, "ring1", 2)).toEqual({
        replacedPending: false,
      });
      let worn = (await repo.find(a, serf.id))?.items;
      expect(worn).toEqual([{ ...r1!.item, equipped: "ring1" }]);
      expect((await repo.stash(a)).items.map((i) => i.id)).toEqual([
        r2!.item.id,
      ]);
      // Swap: r2 replaces r1, which goes back to the stash.
      expect(await repo.equip(a, serf.id, r2!.item.id, "ring1", 2)).toEqual({
        replacedPending: false,
      });
      worn = (await repo.find(a, serf.id))?.items;
      expect(worn?.map((i) => i.id)).toEqual([r2!.item.id]);
      expect((await repo.stash(a)).items.map((i) => i.id)).toEqual([
        r1!.item.id,
      ]);
      // Worn items cannot be equipped again or sold.
      expect(await repo.equip(a, serf.id, r2!.item.id, "ring2", 2)).toBeNull();
      expect(await repo.sell(a, r2!.item.id, 2)).toBeNull();
      // Unequip: into the stash while it has room.
      expect(await repo.unequip(a, serf.id, "ring1", 2)).toBe("ok");
      expect(await repo.unequip(a, serf.id, "ring1", 2)).toBeNull();
      expect((await repo.stash(a)).items).toHaveLength(2);
      expect(await repo.equip(a, serf.id, r1!.item.id, "ring2", 2)).toEqual({
        replacedPending: false,
      });
      // Stash 1/1 full: unequip refused; equipping a pending item over a
      // worn one sends the old one to pending.
      expect(await repo.unequip(a, serf.id, "ring2", 1)).toBe("full");
      const [waiting] = (await repo.addLoot(a, serf.id, [RING], 1)) ?? [];
      expect(waiting?.pending).toBe(true);
      expect(
        await repo.equip(a, serf.id, waiting!.item.id, "ring2", 1),
      ).toEqual({ replacedPending: true });
      expect((await repo.stash(a)).pending.map((p) => p.item.id)).toEqual([
        r1!.item.id,
      ]);
      // Not someone else's.
      const b = await account();
      expect(await repo.equip(b, serf.id, r2!.item.id, "ring1", 2)).toBeNull();
      expect(await repo.unequip(b, serf.id, "ring2", 2)).toBeNull();
      // Death: what it wore is gone; the stash stays.
      await repo.recordRun(
        a,
        serf.id,
        "died",
        run,
        { dungeon: "x", killedBy: null },
        0,
      );
      const after = await repo.stash(a);
      expect(after.items.map((i) => i.id)).toEqual([r2!.item.id]);
      expect(after.pending).toHaveLength(1);
      expect(await repo.equip(a, serf.id, r2!.item.id, "ring1", 20)).toBeNull();
    });

    it("grants the free ability item once, only to a living classed serf (D-092)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const serf = await repo.create(a, `${name}Grant`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const book = {
        slot: "ability" as const,
        type: "spellbook" as const,
        tier: 0,
        rolls: [],
        luck: 0,
      };
      expect(await repo.grantAbilityItem(a, serf.id, book)).toBe(false); // no class yet
      await repo.recordRun(a, serf.id, "completed", run, null, 500);
      await repo.chooseClass(a, serf.id, "wizard", 500, SERF_BASE, 1);
      const b = await account();
      expect(await repo.grantAbilityItem(b, serf.id, book)).toBe(false);
      expect(await repo.grantAbilityItem(a, serf.id, book)).toBe(true);
      expect(await repo.grantAbilityItem(a, serf.id, book)).toBe(false);
      expect((await repo.find(a, serf.id))?.items).toEqual([
        expect.objectContaining({ ...book, equipped: "ability" }),
      ]);
    });

    it("another account's serf does not exist for you", async () => {
      const { repo, account } = await make();
      const a = await account();
      const b = await account();
      const serf = await repo.create(a, `${name}Osric`, 2);
      if (typeof serf === "string") throw new Error(serf);
      expect(await repo.find(b, serf.id)).toBeNull();
      expect(
        await repo.recordRun(
          b,
          serf.id,
          "died",
          run,
          {
            dungeon: "x",
            killedBy: null,
          },
          0,
        ),
      ).toBeNull();
      expect((await repo.find(a, serf.id))?.alive).toBe(true);
      expect(await repo.list(b)).toEqual([]);
    });

    it("potions fill the rack, then wait for the serf that won them (D-118)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const b = await account();
      const serf = await repo.create(a, `${name}Brewer`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const drops = await repo.addPotions(
        a,
        serf.id,
        ["attack", "hp", "wisdom"],
        2,
      );
      expect(drops?.map((d) => [d.potion.stat, d.pending])).toEqual([
        ["attack", false],
        ["hp", false],
        ["wisdom", true],
      ]);
      expect(await repo.hasPending(a, serf.id)).toBe(true);
      const stash = await repo.stash(a);
      expect(stash.rack.map((p) => p.stat)).toEqual(["attack", "hp"]);
      expect(stash.pendingPotions).toEqual([
        { potion: drops![2]!.potion, serfId: serf.id },
      ]);
      // Not another account's, and never for someone else's serf.
      expect((await repo.stash(b)).rack).toEqual([]);
      expect(await repo.addPotions(b, serf.id, ["hp"], 20)).toBeNull();
      // Pouring one out makes room: the waiting potion moves in.
      expect(await repo.pourPotion(b, drops![0]!.potion.id, 2)).toBe(false);
      expect(await repo.pourPotion(a, drops![0]!.potion.id, 2)).toBe(true);
      expect(await repo.pourPotion(a, drops![0]!.potion.id, 2)).toBe(false);
      expect(await repo.hasPending(a, serf.id)).toBe(false);
      expect((await repo.stash(a)).rack.map((p) => p.stat)).toEqual([
        "hp",
        "wisdom",
      ]);
    });

    it("drinking raises the stat up to the serf's max, once, and checks the serf (D-075, D-118, D-119)", async () => {
      const { repo, account } = await make();
      const a = await account();
      const b = await account();
      const serf = await repo.create(a, `${name}Sipper`, 2);
      if (typeof serf === "string") throw new Error(serf);
      const [hp, attack, wisdom, again, defense] = (await repo.addPotions(
        a,
        serf.id,
        ["hp", "attack", "wisdom", "attack", "defense"],
        20,
      ))!.map((d) => d.potion.id);
      // A Serf drinks too, up to the Serf max (D-119); it has no Defense.
      expect(await repo.drinkPotion(a, serf.id, attack!, 20)).toMatchObject({
        serf: { stats: { attack: SERF_BASE.attack + 1 } },
      });
      expect(await repo.drinkPotion(a, serf.id, defense!, 20)).toMatchObject({
        refused: expect.stringContaining("needs a class first"),
      });
      const near = { ...SERF_BASE, hp: 198, attack: 49, wisdom: 40 };
      expect(
        await repo.chooseClass(a, serf.id, "fighter", 0, near, 1),
      ).not.toBeNull();
      // +5 HP stops at 200; +1 ATK reaches 50; WIS is already at 40.
      const drankHp = await repo.drinkPotion(a, serf.id, hp!, 20);
      expect(drankHp).toMatchObject({
        stat: "hp",
        serf: { stats: { hp: 200 } },
      });
      const drankAtk = await repo.drinkPotion(a, serf.id, again!, 20);
      expect(drankAtk).toMatchObject({ serf: { stats: { attack: 50 } } });
      // The tally counts what each potion really added (D-151): two ATK
      // potions, and HP cut to +2 by the max.
      expect((await repo.find(a, serf.id))?.potionStats).toEqual({
        ...zeroStats(),
        attack: 2,
        hp: 2,
      });
      expect(await repo.drinkPotion(a, serf.id, wisdom!, 20)).toMatchObject({
        refused: expect.stringContaining("already at its max"),
      });
      // A potion is drunk once; someone else's potion or serf does not exist.
      expect(await repo.drinkPotion(a, serf.id, hp!, 20)).toBeNull();
      expect(await repo.drinkPotion(b, serf.id, wisdom!, 20)).toBeNull();
      expect((await repo.find(a, serf.id))?.stats).toMatchObject({
        hp: 200,
        attack: 50,
        wisdom: 40,
      });
      expect((await repo.stash(a)).rack.map((p) => p.stat)).toEqual([
        "wisdom",
        "defense",
      ]);
      // The dead drink nothing, and the rack outlives them (D-079, D-118).
      await repo.recordRun(
        a,
        serf.id,
        "died",
        run,
        { dungeon: "goblin-stronghold", killedBy: "warchief" },
        0,
      );
      expect(await repo.drinkPotion(a, serf.id, wisdom!, 20)).toMatchObject({
        refused: expect.stringContaining("is dead"),
      });
      expect((await repo.stash(a)).rack).toHaveLength(2);
    });
  });
}

let accountSeq = 0;
serfContract("Mem", async () => ({
  repo: new MemorySerfRepo(),
  account: async () => ++accountSeq,
}));
serfContract("Pg", async () => {
  const accounts = new PgAccountRepo(pool);
  return {
    repo: new PgSerfRepo(pool),
    account: async () => {
      const a = await accounts.createAccount(`serfs${++accountSeq}@b.co`, "h");
      if (a === "taken") throw new Error("taken");
      return a.id;
    },
  };
});

describe("the Exchange in PostgreSQL (D-155, D-156)", () => {
  const make = async (who: string) => {
    const acc = await new PgAccountRepo(pool).createAccount(
      `${who}@race.co`,
      "h",
    );
    if (acc === "taken") throw new Error("taken");
    return acc.id;
  };

  it("five buyers racing for one listing: exactly one gets it, and no gold is made or lost", async () => {
    const repo = new PgSerfRepo(pool);
    const seller = await make("seller");
    const s = await repo.create(seller, "RaceSeller", 2);
    if (typeof s === "string") throw new Error(s);
    const [drop] = (await repo.addLoot(seller, s.id, [RING], 20))!;
    await repo.listOnExchange(seller, { itemId: drop!.item.id }, 1000, 10);
    const [listing] = (await repo.allListings()).filter(
      (l) => l.sellerId === seller,
    );
    const buyers = await Promise.all(["b1", "b2", "b3", "b4", "b5"].map(make));
    for (const b of buyers) await repo.addGold(b, 1000);
    const results = await Promise.all(
      buyers.map((b) => repo.buyListing(b, listing!.id)),
    );
    expect(results.filter((r) => r.kind === "deal")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.kind !== "deal")
        .every((r) => r.kind === "refused" && r.reason === "gone"),
    ).toBe(true);
    // The item is in exactly one collection box; gold in = gold out + the fee.
    const boxes = await Promise.all(buyers.map((b) => repo.collection(b)));
    expect(boxes.filter((c) => c.items.length === 1)).toHaveLength(1);
    const stashes = await Promise.all(buyers.map((b) => repo.stash(b)));
    const gold =
      stashes.reduce((sum, st) => sum + st.gold, 0) +
      (await repo.stash(seller)).gold;
    expect(gold).toBe(5 * 1000 - 50);
  });

  it("five sellers racing to fill one order: it fills once, and the others stay listed", async () => {
    const repo = new PgSerfRepo(pool);
    const buyer = await make("orderer");
    await repo.addGold(buyer, 400);
    expect(
      await repo.placeOrder(buyer, "t:4:ring:defense", [], 400, 10),
    ).toEqual({ kind: "placed" });
    const sellers = await Promise.all(["s1", "s2", "s3", "s4", "s5"].map(make));
    const rings: number[] = [];
    for (const [i, seller] of sellers.entries()) {
      const s = await repo.create(seller, `OrderSeller${i}`, 2);
      if (typeof s === "string") throw new Error(s);
      rings.push((await repo.addLoot(seller, s.id, [RING], 20))![0]!.item.id);
    }
    const results = await Promise.all(
      sellers.map((seller, i) =>
        repo.listOnExchange(seller, { itemId: rings[i]! }, 100, 10),
      ),
    );
    expect(results.filter((r) => r.kind === "deal")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "listed")).toHaveLength(4);
    expect(await repo.allOrders()).toEqual([]);
    expect((await repo.collection(buyer)).items).toHaveLength(1);
    expect((await repo.stash(buyer)).gold).toBe(0);
    const paid = await Promise.all(sellers.map((x) => repo.stash(x)));
    expect(paid.reduce((sum, st) => sum + st.gold, 0)).toBe(400 - 20);
    // Clear the board for the other tests.
    for (const l of await repo.allListings()) {
      expect(
        await repo.cancelListing(l.sellerId, l.id, { stash: 20, rack: 20 }),
      ).toBe("ok");
    }
  });
});

describe("serfs in PostgreSQL", () => {
  it("two creates racing for the last slot: exactly one wins", async () => {
    const a = await new PgAccountRepo(pool).createAccount("race@b.co", "h");
    if (a === "taken") throw new Error("taken");
    const repo = new PgSerfRepo(pool);
    const results = await Promise.all(
      ["RaceA", "RaceB", "RaceC", "RaceD"].map((n) => repo.create(a.id, n, 2)),
    );
    expect(results.filter((r) => typeof r !== "string")).toHaveLength(2);
    expect(results.filter((r) => r === "slotsFull")).toHaveLength(2);
  });

  it("a death survives a restart (new pool)", async () => {
    const a = await new PgAccountRepo(pool).createAccount("grave@b.co", "h");
    if (a === "taken") throw new Error("taken");
    const serf = await new PgSerfRepo(pool).create(a.id, "Wulfric", 2);
    if (typeof serf === "string") throw new Error(serf);
    await new PgSerfRepo(pool).recordRun(
      a.id,
      serf.id,
      "died",
      newRunStats(),
      {
        dungeon: "goblin-warrens",
        killedBy: "slinger",
      },
      0,
    );
    const { default: pgModule } = await import("pg");
    const second = new pgModule.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    try {
      expect(await new PgSerfRepo(second).find(a.id, serf.id)).toMatchObject({
        alive: false,
        death: { killedBy: "slinger" },
      });
    } finally {
      await second.end();
    }
  });
});

describe("Phase 7 acceptance: a real server restart (end to end)", () => {
  it("accounts, login tokens, and serfs survive; another account cannot take the serf", async () => {
    const { GameServer } = await import("../game-server.ts");
    const { AccountService } = await import("../auth/account-service.ts");
    const { SerfService } = await import("../serfs/serf-service.ts");
    const { silentLogger } = await import("../log.ts");
    const { WebSocket } = await import("ws");
    const { encodeMessage, parseServerMessage, PROTOCOL_VERSION } =
      await import("@serfdom/shared");
    const { default: pgModule } = await import("pg");
    type Msg = ServerMessage;

    const startServer = (p: pg.Pool) =>
      GameServer.start({
        port: 0,
        allowTestDungeons: true,
        autoTick: false,
        queueWaitSeconds: 0,
        log: silentLogger,
        accounts: new AccountService(new PgAccountRepo(p), {
          passwordCost: { log2N: 4, r: 1, p: 1 },
        }),
        serfs: new SerfService(new PgSerfRepo(p)),
      });
    async function client(port: number) {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const inbox: Msg[] = [];
      ws.on("message", (d) => {
        const parsed = parseServerMessage(d.toString());
        if (parsed.ok) inbox.push(parsed.message);
      });
      await new Promise((r) => ws.once("open", r));
      const send = (m: Parameters<typeof encodeMessage>[0]) =>
        ws.send(encodeMessage(m));
      async function next<T extends Msg["type"]>(
        type: T,
        pred: (m: Extract<Msg, { type: T }>) => boolean = () => true,
      ) {
        for (let i = 0; i < 400; i++) {
          const k = inbox.findIndex(
            (m) => m.type === type && pred(m as Extract<Msg, { type: T }>),
          );
          if (k >= 0) return inbox.splice(k, 1)[0] as Extract<Msg, { type: T }>;
          await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error(`no ${type}`);
      }
      send({ type: "hello", protocol: PROTOCOL_VERSION });
      await next("welcome");
      return { ws, send, next };
    }

    // Server 1: register, create a serf, play one run (leave with R).
    const pool1 = new pgModule.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const server1 = await startServer(pool1);
    const a = await client(server1.port);
    a.send({
      type: "register",
      email: "e2e@restart.test",
      password: "a long password",
    });
    const { token } = await a.next("authOk");
    a.send({ type: "createSerf", name: "Phoenix Rye" });
    const created = await a.next("serfList", (m) => m.selectedId !== null);
    const serfId = created.selectedId!;
    a.send({ type: "queue", dungeon: "training" });
    await a.next("queueStatus");
    server1.tick();
    await a.next("runStarted");
    a.send({ type: "exitDungeon" });
    const ended = await a.next("runEnded");
    expect(ended.serf).toMatchObject({
      id: serfId,
      alive: true,
      life: { runs: 1 },
    });
    a.ws.close();
    await server1.close();
    await pool1.end();

    // Server 2, a brand-new process state and connection pool on the same database.
    const pool2 = new pgModule.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const server2 = await startServer(pool2);
    try {
      const again = await client(server2.port);
      again.send({ type: "resume", token });
      expect(await again.next("authOk")).toMatchObject({
        email: "e2e@restart.test",
      });
      const list = await again.next("serfList");
      expect(list.serfs).toEqual([
        expect.objectContaining({
          id: serfId,
          name: "Phoenix Rye",
          alive: true,
          life: expect.objectContaining({ runs: 1 }),
        }),
      ]);

      // Another account cannot select (or play, or see) that serf.
      const b = await client(server2.port);
      b.send({
        type: "register",
        email: "e2e-other@restart.test",
        password: "a long password",
      });
      await b.next("authOk");
      expect((await b.next("serfList")).serfs).toEqual([]);
      b.send({ type: "selectSerf", serfId });
      expect((await b.next("serfError")).reason).toBe("No such serf.");
      // A client cannot claim results or stats: there is no such message.
      b.ws.send(
        JSON.stringify({ type: "recordRun", serfId, result: "completed" }),
      );
      expect((await b.next("error")).reason).toBe(
        'unknown message type "recordRun"',
      );
      again.ws.close();
      b.ws.close();
    } finally {
      await server2.close();
      await pool2.end();
    }
  });
});
