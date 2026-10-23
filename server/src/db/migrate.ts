import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/** server/migrations/, next to src/. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

/** Arbitrary constant: only one process migrates at a time. */
const MIGRATION_LOCK_ID = 7_041_977;

/** Migration files: three digits, underscore, lowercase name, .sql. */
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

/**
 * Applies every migration file not yet recorded in `schema_migrations`, in
 * file-name order, each inside its own transaction (all of it or none).
 * Returns the names applied. A database-wide advisory lock keeps two server
 * processes starting together from migrating at once.
 *
 * Rule: never edit a migration that has been committed; add a new one.
 */
export async function migrate(
  pool: pg.Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const done = new Set(
      (
        await client.query<{ name: string }>(
          "select name from schema_migrations",
        )
      ).rows.map((r) => r.name),
    );
    const files = (await readdir(dir))
      .filter((f) => FILE_PATTERN.test(f))
      .sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [
          file,
        ]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${file} failed: ${String(err)}`, {
          cause: err,
        });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => {});
    client.release();
  }
}
