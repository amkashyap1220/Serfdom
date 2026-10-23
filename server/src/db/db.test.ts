import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MemoryAccountRepo,
  PgAccountRepo,
  type AccountRepo,
} from "../auth/account-repo.ts";
import { AccountService } from "../auth/account-service.ts";
import { newRunStats } from "@serfdom/shared";
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

  it("created the account and serf tables", async () => {
    const tables = (
      await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      )
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual([
      "accounts",
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
      const after = await repo.recordRun(a, serf.id, "completed", run, null);
      expect(after?.life).toMatchObject({
        runs: 1,
        clears: 1,
        seconds: 30,
        enemiesDefeated: 2,
      });
      const dead = await repo.recordRun(a, serf.id, "died", run, {
        dungeon: "goblin-warrens",
        killedBy: "brute",
      });
      expect(dead).toMatchObject({
        alive: false,
        death: { dungeon: "goblin-warrens", killedBy: "brute" },
      });
      expect(dead?.life).toMatchObject({ runs: 2, clears: 1, seconds: 60 });
      // A corpse takes no more runs and cannot die twice.
      expect(
        await repo.recordRun(a, serf.id, "completed", run, null),
      ).toBeNull();
      // Its slot and its name are free again; the dead stay listed after the living.
      const heir = await repo.create(a, `${name}hilda`, 1);
      expect(heir).toMatchObject({ alive: true });
      expect((await repo.list(a)).map((s) => [s.name, s.alive])).toEqual([
        [`${name}hilda`, true],
        [`${name}Hilda`, false],
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
        await repo.recordRun(b, serf.id, "died", run, {
          dungeon: "x",
          killedBy: null,
        }),
      ).toBeNull();
      expect((await repo.find(a, serf.id))?.alive).toBe(true);
      expect(await repo.list(b)).toEqual([]);
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
    await new PgSerfRepo(pool).recordRun(a.id, serf.id, "died", newRunStats(), {
      dungeon: "goblin-warrens",
      killedBy: "slinger",
    });
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
