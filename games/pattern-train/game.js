// Pattern train (D13, D28): spot the pattern on the train and tap the shape that fills the empty carriage.
// Levels 1–16: what comes next. 17–20: a gap in the middle. 21–24: 3D shapes. 25–30: two things change at once.

import { generate } from './generate.js';
import { ASK, rulesFor } from './levels.js';
import { mountView } from './view.js';

/**
 * What 🔊 reads at a level. On levels where the gap can be anywhere, the screen says "next" when it's at the end.
 * @param {number} level
 * @returns {string}
 */
function instruction(level) {
  return rulesFor(level).gap === 'end' ? ASK.next : ASK.missing;
}

/** @type {import('../../js/core/games.js').Game} */
const patternTrain = {
  id: 'pattern-train',
  title: 'Pattern Train',
  icon: '🚂',
  version: 1,
  ladder: { levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } },
  instruction,
  createPuzzle: (level, rng) => generate(level, rng).puzzle,
  mount: (el, puzzle, api) => mountView(el, puzzle, api),
};

export default patternTrain;
