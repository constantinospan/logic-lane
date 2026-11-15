// Arrow Path's puzzle generator (D12): lay out the answer first (a route that never crosses itself), build the
// puzzle around it, then check it with the solvers. Uses only the rng it's given, so a seed always gives the same
// puzzle.

import { DELTA, DIRS, key, runProgram, walkArrows } from './engine.js';
import { MAX_SLOTS, rulesFor } from './levels.js';
import { minTurns, shortestMoves } from './solve.js';

/** @typedef {import('./engine.js').Puzzle} Puzzle */
/** @typedef {import('./engine.js').Cell} Cell */
/** @typedef {import('./engine.js').Dir} Dir */
/** @typedef {import('./engine.js').Token} Token */
/** @typedef {import('./levels.js').Rules} Rules */
/** @typedef {import('../../js/core/rng.js').Rng} Rng */

/** Attempts before falling back to a fixed, always-valid puzzle. The tests check this is never reached. */
export const TRIES = 500;

/** @type {Record<Dir, Dir[]>} The two ways to turn from each direction. */
const TURNS = { R: ['U', 'D'], L: ['U', 'D'], U: ['L', 'R'], D: ['L', 'R'] };

/**
 * @typedef {object} Route
 * @property {Cell[]} cells  Every square from the start to the end.
 * @property {{ d: Dir, len: number }[]} segs  Straight pieces, each turning from the one before.
 */

/**
 * A random route that stays on the grid and never crosses itself.
 * @param {Rng} rng
 * @param {Rules} rules
 * @param {[number, number][]} lengths  [min, max] length of each straight piece.
 * @param {boolean} monotone  Only two directions (e.g. right and down), so the route is a shortest one.
 * @returns {Route | null}  null when it ran out of room (the caller tries again).
 */
function buildRoute(rng, rules, lengths, monotone) {
  /** @type {Cell} */
  let at = [rng.int(0, rules.rows - 1), rng.int(0, rules.cols - 1)];
  const cells = [at];
  const used = new Set([key(...at)]);
  /** @type {Dir[]} */
  const pair = [rng.pick(/** @type {Dir[]} */ (['R', 'L'])), rng.pick(/** @type {Dir[]} */ (['U', 'D']))];
  let d = monotone ? rng.pick(pair) : rng.pick(DIRS);
  /** @type {{ d: Dir, len: number }[]} */
  const segs = [];
  for (let s = 0; s < lengths.length; s++) {
    if (s > 0) d = monotone ? (d === pair[0] ? pair[1] : pair[0]) : rng.pick(TURNS[d]);
    const [dr, dc] = DELTA[d];
    let room = 0;
    for (let [r, c] = [at[0] + dr, at[1] + dc]; ; r += dr, c += dc) {
      if (r < 0 || c < 0 || r >= rules.rows || c >= rules.cols || used.has(key(r, c))) break;
      room++;
    }
    const [min, max] = lengths[s];
    if (Math.min(max, room) < min) return null;
    const len = rng.int(min, Math.min(max, room));
    for (let k = 0; k < len; k++) {
      at = [at[0] + dr, at[1] + dc];
      cells.push(at);
      used.add(key(...at));
    }
    segs.push({ d, len });
  }
  return { cells, segs };
}

/**
 * Put loose rocks on free squares off the route.
 * @param {Rng} rng
 * @param {Puzzle} p
 * @param {[number, number]} range
 * @param {Set<string>} keep  Squares that must stay free.
 * @returns {boolean}  false when there wasn't room.
 */
function addRocks(rng, p, [min, max], keep) {
  const taken = new Set([...keep, ...p.rocks.map(([r, c]) => key(r, c))]);
  /** @type {Cell[]} */
  const free = [];
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) if (!taken.has(key(r, c))) free.push([r, c]);
  const count = rng.int(min, max);
  if (free.length < count) return false;
  p.rocks.push(...rng.shuffle(free).slice(0, count));
  return true;
}

/**
 * @param {Rules} rules
 * @param {Route} route
 * @returns {Puzzle}
 */
