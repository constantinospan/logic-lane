// Arrow Path's solvers: they prove each generated puzzle is solvable and as hard as its level says (D12).

import { DELTA, DIRS, key } from './engine.js';

/** @typedef {import('./engine.js').Puzzle} Puzzle */
/** @typedef {import('./engine.js').Cell} Cell */
/** @typedef {import('./engine.js').Dir} Dir */

/**
 * @param {Puzzle} p
 * @param {number} r
 * @param {number} c
 * @param {Set<string>} rocks
 */
function open(p, r, c, rocks) {
  return r >= 0 && c >= 0 && r < p.rows && c < p.cols && !rocks.has(key(r, c));
}

/**
 * Board mode: the fewest arrows that get the robot to the gem, and the squares that route crosses.
 *
 * A 0-1 search over (square, facing): walking on costs 0, turning on a square costs 1 (an arrow). Turning isn't
 * allowed on the start square. This treats each visit to a square on its own, while a real arrow stays put and
 * turns the robot every time it passes. Still, the answer is a **lower bound** on the true number: in any walk that
 * reaches the gem, each arrow turns the robot at most once (turning on arrow X twice would put it in the same state,
 * on X facing X's way, twice, and the walk would repeat forever), so a real answer with n arrows is a route this
 * search can find with at most n turns. The generator also
 * has a planned route with exactly the level's turns that never crosses itself, so the planned arrows really work
 * (an upper bound). When the two agree, the true minimum is exactly the level's number of turns.
 * @param {Puzzle} p
 * @returns {{ turns: number, route: Cell[] } | null}  null when the gem can't be reached at all.
 */
export function minTurns(p) {
  const rocks = new Set(p.rocks.map(([r, c]) => key(r, c)));
  /** @param {number} r @param {number} c @param {Dir} d */
  const id = (r, c, d) => `${r},${c},${d}`;
  /** @type {Map<string, number>} */
  const dist = new Map();
  /** @type {Map<string, string>} */
  const prev = new Map();
  const [sr, sc] = p.start;
  const first = id(sr, sc, p.facing);
  dist.set(first, 0);
  /** @type {[number, number, Dir][]} a deque: cost-0 moves go in front, cost-1 moves at the back */
  const deque = [[sr, sc, p.facing]];
  while (deque.length) {
    const [r, c, d] = /** @type {[number, number, Dir]} */ (deque.shift());
    const here = id(r, c, d);
    const cost = /** @type {number} */ (dist.get(here));
    if (r === p.gem[0] && c === p.gem[1]) {
      /** @type {Cell[]} */
      const route = [];
      for (let s = /** @type {string | undefined} */ (here); s; s = prev.get(s)) {
        const [rr, cc] = s.split(',');
        const cell = /** @type {Cell} */ ([Number(rr), Number(cc)]);
        const last = route[route.length - 1];
        if (!last || last[0] !== cell[0] || last[1] !== cell[1]) route.push(cell);
      }
      return { turns: cost, route: route.reverse() };
    }
    const [dr, dc] = DELTA[d];
    /** @type {[number, number, Dir, number][]} */
    const next = [];
    if (open(p, r + dr, c + dc, rocks)) next.push([r + dr, c + dc, d, 0]);
    if (r !== sr || c !== sc) for (const t of DIRS) if (t !== d) next.push([r, c, t, 1]);
    for (const [nr, nc, nd, w] of next) {
      const there = id(nr, nc, nd);
      const known = dist.get(there);
      if (known !== undefined && known <= cost + w) continue;
      dist.set(there, cost + w);
      prev.set(there, here);
      if (w === 0) deque.unshift([nr, nc, nd]);
      else deque.push([nr, nc, nd]);
    }
  }
  return null;
}

/**
 * Moves mode: the shortest route to the gem (plain moves, no repeats).
 * @param {Puzzle} p
 * @returns {Dir[] | null}  The moves, or null when the gem can't be reached.
 */
export function shortestMoves(p) {
  const rocks = new Set(p.rocks.map(([r, c]) => key(r, c)));
  /** @type {Map<string, { from: string, d: Dir } | null>} */
  const came = new Map([[key(...p.start), null]]);
  /** @type {Cell[]} */
  const queue = [p.start];
  while (queue.length) {
    const [r, c] = /** @type {Cell} */ (queue.shift());
    if (r === p.gem[0] && c === p.gem[1]) {
      /** @type {Dir[]} */
      const moves = [];
      for (let step = came.get(key(r, c)); step; step = came.get(step.from)) moves.push(step.d);
      return moves.reverse();
    }
    for (const d of DIRS) {
      const [dr, dc] = DELTA[d];
      const nr = r + dr;
      const nc = c + dc;
      if (!open(p, nr, nc, rocks) || came.has(key(nr, nc))) continue;
      came.set(key(nr, nc), { from: key(r, c), d });
      queue.push([nr, nc]);
    }
  }
  return null;
}
