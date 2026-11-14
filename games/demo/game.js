// Hidden demo game: "tap the matching picture". It exists to exercise the shared base (ladder, seeds,
// resume, celebration, speaker) for tests and the AI reviewers. Not shown on the home screen.

/** @typedef {{ emoji: string, word: string }} Thing */

/** @type {Thing[]} */
const THINGS = [
  { emoji: '⭐', word: 'star' },
  { emoji: '❤️', word: 'heart' },
  { emoji: '🌙', word: 'moon' },
  { emoji: '☀️', word: 'sun' },
  { emoji: '🌸', word: 'flower' },
  { emoji: '🐟', word: 'fish' },
  { emoji: '🍎', word: 'apple' },
  { emoji: '⚽', word: 'ball' },
];

/**
 * @typedef {object} DemoPuzzle
 * @property {Thing} target
 * @property {Thing[]} choices
 */

/** @type {import('../../js/core/games.js').Game} */
const demo = {
  id: 'demo',
  title: 'Demo',
  icon: '🧪',
  version: 1,
  hidden: true,
  ladder: { levels: 30, puzzlesPerLevel: 3, starts: { easy: 1, medium: 11, hard: 21 } },

  instruction: () => 'Tap the same picture.',

  createPuzzle(level, rng) {
    const count = Math.min(THINGS.length, 2 + Math.floor((level - 1) / 5)); // 2 choices at level 1, 7 at level 30
    const choices = rng.shuffle(THINGS).slice(0, count);
    /** @type {DemoPuzzle} */
    const puzzle = { target: rng.pick(choices), choices };
    return puzzle;
  },

  mount(el, puzzle, api) {
    /** @type {DemoPuzzle} */
    const p = puzzle;
    const state = /** @type {{ wrong: number } | null} */ (api.state) ?? { wrong: 0 };

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'demo';

    const target = document.createElement('div');
    target.className = 'demo-target';
    target.textContent = p.target.emoji;
    target.setAttribute('aria-label', p.target.word);

    const grid = document.createElement('div');
    grid.className = 'demo-choices';
    for (const thing of p.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'big-button demo-choice';
      button.textContent = thing.emoji;
      button.setAttribute('aria-label', thing.word);
      button.addEventListener('click', () => {
        if (thing === p.target) {
          api.solved();
        } else {
          state.wrong += 1;
          api.saveState(state);
          api.setInstruction(`Try again. Find the ${p.target.word}.`);
          button.classList.remove('wiggle');
          void button.offsetWidth; // restart the animation
          button.classList.add('wiggle');
        }
      });
      grid.append(button);
    }

    wrap.append(target, grid);
    el.append(wrap);
    return { destroy: () => el.replaceChildren() };
  },
};

export default demo;
