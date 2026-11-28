// Pattern train: every puzzle at every level has exactly one right choice and stays inside its level's rules
// (D12, D14, D20, D28). The checks here read the finished puzzle on their own; they don't trust the generator.
import { describe, expect, it } from 'vitest';
import patternTrain from '../../../games/pattern-train/game.js';
import { FALLBACK, TRIES, generate } from '../../../games/pattern-train/generate.js';
import { LEVELS, MAX_LENGTH, letters, period, rulesFor } from '../../../games/pattern-train/levels.js';
import { ATTRS, FLAT, SOLIDS, TURNABLE, describe as words, isCar, sameCar }
  from '../../../games/pattern-train/model.js';
import { predict, solve } from '../../../games/pattern-train/solve.js';
import { hintFor, restoreWrong } from '../../../games/pattern-train/view.js';
import { createRng } from '../../../js/core/rng.js';

/** @typedef {import('../../../games/pattern-train/model.js').Car} Car */
/** @typedef {import('../../../games/pattern-train/model.js').Attr} Attr */
/** @typedef {import('../../../games/pattern-train/model.js').Puzzle} Puzzle */

const SEEDS = 200;

/** @param {Partial<Car>} [extra] @returns {Car} */
const car = (extra) => ({ shape: 'circle', colour: 'orange', size: 'big', turn: 0, ...extra });

/** The whole train with the right choice in the empty carriage. @param {Puzzle} p @returns {Car[]} */
const filled = (p) => p.cars.map((c) => c ?? p.choices[p.answer]);

/** The shortest repeat of a row of values (1 = never changes). @param {unknown[]} row */
function shortestRepeat(row) {
  for (let p = 1; p < row.length; p++) if (row.every((v, i) => i < p || v === row[i - p])) return p;
  return row.length;
}

/**
 * The first `n` values as letters in order of first appearance, e.g. red red blue → "AAB".
 * @param {unknown[]} row
 * @param {number} n
 * @returns {any}
 */
function lettersOf(row, n) {
  /** @type {unknown[]} */
  const seen = [];
  return row.slice(0, n).map((v) => {
    if (!seen.includes(v)) seen.push(v);
    return 'ABC'[seen.indexOf(v)];
  }).join('');
}

describe('pattern-train ladder', () => {
  it('has 30 levels in the plan order (D28)', () => {
    expect(LEVELS).toHaveLength(30);
    expect(patternTrain.ladder).toEqual({ levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } });
    LEVELS.forEach((r, i) => {
      const level = i + 1;
      const kinds = r.change.flat();
      if (level <= 4) expect(kinds).toEqual(['colour']);
      else if (level <= 8) expect(kinds).toEqual(['size']);
      else if (level <= 12) expect(kinds).toEqual(['turn']);
      if (level <= 16) expect(r.gap).toBe('end');
      if (level >= 17 && level <= 20) expect(r.gap).toBe('middle');
      expect(Boolean(r.solids)).toBe(level >= 21 && level <= 24);
      expect(r.change.every((c) => c.length === (level >= 25 ? 2 : 1))).toBe(true);
      expect(Boolean(r.shift)).toBe(level >= 17); // early units start at the front, where she can see them
      expect(r.choices).toBe(level >= 23 ? 4 : 3);
      expect(r.length[1]).toBeLessThanOrEqual(MAX_LENGTH);
      for (const u of r.units) expect(r.length[0]).toBeGreaterThanOrEqual(2 * period(u)); // shown at least twice
    });
  });

  it('never asks for three sizes (there are only two)', () => {
    for (const r of LEVELS) {
      if (r.split) continue;
      if (r.change.some((c) => c.includes('size'))) expect(r.units.some((u) => letters(u) <= 2)).toBe(true);
    }
  });

  it('keeps level 30 rules above the top (endless) and clamps odd input', () => {
    expect(rulesFor(31)).toBe(LEVELS[29]);
    expect(rulesFor(500)).toBe(LEVELS[29]);
    expect(rulesFor(0)).toBe(LEVELS[0]);
  });

  it('says what to do in a few short words', () => {
    expect(patternTrain.instruction(1)).toBe('What comes next? Tap it.');
    expect(patternTrain.instruction(17)).toBe('What is missing? Tap it.');
    expect(patternTrain.instruction(21)).toBe('What comes next? Tap it.');
    expect(patternTrain.instruction(23)).toBe('What is missing? Tap it.');
    for (let level = 1; level <= 31; level++) {
      expect(patternTrain.instruction(level).split(/\s+/).length).toBeLessThanOrEqual(6);
    }
  });
});

