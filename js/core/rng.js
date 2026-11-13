// Seeded random numbers. The same seed and level always give the same sequence (D12).

/**
 * @typedef {object} Rng
 * @property {() => number} next  Float in [0, 1).
 * @property {(min: number, max: number) => number} int  Integer in [min, max], both inclusive.
 * @property {<T>(items: readonly T[]) => T} pick  One random item.
 * @property {<T>(items: readonly T[]) => T[]} shuffle  A shuffled copy.
 */

const SEED_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const SEED_LENGTH = 6;

/**
 * A short, human-copyable seed, e.g. "k3x9q2".
 * @returns {string}
 */
export function newSeed() {
  const bytes = new Uint8Array(SEED_LENGTH);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < SEED_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => SEED_CHARS[b % SEED_CHARS.length]).join('');
}

/**
 * FNV-1a: turns a string into a 32-bit number.
 * @param {string} text
 * @returns {number}
 */
function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32: small, fast, good enough for puzzles.
 * @param {number} state
 * @returns {() => number}
 */
function mulberry32(state) {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The random generator for one puzzle.
 * @param {string} seed
 * @param {number} level
 * @returns {Rng}
 */
export function createRng(seed, level) {
  const next = mulberry32(hashString(`${seed}:${level}`));
  /** @type {Rng['int']} */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle: (items) => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}
