import { describe, expect, it } from 'vitest';
import { createRng, newSeed } from '../../js/core/rng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng.next());

describe('rng', () => {
  it('gives the same numbers for the same seed and level', () => {
    expect(take(createRng('abc123', 4), 20)).toEqual(take(createRng('abc123', 4), 20));
  });

  it('gives different numbers for a different seed or level', () => {
    const base = take(createRng('abc123', 4), 20);
    expect(take(createRng('abc124', 4), 20)).not.toEqual(base);
    expect(take(createRng('abc123', 5), 20)).not.toEqual(base);
  });

  it('keeps int() within bounds, both ends included', () => {
    const rng = createRng('bounds', 1);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('shuffle returns a reordered copy and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRng('shuffle', 1).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
  });

  it('makes short, hand-copyable seeds', () => {
    for (let i = 0; i < 100; i++) expect(newSeed()).toMatch(/^[0-9a-z]{6}$/);
  });
});
