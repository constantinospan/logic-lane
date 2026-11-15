// Arrow Path's rules of movement. Pure functions, no DOM: the screen animates what these return, and the generator
// and the tests use the same code, so what she sees is what's tested.

/** @typedef {'R' | 'D' | 'L' | 'U'} Dir */
/** @typedef {Dir | 'x2' | 'x3'} Token  One slot in the move list: an arrow, or 🔁 repeating the arrow before it. */
/** @typedef {[number, number]} Cell  [row, column], 0-based. */
/** @typedef {'treasure' | 'rock' | 'edge' | 'loop' | 'end'} Result */

/**
 * @typedef {object} Puzzle
 * @property {import('./levels.js').Mode} mode
 * @property {number} cols
 * @property {number} rows
 * @property {Cell} start
 * @property {Dir} facing  The way the robot faces at the start (board mode: the way it walks first).
 * @property {Cell} gem
 * @property {Cell[]} rocks
 * @property {number} [slots]  moves / debug: how many moves fit in the list.
 * @property {boolean} [loops]  moves / debug: the palette has 🔁×2 and 🔁×3.
 * @property {Token[]} [program]  debug: the almost-right list she starts with.
 * @property {Record<string, Dir> | Token[]} solution  One working answer (board: arrows by cell key; else a list).
 */

/**
 * One position on a walk.
 * @typedef {object} Step
 * @property {number} r
 * @property {number} c
 * @property {Dir} d  The way the robot faces here.
 * @property {number} i  The move-list slot doing this step (-1 for the start and for board mode).
 */

/**
 * @typedef {object} Walk
 * @property {Step[]} path  Where the robot goes, starting at the start.
 * @property {Result} result
 * @property {number} failAt  moves / debug: the slot where it went wrong (-1 if none, or board mode).
 */

/** @type {Dir[]} */
export const DIRS = ['R', 'D', 'L', 'U'];

/** @type {Record<Dir, [number, number]>} */
export const DELTA = { R: [0, 1], D: [1, 0], L: [0, -1], U: [-1, 0] };

/** @type {Record<Dir, string>} Words for screen readers and 🔊. */
export const WORDS = { R: 'right', D: 'down', L: 'left', U: 'up' };

/**
 * @param {number} r
 * @param {number} c
 * @returns {string}
 */
export const key = (r, c) => `${r},${c}`;

/**
 * @param {unknown} t
 * @returns {t is Dir}
 */
export const isDir = (t) => t === 'R' || t === 'D' || t === 'L' || t === 'U';

/**
 * @param {unknown} t
 * @returns {t is Token}
 */
export const isToken = (t) => isDir(t) || t === 'x2' || t === 'x3';

/**
 * Does this 🔁 repeat anything? Only when the slot right before it is an arrow.
 * @param {readonly Token[]} program
 * @param {number} i
 * @returns {boolean}
 */
export function repeatWorks(program, i) {
  return i > 0 && isDir(program[i - 1]);
}

/**
 * The grid's blocked squares, for quick lookups.
 * @param {Puzzle} p
 * @returns {Set<string>}
 */
function rockSet(p) {
  return new Set(p.rocks.map(([r, c]) => key(r, c)));
}

/**
 * Board mode: the robot walks straight and turns when it steps on an arrow. Arrows on the start square are ignored
 * (the screen never allows them).
 * @param {Puzzle} p
 * @param {Readonly<Record<string, Dir>>} arrows  By cell key.
 * @returns {Walk}
 */
export function walkArrows(p, arrows) {
  const rocks = rockSet(p);
  let [r, c] = p.start;
  let d = p.facing;
  /** @type {Step[]} */
  const path = [{ r, c, d, i: -1 }];
  const seen = new Set([`${key(r, c)}:${d}`]);
  for (;;) {
    const [dr, dc] = DELTA[d];
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= p.rows || nc >= p.cols) return { path, result: 'edge', failAt: -1 };
    if (rocks.has(key(nr, nc))) return { path, result: 'rock', failAt: -1 };
    r = nr;
    c = nc;
    if (r === p.gem[0] && c === p.gem[1]) {
      path.push({ r, c, d, i: -1 });
      return { path, result: 'treasure', failAt: -1 };
    }
    const turn = arrows[key(r, c)];
    if (turn && !(r === p.start[0] && c === p.start[1])) d = turn;
    path.push({ r, c, d, i: -1 });
    const state = `${key(r, c)}:${d}`;
    if (seen.has(state)) return { path, result: 'loop', failAt: -1 }; // round and round forever
    seen.add(state);
  }
}

/**
 * The single steps a move list makes, with the slot each comes from. 🔁×n after an arrow makes n moves in total
 * (the arrow once, then n − 1 more). A 🔁 with no arrow right before it does nothing.
 * @param {readonly Token[]} program
 * @returns {{ d: Dir, i: number }[]}
 */
export function expand(program) {
  /** @type {{ d: Dir, i: number }[]} */
  const moves = [];
  program.forEach((t, i) => {
    if (isDir(t)) {
      moves.push({ d: t, i });
    } else if (repeatWorks(program, i)) {
      const d = /** @type {Dir} */ (program[i - 1]);
      const extra = t === 'x3' ? 2 : 1;
      for (let k = 0; k < extra; k++) moves.push({ d, i });
    }
  });
  return moves;
}

/**
 * Moves / debug mode: run the list. It stops as soon as the robot reaches the gem.
 * @param {Puzzle} p
 * @param {readonly Token[]} program
 * @returns {Walk}
 */
export function runProgram(p, program) {
  const rocks = rockSet(p);
  let [r, c] = p.start;
  /** @type {Step[]} */
  const path = [{ r, c, d: p.facing, i: -1 }];
  for (const { d, i } of expand(program)) {
    const [dr, dc] = DELTA[d];
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= p.rows || nc >= p.cols) return { path, result: 'edge', failAt: i };
    if (rocks.has(key(nr, nc))) return { path, result: 'rock', failAt: i };
    r = nr;
    c = nc;
    path.push({ r, c, d, i });
    if (r === p.gem[0] && c === p.gem[1]) return { path, result: 'treasure', failAt: -1 };
  }
  return { path, result: 'end', failAt: program.length - 1 };
}
