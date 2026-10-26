import pg from "pg";

/**
 * How long a request waits for a free database connection before it fails
 * (instead of waiting forever). A normal wait is a few milliseconds; five
 * seconds means something is stuck, and failing lets the server recover.
 */
export const POOL_WAIT_MS = 5000;

/** The game's connection pool. */
export function createPool(
  connectionString: string,
  /** Tests use a shorter wait. */
  waitMs = POOL_WAIT_MS,
  max?: number,
): pg.Pool {
  return new pg.Pool({
    connectionString,
    connectionTimeoutMillis: waitMs,
    max,
  });
}

/**
 * Whether an error is the pool giving up waiting for a connection. Nothing
 * reached the database, so the step is safe to try again.
 */
export function isPoolTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    /timeout exceeded when trying to connect/i.test(err.message)
  );
}