function base(rules, route) {
  return {
    mode: rules.mode,
    cols: rules.cols,
    rows: rules.rows,
    start: route.cells[0],
    facing: route.segs[0].d,
    gem: route.cells[route.cells.length - 1],
    rocks: [],
    solution: [],
  };
}

/**
 * The move list for a route: straight runs of 3 or more use 🔁 (→ 🔁×3 is three steps right).
 * @param {Route} route
 * @param {boolean} loops
 * @returns {Token[]}
 */
function programFor(route, loops) {
  /** @type {Token[]} */
  const out = [];
  for (const { d, len } of route.segs) {
    if (!loops || len < 3) {
      for (let k = 0; k < len; k++) out.push(d);
    } else {
      for (let left = len; left > 0; left -= 3) {
        out.push(d);
        if (left >= 3) out.push('x3');
        else if (left === 2) out.push('x2');
      }
    }
  }
  return out;
}

/**
 * Lengths for a route with `runs` straight runs of 3–4 (for 🔁) mixed with short pieces of 1–2.
 * @param {Rng} rng
 * @param {number} runs
 * @returns {[number, number][]}
 */
function loopLengths(rng, runs) {
  /** @type {[number, number]} */
  const run = [3, 4];
  /** @type {[number, number]} */
  const bit = [1, 2];
  // The route alternates between two directions, so two runs must sit an odd distance apart (one across, one up or
  // down): two runs the same way wouldn't fit on a 5-wide grid.
  const shapes = runs === 1
    ? [[run, bit], [bit, run], [bit, run, bit], [run, bit, bit], [bit, bit, run]]
    : [[run, run, bit], [bit, run, run], [run, run], [bit, run, run, bit], [run, bit, bit, run]];
  return rng.pick(shapes);
}

/**
 * Board mode: exactly `turns` arrows needed. Rocks block any route that would need fewer.
 * @param {Rules} rules
 * @param {Rng} rng
 * @returns {Puzzle | null}
 */
function boardPuzzle(rules, rng) {
  const turns = /** @type {number} */ (rules.turns);
  const route = buildRoute(rng, rules, Array.from({ length: turns + 1 }, () => [1, 4]), false);
  if (!route || route.cells.length - 1 < (rules.minLength ?? 0)) return null;
  const p = base(rules, route);
  /** @type {Record<string, Dir>} */
  const arrows = {};
  let at = 0;
  route.segs.forEach((seg, s) => {
    if (s > 0) arrows[key(...route.cells[at])] = seg.d; // turn where the last piece ended
    at += seg.len;
  });
  p.solution = arrows;
  const onRoute = new Set(route.cells.map((cell) => key(...cell)));
  // Block shortcuts: while some route needs fewer arrows, put a rock on it (off the planned route).
  for (let blocked = 0; ; blocked++) {
    const best = minTurns(p);
    if (!best || best.turns > turns) return null; // can't happen: the planned route is always open
    if (best.turns === turns) break;
    const spots = best.route.filter((cell) => !onRoute.has(key(...cell)));
    if (blocked >= (rules.blockers ?? 0) || spots.length === 0) return null;
    p.rocks.push(rng.pick(spots));
  }
  if (!addRocks(rng, p, rules.rocks, onRoute)) return null;
  // Check: the planned arrows work, and nothing needs fewer.
  if (walkArrows(p, arrows).result !== 'treasure' || minTurns(p)?.turns !== turns) return null;
  return p;
}

/**
 * Moves mode. Without loops: the shortest route has the level's length, with 2 spare slots. With loops: too few
 * slots to write every step, so 🔁 is needed.
 * @param {Rules} rules
 * @param {Rng} rng
 * @returns {Puzzle | null}
 */
