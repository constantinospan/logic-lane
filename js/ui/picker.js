// Difficulty picker, shown before every game (D14). If there's a fresh save for this game, a big
// "Continue" button comes first.

import { h } from './dom.js';
import { createTopBar } from './topbar.js';
import { startLevel } from '../core/ladder.js';
import { newSeed } from '../core/rng.js';
import { versionOf } from '../core/games.js';

/** @type {{ id: import('../core/ladder.js').Difficulty, icon: string, word: string }[]} */
const CHOICES = [
  { id: 'easy', icon: '🐣', word: 'Easy' },
  { id: 'medium', icon: '🐥', word: 'Medium' },
  { id: 'hard', icon: '🦅', word: 'Hard' },
];

/**
 * @param {HTMLElement} root
 * @param {import('../core/games.js').Game} game
 * @param {import('../core/storage.js').Store} store
 * @returns {() => void} cleanup
 */
export function renderPicker(root, game, store) {
  const bar = createTopBar({ onHome: () => (location.hash = '#/') });
  bar.setLevel(null);
  bar.setInstruction('Pick easy, medium or hard.');

  const buttons = h('div', { className: 'choices' });

  const saved = store.load(versionOf);
  if (saved && saved.gameId === game.id) {
    const resume = h('button', { className: 'big-button choice choice-continue' }, [
      h('span', { className: 'choice-icon', text: '▶️' }),
      h('span', { text: 'Continue' }),
    ]);
    resume.addEventListener('click', () => {
      store.save({ ...saved, active: true });
      location.hash = `#/play/${game.id}`;
    });
    buttons.append(resume);
  }

  for (const choice of CHOICES) {
    const button = h('button', { className: `big-button choice choice-${choice.id}` }, [
      h('span', { className: 'choice-icon', text: choice.icon }),
      h('span', { text: choice.word }),
    ]);
    button.addEventListener('click', () => {
      store.save({
        gameId: game.id,
        gameVersion: game.version,
        level: startLevel(game.ladder, choice.id),
        n: 0,
        seed: newSeed(),
        state: null,
        active: true,
      });
      location.hash = `#/play/${game.id}`;
    });
    buttons.append(button);
  }

  const heading = h('h1', { className: 'picker-title' }, [
    h('span', { className: 'picker-icon', text: game.icon }),
    h('span', { text: game.title }),
  ]);

  root.replaceChildren(bar.el, h('main', { className: 'screen picker' }, [heading, buttons]));
  return () => bar.destroy();
}
