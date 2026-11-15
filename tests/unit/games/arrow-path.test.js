// Arrow Path: every puzzle at every level is solvable and inside its level's rules (D12, D14, D20).
import { describe, expect, it } from 'vitest';
import arrowPath from '../../../games/arrow-path/game.js';
import { expand, key, repeatWorks, runProgram, walkArrows } from '../../../games/arrow-path/engine.js';
import { FALLBACK, TRIES, generate } from '../../../games/arrow-path/generate.js';
import { LEVELS, MAX_SLOTS, isFirstOfKind, rulesFor } from '../../../games/arrow-path/levels.js';
import { minTurns, shortestMoves } from '../../../games/arrow-path/solve.js';
import { restoreArrows, restoreProgram } from '../../../games/arrow-path/view.js';
import { createRng } from '../../../js/core/rng.js';

/** @typedef {import('../../../games/arrow-path/engine.js').Puzzle} Puzzle */
/** @typedef {import('../../../games/arrow-path/engine.js').Token} Token */
/** @typedef {import('../../../games/arrow-path/engine.js').Dir} Dir */

const SEEDS = 200;

/** @param {Partial<Puzzle>} extra @returns {Puzzle} */
const grid = (extra) => ({
  mode: 'moves', cols: 4, rows: 4, start: [0, 0], facing: 'R', gem: [0, 3], rocks: [], solution: [], ...extra,
});

describe('arrow-path ladder', () => {
  it('has 30 levels in three modes, as decided (D22)', () => {
    expect(LEVELS).toHaveLength(30);
    expect(arrowPath.ladder).toEqual({ levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } });
    LEVELS.forEach((rules, i) => {
      const level = i + 1;
      expect(rules.mode).toBe(level <= 10 ? 'board' : level <= 20 ? 'moves' : 'debug');
      expect(rules.cols).toBeLessThanOrEqual(5); // board squares stay ≥ 64 px on a phone
      expect(rules.rows).toBeLessThanOrEqual(6);
      if (level >= 11 && level <= 13) expect(rules.loopRuns).toBe(0);
      if (level >= 14 && level <= 20) expect(rules.loopRuns).toBeGreaterThan(0); // loops from 14
      if (level >= 24) expect(rules.loopRuns).toBeGreaterThanOrEqual(1); // debug lists use 🔁 from 24
      if (rules.mode === 'debug') expect(rules.bugs).toBe(level <= 25 ? 1 : 2);
    });
  });

  it('never gets easier as she climbs (grid, turns, bugs)', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const [a, b] = [LEVELS[i - 1], LEVELS[i]];
      if (a.mode !== b.mode) continue;
      expect(b.cols * b.rows).toBeGreaterThanOrEqual(a.cols * a.rows);
      expect(b.turns ?? 0).toBeGreaterThanOrEqual(a.turns ?? 0);
      expect(b.bugs ?? 0).toBeGreaterThanOrEqual(a.bugs ?? 0);
    }
  });

  it('keeps level 30 rules above the top (endless) and clamps odd input', () => {
    expect(rulesFor(31)).toBe(LEVELS[29]);
    expect(rulesFor(500)).toBe(LEVELS[29]);
    expect(rulesFor(0)).toBe(LEVELS[0]);
  });

  it('explains how to play on the first level of each kind', () => {
    const firsts = LEVELS.map((_, i) => i + 1).filter(isFirstOfKind);
    expect(firsts).toEqual([1, 11, 14, 21, 24]);
    expect(isFirstOfKind(31)).toBe(false);
    expect(arrowPath.instruction(1)).toBe('Tap squares for arrows. Then press Go.');
    expect(arrowPath.instruction(2)).toBe('Help the robot get the gem.');
    expect(arrowPath.instruction(11)).toBe('Tap arrows. Then press Go.');
    expect(arrowPath.instruction(14)).toBe('Repeat makes a move again.');
    expect(arrowPath.instruction(21)).toBe('Fix the moves. Then press Go.');
    expect(arrowPath.instruction(22)).toBe('Fix the moves. Find the gem.');
    expect(arrowPath.instruction(40)).toBe('Fix the moves. Find the gem.');
  });

  it('uses short instructions (about 6 words)', () => {
    for (let level = 1; level <= 31; level++) {
      expect(arrowPath.instruction(level).split(/\s+/).length).toBeLessThanOrEqual(7);
    }
  });
});

