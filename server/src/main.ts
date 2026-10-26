import { randomInt } from "node:crypto";
import { MAX_SEED, SERF_SLOTS } from "@serfdom/shared";
import pg from "pg";

/** A random() in [0, 1) from the OS's secure generator (stat and item rolls). */
const cryptoRandom = () => randomInt(2 ** 47) / 2 ** 47;
import { PgAccountRepo } from "./auth/account-repo.ts";
import { AccountService } from "./auth/account-service.ts";
import { migrate } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";
import { PgSerfRepo } from "./serfs/serf-repo.ts";
import { SerfService } from "./serfs/serf-service.ts";
import { GameServer } from "./game-server.ts";
import { consoleLogger } from "./log.ts";

const DEFAULT_PORT = 8080;

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1–65535, got "${raw}"`);
  }
  return port;
}

/**
 * DUNGEON_SEED (development only): every run uses this layout seed, to
 * replay a reported layout (0 = the handcrafted Warrens). Unset: random.
 */
function readDungeonSeed(): (() => number) | undefined {
  const raw = process.env.DUNGEON_SEED;
  if (raw === undefined || raw === "") return undefined;
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new Error(
      `DUNGEON_SEED must be a whole number 0–${MAX_SEED}, got "${raw}"`,
    );
  }
  consoleLogger.info(`DUNGEON_SEED set: every run uses seed ${seed}`);
  return () => seed;
}

/** The database is required since Phase 7 (D-059); see .env.example. */
function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set: add it to .env in the repo root (see .env.example and docs/TESTING_AND_FEEDBACK.md)",
    );
  }
  return url;
}

let pool: pg.Pool | undefined;
try {
  const port = readPort();
  // Waits at most 5 s for a connection, so a stuck pool recovers (pool.ts).
  pool = createPool(readDatabaseUrl());
  const applied = await migrate(pool);
  consoleLogger.info(
    applied.length > 0
      ? `database migrated: ${applied.join(", ")}`
      : "database up to date",
  );
  const accounts = new AccountService(new PgAccountRepo(pool));
  const serfs = new SerfService(new PgSerfRepo(pool), SERF_SLOTS, cryptoRandom);
  const server = await GameServer.start({
    port,
    accounts,
    serfs,
    dungeonSeed: readDungeonSeed(),
  });
  consoleLogger.info(
    `Serfdom server listening on ws://localhost:${server.port}`,
  );

  const shutdown = (): void => {
    consoleLogger.info("shutting down");
    server
      .close()
      .then(() => pool?.end())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          consoleLogger.warn(`error during shutdown: ${String(err)}`);
          process.exit(1);
        },
      );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  const message =
    err instanceof Error && "code" in err && err.code === "EADDRINUSE"
      ? `port already in use; stop the other server or set PORT`
      : String(err);
  // pg error messages never contain the password from DATABASE_URL.
  consoleLogger.warn(`server failed to start: ${message}`);
  await pool?.end().catch(() => {});
  process.exit(1);
}
