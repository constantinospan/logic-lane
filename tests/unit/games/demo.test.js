import { describe, expect, it } from 'vitest';
import demo from '../../../games/demo/game.js';
import { createRng } from '../../../js/core/rng.js';

describe('demo game', () => {
  it('always includes the target among the choices (solvable)', () => {
    for (let level = 1; level <= demo.ladder.levels; level++) {
      for (let i = 0; i < 50; i++) {
        const p = demo.createPuzzle(level, createRng(`d${i}`, level));
        expect(p.choices).toContain(p.target);
      }
    }
  });

  it('has 2 choices at level 1, growing to 7 at level 30', () => {
    const count = (level) => demo.createPuzzle(level, createRng('count', level)).choices.length;
    expect(count(1)).toBe(2);
    expect(count(6)).toBe(3);
    expect(count(30)).toBe(7);
    for (let level = 1; level < 30; level++) expect(count(level + 1)).toBeGreaterThanOrEqual(count(level));
  });
});
