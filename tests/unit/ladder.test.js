import { describe, expect, it } from 'vitest';
import { assertValidLadder, nextPosition, startLevel } from '../../js/core/ladder.js';

const ladder = { levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } };

describe('ladder', () => {
  it('starts each difficulty at its level', () => {
    expect(startLevel(ladder, 'easy')).toBe(1);
    expect(startLevel(ladder, 'medium')).toBe(11);
    expect(startLevel(ladder, 'hard')).toBe(21);
  });

  it('moves up a level after puzzlesPerLevel puzzles', () => {
    expect(nextPosition(ladder, { level: 1, n: 0 })).toEqual({ level: 1, n: 1 });
    expect(nextPosition(ladder, { level: 1, n: 2 })).toEqual({ level: 2, n: 0 });
  });

  it('keeps giving puzzles at the top level (endless)', () => {
    expect(nextPosition(ladder, { level: 29, n: 2 })).toEqual({ level: 30, n: 0 });
    expect(nextPosition(ladder, { level: 30, n: 2 })).toEqual({ level: 30, n: 3 });
    expect(nextPosition(ladder, { level: 30, n: 99 })).toEqual({ level: 30, n: 100 });
  });

  it('rejects broken ladders', () => {
    expect(() => assertValidLadder(ladder)).not.toThrow();
    expect(() => assertValidLadder({ ...ladder, levels: 0 })).toThrow();
    expect(() => assertValidLadder({ ...ladder, puzzlesPerLevel: 1.5 })).toThrow();
    expect(() => assertValidLadder({ ...ladder, starts: { easy: 5, medium: 5, hard: 21 } })).toThrow();
    expect(() => assertValidLadder({ ...ladder, starts: { easy: 1, medium: 11, hard: 31 } })).toThrow();
  });
});