describe('arrow-path engine', () => {
  it('board: walks straight, turns on arrows, reaches the gem', () => {
    const p = grid({ mode: 'board', gem: [2, 2] });
    expect(walkArrows(p, {}).result).toBe('edge');
    const walk = walkArrows(p, { [key(0, 2)]: 'D' });
    expect(walk.result).toBe('treasure');
    expect(walk.path.map(({ r, c }) => [r, c])).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);
    expect(walk.path[2].d).toBe('D'); // turned on the arrow
  });

  it('board: stops at rocks and edges, and spots going round in circles', () => {
    const p = grid({ mode: 'board', gem: [3, 3], rocks: [[0, 2]] });
    expect(walkArrows(p, {}).result).toBe('rock');
    const loop = { [key(0, 1)]: 'D', [key(1, 1)]: 'R', [key(1, 2)]: 'U' };
    expect(walkArrows(grid({ mode: 'board', gem: [3, 3] }), { ...loop, [key(0, 2)]: 'L' }).result).toBe('loop');
    expect(walkArrows(p, { [key(0, 1)]: 'U' }).result).toBe('edge');
  });

  it('board: ignores an arrow on the start square', () => {
    const p = grid({ mode: 'board', gem: [0, 3] });
    expect(walkArrows(p, { [key(0, 0)]: 'D' }).result).toBe('treasure');
  });

  it('moves: 🔁 repeats the arrow just before it; anywhere else it does nothing', () => {
    expect(expand(['R', 'x3']).map((m) => m.d)).toEqual(['R', 'R', 'R']);
    expect(expand(['R', 'x2', 'D']).map((m) => m.d)).toEqual(['R', 'R', 'D']);
    expect(expand(['x2', 'R']).map((m) => m.d)).toEqual(['R']);
    expect(expand(['R', 'x2', 'x3']).map((m) => m.d)).toEqual(['R', 'R']);
    expect(expand(['R', 'x3']).map((m) => m.i)).toEqual([0, 1, 1]);
    expect(repeatWorks(['R', 'x2'], 1)).toBe(true);
    expect(repeatWorks(['x2'], 0)).toBe(false);
    expect(repeatWorks(['R', 'x2', 'x2'], 2)).toBe(false);
  });

  it('moves: reports where it went wrong', () => {
    const p = grid({ rocks: [[1, 0]] });
    expect(runProgram(p, ['R', 'x3'])).toMatchObject({ result: 'treasure', failAt: -1 });
    expect(runProgram(p, ['D'])).toMatchObject({ result: 'rock', failAt: 0 });
    expect(runProgram(p, ['R', 'U'])).toMatchObject({ result: 'edge', failAt: 1 });
    expect(runProgram(p, ['R', 'R'])).toMatchObject({ result: 'end', failAt: 1 });
    expect(runProgram(p, [])).toMatchObject({ result: 'end', failAt: -1 });
    expect(runProgram(p, ['R', 'x3', 'D'])).toMatchObject({ result: 'treasure' }); // stops at the gem
    expect(runProgram(grid({ gem: [3, 3] }), ['R', 'R', 'x3']).result).toBe('edge'); // 4 steps right, 4-wide grid
  });
});

