// rng.js — the single seeded random source for the whole library.
// Every module that needs chance takes an rng made here; nothing calls Math.random().

/** FNV-1a string hash → 32-bit unsigned int. Used to derive seeds from labels. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Normalise any seed-ish value (number | numeric string | word) to a uint32. */
export function normaliseSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (seed >>> 0);
  if (typeof seed === 'string' && /^\d+$/.test(seed)) return (Number(seed) >>> 0);
  if (typeof seed === 'string' && seed.length) return hashString(seed);
  return 0;
}

/** A fresh seed from the clock — the only place time enters the system. */
export function freshSeed() {
  return (Date.now() ^ (performance.now() * 1000)) >>> 0 || 1;
}

/**
 * makeRng(seed) → { seed, next, int, pick, chance, range, shuffle, fork }
 * mulberry32: small, fast, good enough for a loom.
 */
export function makeRng(seed) {
  let a = normaliseSeed(seed) || 1;
  const rng = {
    seed: a,
    next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** integer in [lo, hi] inclusive */
    int(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); },
    /** float in [lo, hi) */
    range(lo, hi) { return lo + rng.next() * (hi - lo); },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    chance(p) { return rng.next() < p; },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** A child rng whose stream depends on this seed and a label — stable across calls. */
    fork(label) { return makeRng((rng.seed ^ hashString(String(label))) >>> 0 || 7); },
  };
  return rng;
}
