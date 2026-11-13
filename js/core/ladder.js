// One ladder of levels per game (D14). Easy / Medium / Hard are starting points on it.
// After the top level, puzzles keep coming at max difficulty (endless).

/** @typedef {'easy' | 'medium' | 'hard'} Difficulty */

/**
 * @typedef {object} Ladder
 * @property {number} levels  Top level, e.g. 30.
 * @property {number} puzzlesPerLevel  Puzzles to solve before moving up a level.
 * @property {Record<Difficulty, number>} starts  Starting level for each difficulty.
 */

/** @type {Difficulty[]} */
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * @param {Ladder} ladder
 * @param {Difficulty} difficulty
 * @returns {number}
 */
export function startLevel(ladder, difficulty) {
  return ladder.starts[difficulty];
}

/**
 * The puzzle after this one.
 * @param {Ladder} ladder
 * @param {{ level: number, n: number }} position
 * @returns {{ level: number, n: number }}
 */
export function nextPosition(ladder, { level, n }) {
  if (level >= ladder.levels) return { level: ladder.levels, n: n + 1 }; // endless top
  if (n + 1 < ladder.puzzlesPerLevel) return { level, n: n + 1 };
  return { level: level + 1, n: 0 };
}

/**
 * Throws if a game's ladder is inconsistent. Used by the registry and tests.
 * @param {Ladder} ladder
 */
export function assertValidLadder(ladder) {
  const { levels, puzzlesPerLevel, starts } = ladder;
  if (!Number.isInteger(levels) || levels < 1) throw new Error('ladder.levels must be a positive integer');
  if (!Number.isInteger(puzzlesPerLevel) || puzzlesPerLevel < 1) {
    throw new Error('ladder.puzzlesPerLevel must be a positive integer');
  }
  let previous = 0;
  for (const d of DIFFICULTIES) {
    const s = starts[d];
    if (!Number.isInteger(s) || s < 1 || s > levels) throw new Error(`ladder.starts.${d} must be 1..${levels}`);
    if (s <= previous) throw new Error('ladder.starts must increase: easy < medium < hard');
    previous = s;
  }
}
