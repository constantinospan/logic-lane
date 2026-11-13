// Top bar: 🏠 Home (left), level indicator (middle), 🔊 Speaker (right). The speaker reads the current
// instruction (D10, option B: one speaker in the top bar).

import { h, onHold } from './dom.js';
import { canSpeak, speak } from '../core/speech.js';

/**
 * @param {{ onHome: () => void }} options
 */
export function createTopBar({ onHome }) {
  let instruction = '';
  /** @type {number | undefined} */
  let seedTimer;
  let seedText = '';

  const home = h('button', { className: 'icon-button', text: '🏠', label: 'Home' });
  home.addEventListener('click', onHome);

  const levelLabel = h('span', { className: 'level-label' });
  const dots = h('span', { className: 'level-dots', label: '' });
  const seed = h('span', { className: 'level-seed' });
  const level = h('div', { className: 'level' }, [levelLabel, dots, seed]);

  // Long-press the level to show level · seed for 5 s, for bug reports (D12). Invisible in normal play.
  const stopHold = onHold(level, 800, () => {
    seed.textContent = seedText;
    level.classList.add('show-seed');
    clearTimeout(seedTimer);
    seedTimer = window.setTimeout(() => level.classList.remove('show-seed'), 5000);
  });

  const speaker = h('button', { className: 'icon-button', text: '🔊', label: 'Read it to me' });
  speaker.addEventListener('click', () => speak(instruction)); // must stay inside the tap for iOS
  if (!canSpeak()) speaker.hidden = true;

  const el = h('header', { className: 'topbar' }, [home, level, speaker]);

  return {
    el,
    /** @param {string} text */
    setInstruction(text) {
      instruction = text;
    },
    /**
     * @param {{ level: number, n: number, perLevel: number, seed: string } | null} info  null hides it.
     */
    setLevel(info) {
      level.hidden = info === null;
      if (!info) return;
      levelLabel.textContent = `Level ${info.level}`;
      const done = Math.min(info.n, info.perLevel);
      dots.textContent = '●'.repeat(done) + '○'.repeat(Math.max(0, info.perLevel - done));
      seedText = `${info.level} · ${info.seed}`;
    },
    /** @param {boolean} visible */
    showSpeaker(visible) {
      speaker.hidden = !visible || !canSpeak();
    },
    destroy() {
      stopHold();
      clearTimeout(seedTimer);
    },
  };
}
