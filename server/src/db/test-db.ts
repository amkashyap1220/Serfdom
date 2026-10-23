import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "./migrate.ts";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * The test database from TEST_DATABASE_URL (in the repo-root .env), wiped
 * and rebuilt from the migrations. Never point this at a database you care
 * about: it drops everything in it.
 */
export async function freshTestDatabase(): Promise<pg.Pool> {
  if (!process.env.TEST_DATABASE_URL && existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set: add it to .env (see .env.example and docs/TESTING_AND_FEEDBACK.md)",
    );
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const name = (
    await pool.query<{ db: string }>("select current_database() db")
  ).rows[0]?.db;
  // Guard against wiping the development database by mistake.
  if (!name?.endsWith("_test")) {
    await pool.end();
    throw new Error(
      `refusing to wipe "${name}": the test database name must end in _test`,
    );
  }
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  await migrate(pool);
  return pool;
}