describe('pattern-train solver', () => {
  it('reads what comes next', () => {
    expect(predict(['A', 'B', 'A', 'B', undefined])?.value).toBe('A');
    expect(predict(['A', 'A', 'B', 'A', 'A', 'B', undefined])?.value).toBe('A');
    expect(predict(['A', 'B', 'C', 'A', 'B', undefined])?.value).toBe('C');
    expect(predict([0, 90, 0, 90, undefined])?.value).toBe(0); // 0 is a real value, not "empty"
  });

  it('reads a gap in the middle', () => {
    expect(predict(['A', undefined, 'A', 'B', 'A', 'B', 'A'])?.value).toBe('B');
    expect(predict(['A', 'B', 'C', undefined, 'B', 'C', 'A'])?.value).toBe('A');
  });

  it('refuses a train that does not show its pattern twice', () => {
    expect(predict(['A', 'B', undefined])).toBeUndefined();
    expect(predict(['A', 'B', 'C', 'A', undefined])).toBeUndefined(); // ABC needs 6 carriages
    expect(predict(['A', 'B', 'C', 'D', undefined])).toBeUndefined();
  });

  it('never finds a train with two answers (every train of 4 to 8 carriages, up to 3 values, one gap)', () => {
    // D28's claim, checked here: for each row, every value that would complete it into a repeating pattern (shown
    // at least twice) must be the one the solver names. Otherwise a child could read it another way.
    const values = ['A', 'B', 'C'];
    let rows = 0;
    for (let n = 4; n <= 8; n++) {
      for (let m = 0; m < 3 ** n; m++) {
        const row = Array.from({ length: n }, (_, i) => values[Math.floor(m / 3 ** i) % 3]);
        for (let gap = 0; gap < n; gap++) {
          const shown = row.map((v, i) => (i === gap ? undefined : v));
          const ways = values.filter((v) => {
            const full = shown.map((x) => x ?? v);
            for (let p = 1; 2 * p <= n; p++) if (full.every((x, i) => i < p || x === full[i - p])) return true;
            return false;
          });
          const said = predict(shown);
          if (ways.length === 0) expect(said).toBeUndefined();
          else expect([ways, said?.value]).toEqual([[said?.value], ways[0]]);
          rows++;
        }
      }
    }
    expect(rows).toBeGreaterThan(50_000);
  });

  it('needs exactly one empty carriage', () => {
    expect(solve({ cars: [car(), car()], choices: [car()] }).car).toBeUndefined();
    expect(solve({ cars: [car(), null, null, car()], choices: [car()] }).car).toBeUndefined();
  });

  it('finds the one choice that fits, and spots two that fit', () => {
    const blue = car({ colour: 'blue' });
    const cars = [car(), blue, car(), blue, null];
    expect(solve({ cars, choices: [blue, car(), car({ colour: 'pink' })] }).matches).toEqual([1]);
    expect(solve({ cars, choices: [car(), car()] }).matches).toEqual([0, 1]);
    expect(solve({ cars, choices: [blue, car({ size: 'small' })] }).matches).toEqual([]);
  });
});

