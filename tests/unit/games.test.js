// Contract tests that run for EVERY registered game. Each game also gets its own tests/unit/games/<id>.test.js
// proving its puzzles are solvable and within each level's difficulty rules.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMING_SOON, GAMES } from '../../js/core/games.js';
import { assertValidLadder } from '../../js/core/ladder.js';
import { createRng, newSeed } from '../../js/core/rng.js';

const SEEDS_PER_LEVEL = 20;

describe('game registry', () => {
  it('has unique ids that do not clash with coming-soon tiles', () => {
    const ids = [...GAMES.map((g) => g.id), ...COMING_SOON.map((g) => g.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(GAMES.map((g) => [g.id, g]))('game %s', (_id, game) => {
  afterEach(() => vi.restoreAllMocks());

  it('has the required fields', () => {
    expect(game.id).toMatch(/^[a-z0-9-]+$/);
    expect(game.title.length).toBeGreaterThan(0);
    expect(game.icon.length).toBeGreaterThan(0);
    expect(Number.isInteger(game.version)).toBe(true);
  });

  it('has a valid ladder', () => {
    expect(() => assertValidLadder(game.ladder)).not.toThrow();
  });

  it('has a short instruction at every level', () => {
    for (let level = 1; level <= game.ladder.levels; level++) {
      const text = game.instruction(level);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('builds the same puzzle from the same seed and level, without Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('createPuzzle must use the rng it is given, not Math.random (D12)');
    });
    for (let level = 1; level <= game.ladder.levels; level++) {
      for (let i = 0; i < SEEDS_PER_LEVEL; i++) {
        const seed = `s${level}x${i}`;
        const a = game.createPuzzle(level, createRng(seed, level));
        const b = game.createPuzzle(level, createRng(seed, level));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it('accepts random seeds at the top level (endless play)', () => {
    for (let i = 0; i < SEEDS_PER_LEVEL; i++) {
      expect(() => game.createPuzzle(game.ladder.levels, createRng(newSeed(), game.ladder.levels))).not.toThrow();
    }
  });
});
