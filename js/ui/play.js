// Runs a game: rebuilds the puzzle from the saved seed, mounts it, saves progress, celebrates, moves on.

import { h } from './dom.js';
import { createTopBar } from './topbar.js';
import { celebrate } from './celebrate.js';
import { createRng, newSeed } from '../core/rng.js';
import { nextPosition } from '../core/ladder.js';
import { stopSpeaking } from '../core/speech.js';

/**
 * @param {HTMLElement} root
 * @param {import('../core/games.js').Game} game
 * @param {import('../core/storage.js').ResumeRecord} startRecord  A fresh save for this game.
 * @param {import('../core/storage.js').Store} store
 * @returns {() => void} cleanup
 */
export function renderPlay(root, game, startRecord, store) {
  let record = { ...startRecord, active: true };
  /** @type {import('../core/games.js').Mounted | null} */
  let mounted = null;
  /** @type {(() => void) | null} */
  let cancelCelebration = null;

  const bar = createTopBar({
    onHome: () => {
      store.save({ ...record, active: false }); // keep it for "Continue", but don't auto-resume on startup
      location.hash = '#/';
    },
  });
  const area = h('main', { className: 'screen play' });
  root.replaceChildren(bar.el, area);

  const save = () => store.save(record);

  const showPuzzle = () => {
    mounted?.destroy();
    const puzzle = game.createPuzzle(record.level, createRng(record.seed, record.level));
    bar.setLevel({
      level: record.level,
      n: record.n % game.ladder.puzzlesPerLevel,
      perLevel: game.ladder.puzzlesPerLevel,
      seed: record.seed,
    });
    bar.setInstruction(game.instruction(record.level));
    let solvedOnce = false;
    mounted = game.mount(area, puzzle, {
      state: record.state,
      saveState: (state) => {
        record = { ...record, state };
        save();
      },
      setInstruction: (text) => bar.setInstruction(text),
      solved: () => {
        if (solvedOnce) return;
        solvedOnce = true;
        // Save the next puzzle first, so a refresh during the celebration doesn't replay this one.
        record = { ...record, ...nextPosition(game.ladder, record), seed: newSeed(), state: null };
        save();
        cancelCelebration = celebrate(root, () => {
          cancelCelebration = null;
          showPuzzle();
        });
      },
    });
    save();
  };

  // Save when the app is hidden or closed, so the 3-hour window counts from the last time she played.
  const onHide = () => {
    if (document.visibilityState === 'hidden') save();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);

  showPuzzle();

  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', save);
    cancelCelebration?.();
    mounted?.destroy();
    bar.destroy();
    stopSpeaking();
  };
}
