// Arrow Path (D13, D22): guide the robot 🤖 to the gem 💎 with arrows.
// Levels 1–10: arrows on the board. 11–20: a list of moves (🔁 from 14). 21–30: fix a list that's almost right.

import { generate } from './generate.js';
import { isFirstOfKind, rulesFor } from './levels.js';
import { mountView } from './view.js';

/**
 * What 🔊 reads at a level. The first level of each kind explains what to tap, because she may start there
 * (Medium starts at 11, Hard at 21).
 * @param {number} level
 * @returns {string}
 */
function instruction(level) {
  const rules = rulesFor(level);
  const first = isFirstOfKind(level);
  if (rules.mode === 'board') return first ? 'Tap squares for arrows. Then press Go.' : 'Help the robot get the gem.';
  if (rules.mode === 'moves') {
    if (!first) return 'Help the robot get the gem.';
    return rules.loopRuns ? 'Repeat makes a move again.' : 'Tap arrows. Then press Go.';
  }
  return first ? 'Fix the moves. Then press Go.' : 'Fix the moves. Find the gem.';
}

/** @type {import('../../js/core/games.js').Game} */
const arrowPath = {
  id: 'arrow-path',
  title: 'Arrow Path',
  icon: '🧭',
  version: 1,
  ladder: { levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } },
  instruction,
  createPuzzle: (level, rng) => generate(level, rng).puzzle,
  mount: (el, puzzle, api) => mountView(el, puzzle, api),
};

export default arrowPath;
