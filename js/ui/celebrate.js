// A short, friendly celebration after each solved puzzle.

import { h } from './dom.js';

const CHEERS = ['Well done!', 'Great!', 'Yes!', 'Super!', 'You did it!'];
const EMOJIS = ['🎉', '🌟', '🥳', '👏', '🏆'];

/**
 * Shows the celebration over `root`, then calls `done`.
 * @param {HTMLElement} root
 * @param {() => void} done
 * @returns {() => void} Cancels it early (e.g. when leaving the screen) without calling `done`.
 */
export function celebrate(root, done) {
  const i = Math.floor(Math.random() * CHEERS.length);
  const overlay = h('div', { className: 'celebrate', label: CHEERS[i] }, [
    h('div', { className: 'celebrate-emoji', text: EMOJIS[i] }),
    h('div', { className: 'celebrate-text', text: CHEERS[i] }),
  ]);
  root.append(overlay);
  const timer = window.setTimeout(() => {
    overlay.remove();
    done();
  }, 1400);
  return () => {
    clearTimeout(timer);
    overlay.remove();
  };
}
