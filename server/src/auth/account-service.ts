import { createHash, randomBytes } from "node:crypto";
import {
  emailProblem,
  normalizeEmail,
  passwordProblem,
  settingsOrDefaults,
  type Settings,
} from "@serfdom/shared";
import type { AccountRepo } from "./account-repo.ts";
import { LoginThrottle } from "./login-throttle.ts";
import {
  DEFAULT_COST,
  hashPassword,
  verifyPassword,
  type ScryptCost,
} from "./password.ts";

export type AuthResult =
  | { ok: true; accountId: number; email: string; token: string }
  | { ok: false; reason: string };

export interface AccountServiceOptions {
  /** Lower only in tests. */
  passwordCost?: ScryptCost;
  sessionDays?: number;
  now?: () => Date;
  throttle?: LoginThrottle;
}

/** Shown for every wrong-email or wrong-password login, so neither is revealed. */
export const BAD_LOGIN = "Email or password is incorrect.";
export const EXPIRED = "Your login has expired. Please log in again.";

/** PROVISIONAL (7a): a login lasts this long unless the player logs out. */
const DEFAULT_SESSION_DAYS = 30;
const TOKEN_BYTES = 32;

/**
 * Account rules (Phase 7a, D-058, D-060): register and log in with email
 * and password; a login is a random token the client keeps, of which the
 * server stores only a SHA-256 hash. Inputs are untrusted and validated
 * here even though the client checks them too.
 */
export class AccountService {
  private readonly repo: AccountRepo;
  private readonly cost: ScryptCost;
  private readonly sessionMs: number;
  private readonly now: () => Date;
  private readonly throttle: LoginThrottle;
  /** Hash of a random password, compared against when the email is unknown so timing does not reveal it. */
  private readonly dummyHash: Promise<string>;

  constructor(repo: AccountRepo, options: AccountServiceOptions = {}) {
    this.repo = repo;
    this.cost = options.passwordCost ?? DEFAULT_COST;
    this.sessionMs =
      (options.sessionDays ?? DEFAULT_SESSION_DAYS) * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.throttle = options.throttle ?? new LoginThrottle();
    this.dummyHash = hashPassword(randomBytes(16).toString("hex"), this.cost);
  }

  async register(rawEmail: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(rawEmail);
    const problem = emailProblem(email) ?? passwordProblem(password);
    if (problem) return { ok: false, reason: problem };
    const created = await this.repo.createAccount(
      email,
      await hashPassword(password, this.cost),
    );
    if (created === "taken") {
      return {
        ok: false,
        reason: "An account with that email already exists.",
      };
    }
    return this.startSession(created.id, email);
  }

  async login(rawEmail: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(rawEmail);
    const waitMs = this.throttle.blockedFor(email, this.now().getTime());
    if (waitMs > 0) {
      const minutes = Math.ceil(waitMs / 60_000);
      return {
        ok: false,
        reason: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }
    const account = await this.repo.findByEmail(email);
    const matches = await verifyPassword(
      password,
      account?.passwordHash ?? (await this.dummyHash),
    );
    if (!account || !matches) {
      this.throttle.fail(email, this.now().getTime());
      return { ok: false, reason: BAD_LOGIN };
    }
    this.throttle.reset(email);
    return this.startSession(account.id, email);
  }

  async resume(token: string): Promise<AuthResult> {
    const found = await this.repo.findSession(hashToken(token), this.now());
    if (!found) return { ok: false, reason: EXPIRED };
    return { ok: true, accountId: found.accountId, email: found.email, token };
  }

  async logout(token: string): Promise<void> {
    await this.repo.deleteSession(hashToken(token));
  }

  private async startSession(
    accountId: number,
    email: string,
  ): Promise<AuthResult> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    await this.repo.createSession(
      accountId,
      hashToken(token),
      new Date(this.now().getTime() + this.sessionMs),
    );
    return { ok: true, accountId, email, token };
  }

  /** The account's settings (D-159), its defaults filling anything missing. */
  async settings(accountId: number): Promise<Settings> {
    return settingsOrDefaults(await this.repo.loadSettings(accountId));
  }

  /** Stores settings the protocol has already checked strictly. */
  async saveSettings(accountId: number, settings: Settings): Promise<void> {
    await this.repo.saveSettings(accountId, settings);
  }
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
