import { describe, expect, it } from "vitest";
import { MemoryAccountRepo } from "./account-repo.ts";
import { AccountService, BAD_LOGIN, EXPIRED } from "./account-service.ts";
import { LoginThrottle } from "./login-throttle.ts";
import { DEFAULT_COST, hashPassword, verifyPassword } from "./password.ts";

const FAST = { log2N: 4, r: 1, p: 1 };

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("hunter2hunter2", FAST);
    expect(stored).toMatch(/^scrypt\$4\$1\$1\$[^$]+\$[^$]+$/);
    expect(stored).not.toContain("hunter2");
    expect(await verifyPassword("hunter2hunter2", stored)).toBe(true);
    expect(await verifyPassword("hunter2hunter3", stored)).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    expect(await hashPassword("same password", FAST)).not.toBe(
      await hashPassword("same password", FAST),
    );
  });

  it("uses the full default cost in production", async () => {
    expect(DEFAULT_COST).toEqual({ log2N: 15, r: 8, p: 1 });
    const stored = await hashPassword("a real password");
    expect(stored.startsWith("scrypt$15$8$1$")).toBe(true);
    expect(await verifyPassword("a real password", stored)).toBe(true);
  });

  it("returns false, never throws, for malformed or absurd stored hashes", async () => {
    for (const bad of [
      "",
      "plaintext",
      "scrypt$4$1$1$abc",
      "scrypt$x$1$1$c2FsdA==$aGFzaA==",
      "scrypt$40$1$1$c2FsdA==$aGFzaA==",
      "bcrypt$4$1$1$c2FsdA==$aGFzaA==",
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("login throttle", () => {
  it("blocks an email after 5 failures within 10 minutes, then lets it try again", () => {
    const t = new LoginThrottle(5, 600_000);
    for (let i = 0; i < 4; i++) t.fail("a@b.c", i * 1000);
    expect(t.blockedFor("a@b.c", 5000)).toBe(0);
    t.fail("a@b.c", 5000);
    expect(t.blockedFor("a@b.c", 6000)).toBe(594_000);
    expect(t.blockedFor("other@b.c", 6000)).toBe(0);
    expect(t.blockedFor("a@b.c", 600_000)).toBe(0); // oldest failure aged out
  });

  it("forgets failures after a successful login", () => {
    const t = new LoginThrottle(2, 600_000);
    t.fail("a@b.c", 0);
    t.reset("a@b.c");
    t.fail("a@b.c", 1);
    expect(t.blockedFor("a@b.c", 2)).toBe(0);
  });
});

describe("AccountService", () => {
  function service(now = () => new Date("2026-10-22T12:00:00Z")) {
    const repo = new MemoryAccountRepo();
    return {
      repo,
      accounts: new AccountService(repo, { passwordCost: FAST, now }),
    };
  }

  it("registers, then logs in with the same email in any case and spacing", async () => {
    const { accounts } = service();
    const reg = await accounts.register("  Serf@Example.COM ", "long enough");
    expect(reg).toMatchObject({ ok: true, email: "serf@example.com" });
    const login = await accounts.login("SERF@example.com", "long enough");
    expect(login).toMatchObject({ ok: true, email: "serf@example.com" });
    if (reg.ok && login.ok) {
      expect(login.accountId).toBe(reg.accountId);
      expect(login.token).not.toBe(reg.token); // each login is its own session
      expect(reg.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("never stores the password, only a hash", async () => {
    const { accounts, repo } = service();
    await accounts.register("a@b.co", "my secret pw");
    const stored = await repo.findByEmail("a@b.co");
    expect(stored?.passwordHash).not.toContain("my secret pw");
  });

  it("rejects bad input and duplicate emails", async () => {
    const { accounts } = service();
    expect(
      await accounts.register("not-an-email", "long enough"),
    ).toMatchObject({ ok: false });
    expect(await accounts.register("a@b.co", "short")).toEqual({
      ok: false,
      reason: "Use at least 8 characters.",
    });
    await accounts.register("a@b.co", "long enough");
    expect(await accounts.register("A@B.CO", "another one")).toEqual({
      ok: false,
      reason: "An account with that email already exists.",
    });
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const { accounts } = service();
    await accounts.register("a@b.co", "long enough");
    expect(await accounts.login("nobody@b.co", "long enough")).toEqual({
      ok: false,
      reason: BAD_LOGIN,
    });
    expect(await accounts.login("a@b.co", "wrong password")).toEqual({
      ok: false,
      reason: BAD_LOGIN,
    });
  });

  it("throttles repeated wrong passwords, even the right one while blocked", async () => {
    const { accounts } = service();
    await accounts.register("a@b.co", "long enough");
    for (let i = 0; i < 5; i++)
      await accounts.login("a@b.co", "wrong password");
    const blocked = await accounts.login("a@b.co", "long enough");
    expect(blocked).toEqual({
      ok: false,
      reason: "Too many failed attempts. Try again in 10 minutes.",
    });
  });

  it("resumes with a token until it expires or is logged out", async () => {
    let now = new Date("2026-10-22T12:00:00Z");
    const { accounts } = service(() => now);
    const reg = await accounts.register("a@b.co", "long enough");
    if (!reg.ok) throw new Error("register failed");
    expect(await accounts.resume(reg.token)).toMatchObject({
      ok: true,
      accountId: reg.accountId,
    });
    expect(await accounts.resume("x".repeat(43))).toEqual({
      ok: false,
      reason: EXPIRED,
    });
    // 30 days later the login has expired.
    now = new Date("2026-11-21T12:00:01Z");
    expect(await accounts.resume(reg.token)).toEqual({
      ok: false,
      reason: EXPIRED,
    });
    now = new Date("2026-10-22T13:00:00Z");
    await accounts.logout(reg.token);
    expect(await accounts.resume(reg.token)).toEqual({
      ok: false,
      reason: EXPIRED,
    });
  });
});
