// Arrow Path's ladder (D14): what each level asks for. The generator builds puzzles to these rules and the unit tests
// check every puzzle stays inside them (D12).
//
// Three modes (owner, 2026-11-15, idea check answer 1c):
// - board (1–10): she taps squares to put arrows on the board. The robot walks straight and turns on arrows.
// - moves (11–20): she builds a list of moves under the board. From 14, 🔁 repeats the arrow before it (×2 or ×3).
// - debug (21–30): the list starts almost right, with 1 or 2 arrows the wrong way. She fixes it.

/** @typedef {'board' | 'moves' | 'debug'} Mode */

/**
 * @typedef {object} Rules
 * @property {Mode} mode
 * @property {number} cols  Grid width (at most 5, so board squares stay ≥ 64 px on a phone).
 * @property {number} rows  Grid height (at most 6).
 * @property {[number, number]} rocks  Loose rocks: [min, max]. Board levels can add blocking rocks on top.
 * @property {number} [turns]  board: the exact number of arrows needed.
 * @property {number} [minLength]  board: the planned route is at least this many steps.
 * @property {number} [blockers]  board: at most this many rocks placed to block shortcuts.
 * @property {[number, number]} [steps]  moves without loops / debug without loops: shortest route length [min, max].
 * @property {number} [loopRuns]  Straight runs of 3+ that need 🔁 (0 = no loops at this level).
 * @property {number} [bugs]  debug: arrows turned the wrong way in the starting list.
 */

/** @type {Rules[]} index 0 = level 1 */
export const LEVELS = [
  // Board arrows: one turn, then more turns, then rocks in the way.
  { mode: 'board', cols: 3, rows: 3, turns: 1, minLength: 2, blockers: 0, rocks: [0, 0] },
  { mode: 'board', cols: 3, rows: 4, turns: 1, minLength: 3, blockers: 0, rocks: [0, 0] },
  { mode: 'board', cols: 4, rows: 4, turns: 1, minLength: 4, blockers: 0, rocks: [0, 0] },
  { mode: 'board', cols: 4, rows: 5, turns: 2, minLength: 4, blockers: 2, rocks: [0, 0] },
  { mode: 'board', cols: 4, rows: 5, turns: 2, minLength: 4, blockers: 2, rocks: [0, 1] },
  { mode: 'board', cols: 4, rows: 5, turns: 2, minLength: 5, blockers: 2, rocks: [1, 1] },
  { mode: 'board', cols: 5, rows: 5, turns: 3, minLength: 5, blockers: 4, rocks: [1, 2] },
  { mode: 'board', cols: 5, rows: 5, turns: 3, minLength: 6, blockers: 4, rocks: [2, 3] },
  { mode: 'board', cols: 5, rows: 6, turns: 4, minLength: 7, blockers: 5, rocks: [1, 2] },
  { mode: 'board', cols: 5, rows: 6, turns: 4, minLength: 8, blockers: 5, rocks: [2, 3] },
  // A list of moves: plain arrows first, with 2 spare slots.
  { mode: 'moves', cols: 4, rows: 4, steps: [3, 4], loopRuns: 0, rocks: [0, 1] },
  { mode: 'moves', cols: 5, rows: 5, steps: [4, 5], loopRuns: 0, rocks: [1, 2] },
  { mode: 'moves', cols: 5, rows: 5, steps: [5, 6], loopRuns: 0, rocks: [1, 2] },
  // 🔁: too few slots to write every step, so a repeat is needed.
  { mode: 'moves', cols: 5, rows: 5, loopRuns: 1, rocks: [0, 1] },
  { mode: 'moves', cols: 5, rows: 5, loopRuns: 1, rocks: [1, 2] },
  { mode: 'moves', cols: 5, rows: 5, loopRuns: 1, rocks: [1, 2] },
  { mode: 'moves', cols: 5, rows: 6, loopRuns: 1, rocks: [2, 3] },
  { mode: 'moves', cols: 5, rows: 6, loopRuns: 2, rocks: [1, 2] },
  { mode: 'moves', cols: 5, rows: 6, loopRuns: 2, rocks: [2, 3] },
  { mode: 'moves', cols: 5, rows: 6, loopRuns: 2, rocks: [2, 3] },
  // Debugging: fix the arrow that's the wrong way. Lists use 🔁 from 24, and two arrows are wrong from 26.
  { mode: 'debug', cols: 5, rows: 5, steps: [4, 5], loopRuns: 0, bugs: 1, rocks: [1, 2] },
  { mode: 'debug', cols: 5, rows: 5, steps: [5, 6], loopRuns: 0, bugs: 1, rocks: [1, 2] },
  { mode: 'debug', cols: 5, rows: 6, steps: [5, 7], loopRuns: 0, bugs: 1, rocks: [2, 3] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 1, bugs: 1, rocks: [1, 2] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 1, bugs: 1, rocks: [2, 3] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 1, bugs: 2, rocks: [1, 2] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 1, bugs: 2, rocks: [2, 3] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 1, bugs: 2, rocks: [2, 3] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 2, bugs: 2, rocks: [2, 3] },
  { mode: 'debug', cols: 5, rows: 6, loopRuns: 2, bugs: 2, rocks: [3, 4] },
];

/** Most slots a move list can have: two rows of five on a phone. */
export const MAX_SLOTS = 10;

/**
 * The rules for a level. Above the top level, puzzles keep level 30's rules (endless, D14).
 * @param {number} level
 * @returns {Rules}
 */
export function rulesFor(level) {
  const i = Math.min(Math.max(1, Math.floor(level)), LEVELS.length) - 1;
  return LEVELS[i];
}

/**
 * The first level of each mode, where 🔊 explains how to play (she may start there from Medium or Hard).
 * @param {number} level
 * @returns {boolean}
 */
export function isFirstOfKind(level) {
  if (level < 1 || level > LEVELS.length) return false;
  if (level === 1) return true;
  const now = LEVELS[level - 1];
  const before = LEVELS[level - 2];
  return now.mode !== before.mode || (now.loopRuns ?? 0) > 0 !== (before.loopRuns ?? 0) > 0;
}
