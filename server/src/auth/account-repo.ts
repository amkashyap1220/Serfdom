import type pg from "pg";
import type { Settings } from "@serfdom/shared";

export interface AccountRecord {
  id: number;
  email: string;
  passwordHash: string;
}

/**
 * Storage for accounts and login sessions. `PgAccountRepo` is the real one;
 * `MemoryAccountRepo` behaves the same in memory so game-server tests run
 * without a database. Both are exercised by the same contract tests.
 */
export interface AccountRepo {
  /** "taken" if the (normalized) email already has an account. */
  createAccount(
    email: string,
    passwordHash: string,
  ): Promise<AccountRecord | "taken">;
  findByEmail(email: string): Promise<AccountRecord | null>;
  createSession(
    accountId: number,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<void>;
  /** The session's account, if the session exists and has not expired at `now`. */
  findSession(
    tokenHash: Buffer,
    now: Date,
  ): Promise<{ accountId: number; email: string } | null>;
  deleteSession(tokenHash: Buffer): Promise<void>;
  /** The account's stored settings as saved (D-159), or null for none. */
  loadSettings(accountId: number): Promise<unknown>;
  saveSettings(accountId: number, settings: Settings): Promise<void>;
}

/** Postgres's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";

export class PgAccountRepo implements AccountRepo {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async createAccount(
    email: string,
    passwordHash: string,
  ): Promise<AccountRecord | "taken"> {
    try {
      const r = await this.pool.query<{ id: string }>(
        "insert into accounts (email, password_hash) values ($1, $2) returning id",
        [email, passwordHash],
      );
      return { id: Number(r.rows[0]?.id), email, passwordHash };
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) return "taken";
      throw err;
    }
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    const r = await this.pool.query<{ id: string; password_hash: string }>(
      "select id, password_hash from accounts where email = $1",
      [email],
    );
    const row = r.rows[0];
    return row
      ? { id: Number(row.id), email, passwordHash: row.password_hash }
      : null;
  }

  async createSession(
    accountId: number,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      "insert into sessions (token_hash, account_id, expires_at) values ($1, $2, $3)",
      [tokenHash, accountId, expiresAt],
    );
  }

  async findSession(
    tokenHash: Buffer,
    now: Date,
  ): Promise<{ accountId: number; email: string } | null> {
    const r = await this.pool.query<{ account_id: string; email: string }>(
      `select s.account_id, a.email
         from sessions s join accounts a on a.id = s.account_id
        where s.token_hash = $1 and s.expires_at > $2`,
      [tokenHash, now],
    );
    const row = r.rows[0];
    return row ? { accountId: Number(row.account_id), email: row.email } : null;
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    await this.pool.query("delete from sessions where token_hash = $1", [
      tokenHash,
    ]);
  }

  async loadSettings(accountId: number): Promise<unknown> {
    const r = await this.pool.query<{ settings: unknown }>(
      "select settings from accounts where id = $1",
      [accountId],
    );
    return r.rows[0]?.settings ?? null;
  }

  async saveSettings(accountId: number, settings: Settings): Promise<void> {
    await this.pool.query("update accounts set settings = $2 where id = $1", [
      accountId,
      JSON.stringify(settings),
    ]);
  }
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/** In-memory twin of PgAccountRepo (tests and database-free development of the game server). */
export class MemoryAccountRepo implements AccountRepo {
  private readonly accounts: AccountRecord[] = [];
  private readonly sessions = new Map<
    string,
    { accountId: number; expiresAt: Date }
  >();

  async createAccount(
    email: string,
    passwordHash: string,
  ): Promise<AccountRecord | "taken"> {
    if (this.accounts.some((a) => a.email === email)) return "taken";
    const account = { id: this.accounts.length + 1, email, passwordHash };
    this.accounts.push(account);
    return account;
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    return this.accounts.find((a) => a.email === email) ?? null;
  }

  async createSession(
    accountId: number,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<void> {
    this.sessions.set(tokenHash.toString("hex"), { accountId, expiresAt });
  }

  async findSession(
    tokenHash: Buffer,
    now: Date,
  ): Promise<{ accountId: number; email: string } | null> {
    const s = this.sessions.get(tokenHash.toString("hex"));
    if (!s || s.expiresAt <= now) return null;
    const account = this.accounts.find((a) => a.id === s.accountId);
    return account ? { accountId: account.id, email: account.email } : null;
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    this.sessions.delete(tokenHash.toString("hex"));
  }

  private readonly settings = new Map<number, Settings>();

  async loadSettings(accountId: number): Promise<unknown> {
    const saved = this.settings.get(accountId);
    return saved ? structuredClone(saved) : null;
  }

  async saveSettings(accountId: number, settings: Settings): Promise<void> {
    this.settings.set(accountId, structuredClone(settings));
  }
}