function movesPuzzle(rules, rng) {
  const runs = rules.loopRuns ?? 0;
  const route = runs
    ? buildRoute(rng, rules, loopLengths(rng, runs), true)
    : buildRoute(rng, rules, Array.from({ length: rng.int(2, 3) }, () => [1, 3]), false);
  if (!route) return null;
  const p = base(rules, route);
  p.loops = runs > 0;
  if (!addRocks(rng, p, rules.rocks, new Set(route.cells.map((cell) => key(...cell))))) return null;
  const shortest = shortestMoves(p);
  if (!shortest) return null;
  if (runs) {
    const program = programFor(route, true);
    // The route only goes two ways, so it is a shortest one. A loop is needed: every plain list is too long.
    if (shortest.length !== route.cells.length - 1 || shortest.length <= program.length) return null;
    p.slots = program.length;
    p.solution = program;
  } else {
    const [min, max] = /** @type {[number, number]} */ (rules.steps);
    if (shortest.length < min || shortest.length > max) return null;
    p.slots = shortest.length + 2;
    p.solution = shortest;
  }
  if (p.slots > MAX_SLOTS || runProgram(p, /** @type {Token[]} */ (p.solution)).result !== 'treasure') return null;
  return p;
}

/**
 * Debug mode: the planned list with 1 or 2 arrows turned the wrong way, so it fails until she fixes them.
 * @param {Rules} rules
 * @param {Rng} rng
 * @returns {Puzzle | null}
 */
function debugPuzzle(rules, rng) {
  const runs = rules.loopRuns ?? 0;
  const route = runs
    ? buildRoute(rng, rules, loopLengths(rng, runs), true)
    : buildRoute(rng, rules, Array.from({ length: rng.int(2, 3) }, () => [1, 3]), false);
  if (!route) return null;
  const p = base(rules, route);
  p.loops = runs > 0;
  if (!addRocks(rng, p, rules.rocks, new Set(route.cells.map((cell) => key(...cell))))) return null;
  const fixed = programFor(route, runs > 0);
  if (!runs) {
    const [min, max] = /** @type {[number, number]} */ (rules.steps);
    if (fixed.length < min || fixed.length > max) return null;
  }
  if (fixed.length + 1 > MAX_SLOTS || runProgram(p, fixed).result !== 'treasure') return null;
  const arrowsAt = fixed.flatMap((t, i) => (t === 'x2' || t === 'x3' ? [] : [i]));
  const bugs = rules.bugs ?? 1;
  for (let tryBugs = 0; tryBugs < 10; tryBugs++) {
    const broken = fixed.slice();
    for (const i of rng.shuffle(arrowsAt).slice(0, bugs)) {
      broken[i] = rng.pick(DIRS.filter((d) => d !== fixed[i]));
    }
    if (runProgram(p, broken).result === 'treasure') continue; // still works: not a bug
    p.program = broken;
    p.slots = fixed.length + 1;
    p.solution = fixed;
    return p;
  }
  return null;
}

/** @type {Record<import('./levels.js').Mode, Puzzle>} Used only if every attempt failed. Always valid (tested). */
export const FALLBACK = {
  board: { mode: 'board', cols: 3, rows: 3, start: [0, 0], facing: 'R', gem: [2, 2], rocks: [],
    solution: { '0,2': 'D' } },
  moves: { mode: 'moves', cols: 3, rows: 3, start: [0, 0], facing: 'R', gem: [2, 2], rocks: [], slots: 6,
    loops: false, solution: ['R', 'R', 'D', 'D'] },
  debug: { mode: 'debug', cols: 3, rows: 3, start: [0, 0], facing: 'R', gem: [2, 2], rocks: [], slots: 5,
    loops: false, program: ['R', 'R', 'D', 'L'], solution: ['R', 'R', 'D', 'D'] },
};

/**
 * Build a puzzle for a level, and say how many attempts it took (for the tests).
 * @param {number} level
 * @param {Rng} rng
 * @returns {{ puzzle: Puzzle, attempts: number, fallback: boolean }}
 */
export function generate(level, rng) {
  const rules = rulesFor(level);
  const build = rules.mode === 'board' ? boardPuzzle : rules.mode === 'moves' ? movesPuzzle : debugPuzzle;
  for (let attempts = 1; attempts <= TRIES; attempts++) {
    const puzzle = build(rules, rng);
    if (puzzle) return { puzzle, attempts, fallback: false };
  }
  return { puzzle: structuredClone(FALLBACK[rules.mode]), attempts: TRIES, fallback: true };
}
