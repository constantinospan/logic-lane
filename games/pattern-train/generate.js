// Pattern train's generator (D12, D28): the whole train first, then one carriage is taken out and the choices are made
// around it. The solver then reads the train on its own; a puzzle is used only if it finds exactly one answer.

import { ATTRS, COLOURS, FLAT, SIZES, SOLIDS, TURNABLE, TURNS, sameCar } from './model.js';
import { letters, period, rulesFor } from './levels.js';
import { solve } from './solve.js';

/** @typedef {import('./model.js').Car} Car */
/** @typedef {import('./model.js').Attr} Attr */
/** @typedef {import('./model.js').Puzzle} Puzzle */
/** @typedef {import('./levels.js').Unit} Unit */
/** @typedef {import('./levels.js').Rules} Rules */
/** @typedef {import('../../js/core/rng.js').Rng} Rng */
/** @typedef {string | number} Value */

/** Tries before falling back to a fixed puzzle (never needed in tests). */
export const TRIES = 500;

/** Used only if every try fails, so endless play never breaks: orange blue orange blue, then orange. @type {Puzzle} */
export const FALLBACK = {
  cars: [
    { shape: 'circle', colour: 'orange', size: 'big', turn: 0 },
    { shape: 'circle', colour: 'blue', size: 'big', turn: 0 },
    { shape: 'circle', colour: 'orange', size: 'big', turn: 0 },
    { shape: 'circle', colour: 'blue', size: 'big', turn: 0 },
    null,
  ],
  gap: 4,
  choices: [
    { shape: 'circle', colour: 'blue', size: 'big', turn: 0 },
    { shape: 'circle', colour: 'orange', size: 'big', turn: 0 },
    { shape: 'circle', colour: 'yellow', size: 'big', turn: 0 },
  ],
  answer: 1,
  changes: ['colour'],
};

/**
 * The values a thing can take in this puzzle.
 * @param {Rules} rules
 * @param {Attr[]} changes
 * @returns {Record<Attr, readonly Value[]>}
 */
function poolsFor(rules, changes) {
  const shapes = rules.solids ? SOLIDS : changes.includes('turn') ? TURNABLE : FLAT;
  return { shape: shapes, colour: COLOURS, size: SIZES, turn: TURNS };
}

/**
 * Which unit each changing thing follows.
 * @param {Rules} rules
 * @param {Attr[]} changes
 * @param {Record<Attr, readonly Value[]>} pools
 * @param {Rng} rng
 * @returns {Map<Attr, Unit>}
 */
function unitsFor(rules, changes, pools, rng) {
  /** @type {Map<Attr, Unit>} */
  const units = new Map();
  if (rules.split) {
    // One thing goes AB, the other ABC. Size has only two values, so it always gets AB.
    const [a, b] = changes;
    const abFirst = pools[a].length < 3 || (pools[b].length >= 3 && rng.next() < 0.5);
    units.set(a, abFirst ? 'AB' : 'ABC');
    units.set(b, abFirst ? 'ABC' : 'AB');
    return units;
  }
  const fewest = Math.min(...changes.map((a) => pools[a].length));
  const unit = rng.pick(rules.units.filter((u) => letters(u) <= fewest));
  for (const a of changes) units.set(a, unit);
  return units;
}

/**
 * The full train (no gap yet).
 * @param {number} n
 * @param {Attr[]} changes
 * @param {Map<Attr, Unit>} units
 * @param {Record<Attr, readonly Value[]>} pools
 * @param {boolean} shift  May start part-way into the unit.
 * @param {Rng} rng
 * @returns {Car[]}
 */
function buildTrain(n, changes, units, pools, shift, rng) {
  /** @type {Record<Attr, Value[]>} */
  const rows = { shape: [], colour: [], size: [], turn: [] };
  // Things that follow the same unit start at the same place in it, so they change together (levels 25–28).
  /** @type {Map<Unit, number>} */
  const phases = new Map();
  for (const attr of ATTRS) {
    const unit = units.get(attr);
    if (!unit) {
      // Stays the same all along. Big and not turned, unless that's what changes.
      const value = attr === 'size' ? 'big' : attr === 'turn' ? 0 : rng.pick(pools[attr]);
      rows[attr] = Array(n).fill(value);
      continue;
    }
    const values = rng.shuffle(pools[attr]).slice(0, letters(unit));
    const order = [...new Set(unit)]; // 'A', 'B', 'C'
    if (!phases.has(unit)) phases.set(unit, shift ? rng.int(0, period(unit) - 1) : 0);
    const phase = /** @type {number} */ (phases.get(unit));
    for (let i = 0; i < n; i++) rows[attr].push(values[order.indexOf(unit[(i + phase) % period(unit)])]);
  }
  return Array.from({ length: n }, (_, i) => /** @type {Car} */ ({
    shape: rows.shape[i], colour: rows.colour[i], size: rows.size[i], turn: rows.turn[i],
  }));
}