describe('arrow-path solvers', () => {
  it('counts the fewest arrows', () => {
    expect(minTurns(grid({ mode: 'board' }))?.turns).toBe(0);
    expect(minTurns(grid({ mode: 'board', gem: [2, 2] }))?.turns).toBe(1);
    expect(minTurns(grid({ mode: 'board', gem: [2, 2], rocks: [[0, 1]] }))).toBeNull(); // can't turn at the start
    expect(minTurns(grid({ mode: 'board', gem: [3, 3], rocks: [[0, 3], [1, 3], [2, 3]] }))?.turns).toBe(2);
  });

  it('agrees with trying every way to place arrows, on small boards', () => {
    // Exhaustive check of the lower-bound argument in solve.js: for small boards, try every arrow placement.
    /** @type {(Dir | null)[]} */
    const choices = [null, 'R', 'D', 'L', 'U'];
    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const rng = createRng(`tiny${seed}`, 1);
      /** @type {Puzzle} */
      const p = {
        mode: 'board', cols: 3, rows: 3, start: [rng.int(0, 2), rng.int(0, 2)], facing: rng.pick(['R', 'D', 'L', 'U']),
        gem: [rng.int(0, 2), rng.int(0, 2)], rocks: [], solution: {},
      };
      if (key(...p.start) === key(...p.gem)) continue;
      const rockAt = /** @type {[number, number]} */ ([rng.int(0, 2), rng.int(0, 2)]);
      if (key(...rockAt) !== key(...p.start) && key(...rockAt) !== key(...p.gem)) p.rocks.push(rockAt);
      const free = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const k = key(r, c);
        if (k !== key(...p.start) && k !== key(...p.gem) && !p.rocks.some((x) => key(...x) === k)) free.push(k);
      }
      let best = Infinity;
      const total = choices.length ** free.length;
      for (let n = 0; n < total; n++) {
        /** @type {Record<string, Dir>} */
        const arrows = {};
        let count = 0;
        for (let i = 0, m = n; i < free.length; i++, m = Math.floor(m / choices.length)) {
          const d = choices[m % choices.length];
          if (d) {
            arrows[free[i]] = d;
            count++;
          }
        }
        if (count < best && walkArrows(p, arrows).result === 'treasure') best = count;
      }
      expect(minTurns(p)?.turns ?? Infinity).toBe(best);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('finds the shortest list of moves', () => {
    expect(shortestMoves(grid({}))).toEqual(['R', 'R', 'R']);
    expect(shortestMoves(grid({ rocks: [[0, 1], [1, 1], [2, 1], [3, 1]] }))).toBeNull();
    expect(shortestMoves(grid({ rocks: [[0, 1]] }))?.length).toBe(5);
  });
});

describe('arrow-path puzzles at every level', () => {
  /** @type {Map<number, number>} */
  const worst = new Map();

  for (let level = 1; level <= 35; level++) {
    it(`level ${level}: solvable and inside the level's rules`, () => {
      const rules = rulesFor(level);
      let most = 0;
      for (let i = 0; i < SEEDS; i++) {
        const { puzzle: p, attempts, fallback } = generate(level, createRng(`ap${i}`, level));
        expect(fallback).toBe(false);
        most = Math.max(most, attempts);
        expect(p.mode).toBe(rules.mode);
        expect([p.cols, p.rows]).toEqual([rules.cols, rules.rows]);
        // Everything is on the grid, nothing overlaps.
        const all = [p.start, p.gem, ...p.rocks].map((cell) => key(...cell));
        expect(new Set(all).size).toBe(all.length);
        for (const [r, c] of [p.start, p.gem, ...p.rocks]) {
          expect(r >= 0 && r < p.rows && c >= 0 && c < p.cols).toBe(true);
        }
        if (rules.mode === 'board') {
          const arrows = /** @type {Record<string, Dir>} */ (p.solution);
          expect(walkArrows(p, arrows).result).toBe('treasure');
          expect(Object.keys(arrows)).toHaveLength(/** @type {number} */ (rules.turns));
          expect(minTurns(p)?.turns).toBe(rules.turns); // exactly this many arrows are needed
          const loose = rules.rocks[1] + /** @type {number} */ (rules.blockers);
          expect(p.rocks.length).toBeGreaterThanOrEqual(rules.rocks[0]);
          expect(p.rocks.length).toBeLessThanOrEqual(loose);
          expect(p.slots).toBeUndefined();
        } else {
          const solution = /** @type {Token[]} */ (p.solution);
          const slots = /** @type {number} */ (p.slots);
          expect(runProgram(p, solution).result).toBe('treasure');
          expect(slots).toBeLessThanOrEqual(MAX_SLOTS);
          expect(solution.length).toBeLessThanOrEqual(slots);
          expect(p.rocks.length).toBeGreaterThanOrEqual(rules.rocks[0]);
          expect(p.rocks.length).toBeLessThanOrEqual(rules.rocks[1]);
          const shortest = /** @type {Dir[]} */ (shortestMoves(p));
          expect(p.loops).toBe((rules.loopRuns ?? 0) > 0);
          if (!p.loops) expect(solution.every((t) => t !== 'x2' && t !== 'x3')).toBe(true);
          if (rules.mode === 'moves' && !p.loops) {
            const [min, max] = /** @type {[number, number]} */ (rules.steps);
            expect(shortest.length).toBeGreaterThanOrEqual(min);
            expect(shortest.length).toBeLessThanOrEqual(max);
            expect(slots).toBe(shortest.length + 2);
          }
          if (rules.mode === 'moves' && p.loops) {
            expect(shortest.length).toBeGreaterThan(slots); // writing every step doesn't fit: 🔁 is needed
            expect(solution.filter((t) => t === 'x2' || t === 'x3').length).toBeGreaterThanOrEqual(
              /** @type {number} */ (rules.loopRuns),
            );
          }
          if (rules.mode === 'debug') {
            const start = /** @type {Token[]} */ (p.program);
            expect(runProgram(p, start).result).not.toBe('treasure'); // it starts broken
            expect(start).toHaveLength(solution.length);
            expect(slots).toBe(solution.length + 1);
            const changed = start.filter((t, j) => t !== solution[j]);
            expect(changed).toHaveLength(/** @type {number} */ (rules.bugs)); // only arrows the wrong way
            expect(changed.every((t) => t !== 'x2' && t !== 'x3')).toBe(true);
            if (!p.loops) {
              const [min, max] = /** @type {[number, number]} */ (rules.steps);
              expect(solution.length).toBeGreaterThanOrEqual(min);
              expect(solution.length).toBeLessThanOrEqual(max);
            } else {
              expect(solution.some((t) => t === 'x2' || t === 'x3')).toBe(true);
            }
          }
        }
      }
      worst.set(level, most);
      expect(most).toBeLessThan(TRIES / 2); // far from falling back
    });
  }

  it('gives the same puzzle for the same seed and level, at every kind of level (D12)', () => {
    // A bug report with a seed must recreate that exact puzzle. Board, moves, 🔁, fix-the-list (with and without 🔁,
    // 1 and 2 wrong arrows) and endless levels; through the game's own createPuzzle too.
    for (const level of [1, 4, 10, 11, 14, 18, 21, 24, 26, 29, 30, 35]) {
      for (const seed of ['abc123', 'e2etst', 'visual']) {
        const first = generate(level, createRng(seed, level));
        const again = generate(level, createRng(seed, level));
        expect(again).toEqual(first);
        expect(arrowPath.createPuzzle(level, createRng(seed, level))).toEqual(first.puzzle);
      }
    }
  });

  it('gives different puzzles for different seeds', () => {
    for (const level of [1, 11, 14, 21, 30]) {
      const layouts = new Set();
      for (let i = 0; i < 10; i++) layouts.add(JSON.stringify(generate(level, createRng(`v${i}`, level)).puzzle));
      expect(layouts.size).toBeGreaterThanOrEqual(8);
    }
  });

  it('has fallback puzzles that work (used only if every attempt failed)', () => {
    expect(walkArrows(FALLBACK.board, /** @type {Record<string, Dir>} */ (FALLBACK.board.solution)).result)
      .toBe('treasure');
    expect(minTurns(FALLBACK.board)?.turns).toBe(1);
    expect(runProgram(FALLBACK.moves, /** @type {Token[]} */ (FALLBACK.moves.solution)).result).toBe('treasure');
    expect(runProgram(FALLBACK.debug, /** @type {Token[]} */ (FALLBACK.debug.solution)).result).toBe('treasure');
    expect(runProgram(FALLBACK.debug, /** @type {Token[]} */ (FALLBACK.debug.program)).result).not.toBe('treasure');
  });

  it('falls back instead of failing when no attempt works', () => {
    // An rng that always says "0" can't build most routes; the game must still get a valid puzzle.
    /** @type {import('../../../js/core/rng.js').Rng} */
    const stuck = { next: () => 0, int: (min) => min, pick: (items) => items[0], shuffle: (items) => items.slice() };
    for (const level of [9, 18, 30]) {
      const { puzzle, fallback } = generate(level, stuck);
      expect(fallback).toBe(true);
      expect(puzzle).toEqual(FALLBACK[rulesFor(level).mode]);
      expect(puzzle).not.toBe(FALLBACK[rulesFor(level).mode]); // a copy, so a game can't change the original
    }
  });
});

describe('arrow-path resume (saved progress, D7)', () => {
  const board = grid({ mode: 'board', gem: [2, 2], rocks: [[1, 1]] });
  const list = grid({ slots: 3, loops: false });

  it('brings back saved arrows, dropping any that no longer make sense', () => {
    expect(restoreArrows(board, { arrows: { '0,2': 'D' } })).toEqual({ '0,2': 'D' });
    const odd = { '0,0': 'D', '2,2': 'L', '1,1': 'U', '9,9': 'R', '0,1': 'X', 'a,b': 'R', '1,2': 'L' };
    expect(restoreArrows(board, { arrows: odd })).toEqual({ '1,2': 'L' });
    for (const junk of [null, undefined, 5, 'x', { arrows: 3 }, { arrows: null }, { program: ['R'] }]) {
      expect(restoreArrows(board, junk)).toEqual({});
    }
  });

  it('brings back a saved move list, or starts fresh if it does not fit this puzzle', () => {
    expect(restoreProgram(list, { program: ['R', 'D'] })).toEqual(['R', 'D']);
    expect(restoreProgram(list, { program: ['R', 'R', 'R', 'R'] })).toEqual([]); // too long
    expect(restoreProgram(list, { program: ['R', 'x2'] })).toEqual([]); // no 🔁 at this level
    expect(restoreProgram({ ...list, loops: true }, { program: ['R', 'x2'] })).toEqual(['R', 'x2']);
    expect(restoreProgram(list, { program: ['R', 'Q'] })).toEqual([]);
    for (const junk of [null, 7, { program: 'RD' }, { arrows: {} }]) expect(restoreProgram(list, junk)).toEqual([]);
  });

  it('starts a debug puzzle from its almost-right list, and never changes the puzzle', () => {
    const debug = grid({ mode: 'debug', slots: 4, program: ['R', 'D'] });
    const fresh = restoreProgram(debug, null);
    expect(fresh).toEqual(['R', 'D']);
    fresh.push('L');
    expect(debug.program).toEqual(['R', 'D']);
  });
});
