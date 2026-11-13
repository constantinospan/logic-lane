// The game registry and the contract every game implements. See docs/GAME-API.md.

import { assertValidLadder } from './ladder.js';
import demo from '../../games/demo/game.js';

/**
 * What a game gets from the shell while a puzzle is on screen.
 * @typedef {object} PlayApi
 * @property {unknown} state  Saved progress inside this puzzle (from saveState), or null for a fresh puzzle.
 * @property {(state: unknown) => void} saveState  Call after each meaningful move, so a reload resumes here.
 * @property {() => void} solved  Call once when the puzzle is solved. The shell celebrates and moves on.
 * @property {(text: string) => void} setInstruction  Change what 🔊 reads (e.g. a hint). Short, simple words.
 */

/**
 * @typedef {object} Mounted
 * @property {() => void} destroy  Remove listeners, timers and anything else the game started.
 */

/**
 * @typedef {object} Game
 * @property {string} id  URL-safe id, e.g. "arrow-path".
 * @property {string} title  One or two simple words, shown on the home tile.
 * @property {string} icon  An emoji for the tile.
 * @property {number} version  Bump when createPuzzle changes, so old saves (old seeds) are dropped.
 * @property {boolean} [hidden]  Not shown on the home screen (e.g. the demo game).
 * @property {import('./ladder.js').Ladder} ladder
 * @property {(level: number) => string} instruction  Default text for 🔊 at this level.
 * @property {(level: number, rng: import('./rng.js').Rng) => unknown} createPuzzle  Must be deterministic:
 *   the same rng (same seed and level) always gives the same puzzle.
 * @property {(el: HTMLElement, puzzle: any, api: PlayApi) => Mounted} mount  Draw the puzzle into `el`.
 */

/**
 * Games that aren't built yet, shown on the home screen as "Soon".
 * @type {{ id: string, title: string, icon: string }[]}
 */
export const COMING_SOON = [{ id: 'arrow-path', title: 'Arrow Path', icon: '🧭' }];

/** @type {Game[]} */
export const GAMES = [demo];

for (const game of GAMES) assertValidLadder(game.ladder);

/**
 * @param {string} id
 * @returns {Game | undefined}
 */
export function findGame(id) {
  return GAMES.find((g) => g.id === id);
}

/**
 * @param {string} id
 * @returns {number | undefined}
 */
export function versionOf(id) {
  return findGame(id)?.version;
}
