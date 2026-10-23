/**
 * A small seeded random generator (mulberry32): the same seed gives the
 * same sequence on every machine, which is what lets the server and every
 * client build an identical dungeon from one number (T-050). Integer math
 * only (Math.imul, unsigned shifts), so results never differ by engine.
 * Not for anything secret.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from `min` to `max`, both included. */
export function randomInt(
  random: () => number,
  min: number,
  max: number,
): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One element of a non-empty list. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError("pick from an empty list");
  return items[Math.floor(random() * items.length)]!;
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(random: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Largest dungeon seed: seeds are unsigned 32-bit whole numbers. */
export const MAX_SEED = 0xffffffff;
