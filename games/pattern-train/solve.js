// Pattern train's solver (D12). It doesn't know how the puzzle was made: it reads the train the way a child would.
//
// For each thing a carriage carries (shape, colour, size, turn), it tries every repeat length p that shows at
// least twice (2p ≤ carriages). A length fits if every two visible carriages p apart (or 2p, 3p…) agree. Each fitting length
// says what the empty carriage must be. The train is fair only if some length fits and they all say the same thing:
// then there's no other way to read it. Finally, exactly one choice must match.

import { ATTRS } from './model.js';

/** @typedef {import('./model.js').Car} Car */
/** @typedef {import('./model.js').Attr} Attr */
/** @typedef {import('./model.js').Puzzle} Puzzle */

/**
 * What the empty place must hold, judging one row of values, or undefined if it can't be told for sure.
 * @template T
 * @param {(T | undefined)[]} values  `undefined` is the empty place (exactly one).
 * @returns {{ value: T, periods: number[] } | undefined}  `periods`: every repeat length that fits.
 */
export function predict(values) {
  const n = values.length;
  const gap = values.indexOf(undefined);
  /** @type {Set<T>} */
  const answers = new Set();
  /** @type {number[]} */
  const periods = [];
  for (let p = 1; 2 * p <= n; p++) {
    /** @type {Map<number, T>} */
    const seen = new Map(); // position mod p → its value
    let fits = true;
    for (let i = 0; i < n && fits; i++) {
      if (i === gap) continue;
      const v = /** @type {T} */ (values[i]);
      const before = seen.get(i % p);
      if (before === undefined) seen.set(i % p, v);
      else if (before !== v) fits = false;
    }
    const answer = seen.get(gap % p);
    if (!fits || answer === undefined) continue;
    periods.push(p);
    answers.add(answer);
  }
  if (answers.size !== 1) return undefined;
  return { value: [...answers][0], periods };
}

/**
 * @typedef {object} Solution
 * @property {Car | undefined} car  The carriage that fits, or undefined if the train can be read more than one way.
 * @property {number[]} matches  Choices that are exactly that carriage.
 * @property {Partial<Record<Attr, number>>} periods  The shortest repeat length of each thing, with the gap filled.
 */

/**
 * Solve a puzzle from what's on screen only (the train and the choices).
 * @param {Pick<Puzzle, 'cars' | 'choices'>} p
 * @returns {Solution}
 */
export function solve(p) {
  if (p.cars.filter((c) => c === null).length !== 1) return { car: undefined, matches: [], periods: {} };
  /** @type {Record<string, unknown>} */
  const car = {};
  /** @type {Partial<Record<Attr, number>>} */
  const periods = {};
  for (const attr of ATTRS) {
    const guess = predict(p.cars.map((c) => (c === null ? undefined : c[attr])));
    if (!guess) return { car: undefined, matches: [], periods: {} };
    car[attr] = guess.value;
    periods[attr] = guess.periods[0];
  }
  const fit = /** @type {Car} */ (car);
  const matches = p.choices.flatMap((c, i) => (ATTRS.every((a) => c[a] === fit[a]) ? [i] : []));
  return { car: fit, matches, periods };
}
