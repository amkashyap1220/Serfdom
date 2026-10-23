import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MemoryAccountRepo,
  PgAccountRepo,
  type AccountRepo,
} from "../auth/account-repo.ts";
import { AccountService } from "../auth/account-service.ts";
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

  it("created the account tables", async () => {
    const tables = (
      await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      )
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual(["accounts", "schema_migrations", "sessions"]);
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