describe('pattern-train puzzles at every level', () => {
  for (let level = 1; level <= LEVELS.length + 1; level++) {
    const rules = rulesFor(level);
    it(`level ${level}: one right choice, inside the level's rules`, () => {
      for (let s = 0; s < SEEDS; s++) {
        const { puzzle: p, fallback, tries } = generate(level, createRng(`t${s}`, level));
        const where = `level ${level}, seed t${s}`;
        expect(fallback, where).toBe(false);
        expect(tries, where).toBeLessThan(20);

        // The train: its length, one empty carriage in the right place.
        const n = p.cars.length;
        expect(n, where).toBeGreaterThanOrEqual(rules.length[0]);
        expect(n, where).toBeLessThanOrEqual(rules.length[1]);
        expect(p.cars.filter((c) => c === null), where).toHaveLength(1);
        expect(p.cars[p.gap], where).toBeNull();
        if (rules.gap === 'end') expect(p.gap, where).toBe(n - 1);
        if (rules.gap === 'middle') expect(p.gap > 0 && p.gap < n - 1, where).toBe(true);
        expect(p.gap, where).toBeGreaterThanOrEqual(rules.gapFrom ?? 1);

        // The choices: the right number, all different, exactly one fits (read by the solver from the screen).
        expect(p.choices, where).toHaveLength(rules.choices);
        expect([...p.cars.filter((c) => c !== null), ...p.choices].every(isCar), where).toBe(true);
        for (let i = 0; i < p.choices.length; i++) {
          for (let j = i + 1; j < p.choices.length; j++) expect(sameCar(p.choices[i], p.choices[j]), where).toBe(false);
        }
        const solved = solve(p);
        expect(solved.matches, where).toEqual([p.answer]);

        // What changes along the train is what the level asks for, with the level's units.
        const train = filled(p);
        /** @type {Attr[]} */
        const changing = ATTRS.filter((a) => shortestRepeat(train.map((c) => c[a])) > 1);
        expect(new Set(changing), where).toEqual(new Set(p.changes));
        expect(rules.change.some((c) => c.length === changing.length && c.every((a) => changing.includes(a))), where)
          .toBe(true);
        const repeats = changing.map((a) => shortestRepeat(train.map((c) => c[a])));
        for (const r of repeats) expect(2 * r, where).toBeLessThanOrEqual(n); // shown at least twice
        if (rules.split) {
          expect(repeats.slice().sort(), where).toEqual([2, 3]); // one AB and one ABC
        } else {
          expect(new Set(repeats).size, where).toBe(1); // they change together
          const [a, b] = changing;
          if (b) {
            // Linked: each value of one always goes with the same value of the other.
            const pairs = new Set(train.map((c) => `${c[a]}|${c[b]}`));
            expect(pairs.size, where).toBe(new Set(train.map((c) => c[a])).size);
          }
          for (const attr of changing) {
            const row = train.map((c) => c[attr]);
            const fits = rules.units.filter((u) => period(u) === repeats[0] && letters(u) === new Set(row).size);
            expect(fits.length, where).toBeGreaterThan(0);
            if (!rules.shift) expect(fits, where).toContain(lettersOf(row, repeats[0])); // starts at the front
          }
        }

        // Pictures: flat or 3D, never mixed; turns only on shapes that show them, only on turn levels.
        const all = [...train, ...p.choices];
        const shapes = rules.solids ? SOLIDS : FLAT;
        expect(all.every((c) => shapes.includes(c.shape)), where).toBe(true);
        for (const c of all) {
          if (c.turn !== 0) expect(TURNABLE.includes(c.shape) && changing.includes('turn'), where).toBe(true);
        }
        if (!changing.includes('size')) expect(train.every((c) => c.size === 'big'), where).toBe(true);

        // Every wrong choice is wrong on something that changes, and the hint names it.
        const right = p.choices[p.answer];
        p.choices.forEach((c, i) => {
          if (i === p.answer) return;
          const off = changing.filter((a) => c[a] !== right[a]);
          expect(off.length, where).toBeGreaterThan(0);
          const hint = hintFor(p, i);
          const look = { colour: 'colours', shape: 'shapes', size: 'sizes', turn: 'where they point' };
          for (const a of off) expect(hint, where).toContain(look[a]);
          expect(hint.split(/\s+/).length, where).toBeLessThanOrEqual(9);
        });
      }
    });
  }

  it('gives the same puzzle for the same seed and level (D12)', () => {
    for (const level of [1, 9, 17, 24, 30]) {
      const a = generate(level, createRng('same', level)).puzzle;
      const b = generate(level, createRng('same', level)).puzzle;
      expect(b).toEqual(a);
    }
  });

  it('gives different puzzles for different seeds, and puts the right choice in different places', () => {
    for (const level of [1, 5, 13, 25, 30]) {
      const seen = new Set();
      const places = new Set();
      for (let s = 0; s < 30; s++) {
        const { puzzle } = generate(level, createRng(`v${s}`, level));
        seen.add(JSON.stringify(puzzle));
        places.add(puzzle.answer);
      }
      expect(seen.size).toBeGreaterThan(10);
      expect(places.size).toBe(rulesFor(level).choices);
    }
  });

  it('uses every kind of change a level offers', () => {
    for (const level of [13, 17, 25, 29]) {
      const kinds = new Set();
      for (let s = 0; s < 100; s++) {
        kinds.add(generate(level, createRng(`k${s}`, level)).puzzle.changes.slice().sort().join('+'));
      }
      expect(kinds.size).toBe(rulesFor(level).change.length);
    }
  });

  it('has a fallback puzzle that works, and uses a copy of it when every try fails', () => {
    const s = solve(FALLBACK);
    expect(s.matches).toEqual([FALLBACK.answer]);
    let calls = 0;
    const { puzzle, fallback, tries } = generate(5, createRng('x', 5), () => {
      calls++;
      return undefined;
    });
    expect(fallback).toBe(true);
    expect(calls).toBe(TRIES);
    expect(tries).toBe(TRIES);
    expect(puzzle).toEqual(FALLBACK);
    expect(puzzle).not.toBe(FALLBACK);
  });
});

