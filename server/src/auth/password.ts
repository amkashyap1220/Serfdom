import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (built into Node; memory-hard, so guessing
 * is expensive even with GPUs). Stored as
 *   scrypt$<log2 N>$<r>$<p>$<salt base64>$<hash base64>
 * so the cost can be raised later without breaking existing hashes.
 *
 * Default cost N = 2^15, r = 8, p = 1 (OWASP's recommended minimum), about
 * 32 MB and tens of milliseconds per hash. Tests pass a lower cost.
 */
export interface ScryptCost {
  log2N: number;
  r: number;
  p: number;
}

export const DEFAULT_COST: ScryptCost = { log2N: 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function derive(
  password: string,
  salt: Buffer,
  cost: ScryptCost,
): Promise<Buffer> {
  const N = 2 ** cost.log2N;
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFC"),
      salt,
      KEY_BYTES,
      // Allow the memory this cost needs (128 · N · r bytes) plus headroom.
      { N, r: cost.r, p: cost.p, maxmem: 256 * N * cost.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_COST,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, cost);
  return [
    "scrypt",
    cost.log2N,
    cost.r,
    cost.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time comparison; false (never throws) for a malformed stored hash. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, log2N, r, p, saltB64, keyB64] = parts;
  const cost = { log2N: Number(log2N), r: Number(r), p: Number(p) };
  if (
    ![cost.log2N, cost.r, cost.p].every((n) => Number.isInteger(n) && n > 0) ||
    cost.log2N > 20
  ) {
    return false;
  }
  const expected = Buffer.from(keyB64 ?? "", "base64");
  if (expected.length !== KEY_BYTES) return false;
  const actual = await derive(
    password,
    Buffer.from(saltB64 ?? "", "base64"),
    cost,
  );
  return timingSafeEqual(actual, expected);
}