/**
 * Wrong choices, the most tempting first. Every one is wrong on something that changes along the train, so the hint
 * ("Look at the colours.") always points at a real difference: one changing thing wrong (a value from the train if
 * possible), then two wrong. Size has only two values, so on a size level the third choice is the wrong size and
 * also a different colour or shape.
 * @param {Car} answer
 * @param {Car[]} train
 * @param {Attr[]} changes
 * @param {Record<Attr, readonly Value[]>} pools
 * @param {number} count
 * @param {Rng} rng
 * @returns {Car[]}
 */
function distractors(answer, train, changes, pools, count, rng) {
  /** @param {Attr} attr @returns {Value[]} other values, the ones in the train first */
  const others = (attr) => {
    /** @type {Set<Value>} */
    const inTrain = new Set(train.map((c) => c[attr]));
    const rest = pools[attr].filter((v) => v !== answer[attr]);
    return [...rng.shuffle(rest.filter((v) => inTrain.has(v))), ...rng.shuffle(rest.filter((v) => !inTrain.has(v)))];
  };
  /** @param {Partial<Record<Attr, Value>>} change @returns {Car} */
  const variant = (change) => /** @type {Car} */ ({ ...answer, ...change });

  /** @type {Car[][]} */
  const singles = changes.map((attr) => others(attr).map((v) => variant({ [attr]: v })));
  /** @type {Car[]} */
  const ordered = [];
  for (let k = 0; singles.some((s) => k < s.length); k++) {
    for (const s of singles) if (k < s.length) ordered.push(s[k]);
  }
  // Two wrong: two changing things, or a changing thing and one that stays the same. (Never a turn on a shape
  // that can't show one.)
  const extra = ATTRS.filter((a) => !changes.includes(a) && a !== 'turn' && pools[a].length > 1);
  /** @type {Car[]} */
  const doubles = [];
  for (const a of changes) {
    for (const b of [...changes, ...extra]) {
      if (b === a || (changes.includes(b) && changes.indexOf(b) < changes.indexOf(a))) continue;
      for (const va of others(a)) for (const vb of others(b)) doubles.push(variant({ [a]: va, [b]: vb }));
    }
  }
  ordered.push(...rng.shuffle(doubles));

  /** @type {Car[]} */
  const picked = [];
  for (const car of ordered) {
    if (picked.length === count) break;
    if (!sameCar(car, answer) && !picked.some((c) => sameCar(c, car))) picked.push(car);
  }
  return picked;
}

/**
 * Where the empty carriage goes.
 * @param {Rules} rules
 * @param {number} n
 * @param {Rng} rng
 * @returns {number}
 */
function gapFor(rules, n, rng) {
  if (rules.gap === 'end') return n - 1;
  const from = Math.max(1, rules.gapFrom ?? 1);
  return rng.int(from, rules.gap === 'middle' ? n - 2 : n - 1);
}

/**
 * One try at a puzzle for these rules. Returns undefined if the solver doesn't agree it's fair.
 * @param {Rules} rules
 * @param {Rng} rng
 * @returns {Puzzle | undefined}
 */
export function attempt(rules, rng) {
  const changes = rng.pick(rules.change).slice();
  const pools = poolsFor(rules, changes);
  const units = unitsFor(rules, changes, pools, rng);
  const longest = Math.max(...[...units.values()].map(period));
  const n = Math.max(rng.int(rules.length[0], rules.length[1]), 2 * longest);
  const train = buildTrain(n, changes, units, pools, rules.shift ?? false, rng);
  const gap = gapFor(rules, n, rng);
  const answerCar = train[gap];
  const wrong = distractors(answerCar, train, changes, pools, rules.choices - 1, rng);
  if (wrong.length !== rules.choices - 1) return undefined;
  const choices = rng.shuffle([answerCar, ...wrong]);
  /** @type {Puzzle} */
  const puzzle = {
    cars: train.map((c, i) => (i === gap ? null : c)),
    gap,
    choices,
    answer: choices.indexOf(answerCar),
    changes,
  };
  const s = solve(puzzle);
  if (s.matches.length !== 1 || s.matches[0] !== puzzle.answer) return undefined;
  // The child reads the same pattern that was built: each changing thing repeats with its unit's length.
  for (const [attr, unit] of units) if (s.periods[attr] !== period(unit)) return undefined;
  return puzzle;
}

/**
 * A puzzle for this level.
 * @param {number} level
 * @param {Rng} rng
 * @param {(rules: Rules, rng: Rng) => Puzzle | undefined} [make]  One try (tests pass one that always fails).
 * @returns {{ puzzle: Puzzle, tries: number, fallback: boolean }}
 */
export function generate(level, rng, make = attempt) {
  const rules = rulesFor(level);
  for (let tries = 1; tries <= TRIES; tries++) {
    const puzzle = make(rules, rng);
    if (puzzle) return { puzzle, tries, fallback: false };
  }
  return { puzzle: structuredClone(FALLBACK), tries: TRIES, fallback: true };
}