describe('pattern-train words', () => {
  it('hints at what the tapped choice got wrong', () => {
    const blue = car({ colour: 'blue', shape: 'star' });
    /** @type {Puzzle} */
    const p = { cars: [car(), blue, car(), blue, null], gap: 4, answer: 0, changes: ['colour', 'shape'],
      choices: [car(), car({ shape: 'star' }), car({ colour: 'blue' }), blue] };
    expect(hintFor(p, 1)).toBe('Not that one. Look at the shapes.');
    expect(hintFor(p, 2)).toBe('Not that one. Look at the colours.');
    expect(hintFor(p, 3)).toBe('Not that one. Look at the colours and shapes.');
    const turned = { ...p, changes: /** @type {Attr[]} */ (['turn']),
      choices: [car({ shape: 'triangle' }), car({ shape: 'triangle', turn: 90 })] };
    expect(hintFor(turned, 1)).toBe('Not that one. Look where they point.');
    // A choice that differs only on something that doesn't change (never made, but safe): name what changes.
    expect(hintFor({ ...p, choices: [car(), car({ size: 'small' })] }, 1))
      .toBe('Not that one. Look at the colours and shapes.');
  });


  it('describes a carriage in a few simple words', () => {
    expect(words(car())).toBe('orange circle');
    expect(words(car({ size: 'small', colour: 'blue', shape: 'star' }))).toBe('small blue star');
    expect(words(car({ shape: 'cylinder' }))).toBe('orange tube');
    expect(words(car({ shape: 'triangle', turn: 180 }))).toBe('orange triangle');
    expect(words(car({ shape: 'triangle', turn: 180 }), true)).toBe('orange triangle pointing down');
    expect(words(car({ shape: 'heart' }), true)).toBe('orange heart pointing down'); // a heart's point is at the bottom
    expect(words(car({ shape: 'heart', turn: 90 }), true)).toBe('orange heart pointing left');
    expect(words(car({ shape: 'circle', turn: 90 }), true)).toBe('orange circle'); // a circle can't point
  });

  it('checks saved carriages', () => {
    expect(isCar(car())).toBe(true);
    expect(isCar(null)).toBe(false);
    expect(isCar({ ...car(), colour: 'red' })).toBe(false);
    expect(isCar({ ...car(), turn: 45 })).toBe(false);
  });
});

describe('pattern-train resume (saved progress, D7)', () => {
  const p = generate(1, createRng('resume', 1)).puzzle;
  const wrongOnes = [0, 1, 2].filter((i) => i !== p.answer);

  it('brings back the choices she already tried', () => {
    expect(restoreWrong(p, { wrong: wrongOnes })).toEqual(wrongOnes);
    expect(restoreWrong(p, null)).toEqual([]);
    expect(restoreWrong(p, { wrong: 'x' })).toEqual([]);
  });

  it('drops anything that no longer makes sense', () => {
    const odd = [p.answer, -1, 3, 1.5, '0', wrongOnes[0], wrongOnes[0], null];
    expect(restoreWrong(p, { wrong: odd })).toEqual([wrongOnes[0]]);
  });

  it('never changes the puzzle', () => {
    const before = JSON.stringify(p);
    restoreWrong(p, { wrong: wrongOnes });
    hintFor(p, wrongOnes[0]);
    expect(JSON.stringify(p)).toBe(before);
  });
});
