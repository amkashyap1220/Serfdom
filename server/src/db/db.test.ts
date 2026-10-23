import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MemoryAccountRepo,
  PgAccountRepo,
  type AccountRepo,
} from "../auth/account-repo.ts";
import { AccountService } from "../auth/account-service.ts";
import { newRunStats, type ServerMessage } from "@serfdom/shared";
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
      const board = await repo.leaderboard(3);
      expect(board[0]).toEqual({
        rank: 1,
        name: `${name}Top`,
        level: 20,
        exp: 1_000_000,
        alive: false,
      });
      expect(board.length).toBeLessThanOrEqual(3);
      expect(board.map((e) => e.rank)).toEqual(board.map((_, i) => i + 1));
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
