/**
 * Deterministic PRNG + string hashing.
 *
 * Every player must see the identical maze and apple sequence for a given day,
 * so nothing here may touch Math.random or the clock. Same seed in, same numbers
 * out, on every machine and every Node version.
 */

/**
 * FNV-1a, 32-bit. Used to turn a day key + salt into a numeric seed.
 * `>>> 0` on every step keeps it in unsigned 32-bit space — `>>` would sign-flip
 * once the high bit is set and the two would silently diverge.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A seeded random source. Call `next()` for a float in [0, 1). */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
}

/**
 * mulberry32 — small, fast, and good enough for apple placement. Chosen over
 * xorshift because it survives weak (small-integer) seeds without a warm-up
 * period, and our seeds come straight from a hash.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
  };
}
