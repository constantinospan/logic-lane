// Pattern train's screen: the train with one empty carriage, and the choices under it. A right tap drops the shape into
// the empty carriage and the train toots; a wrong tap wiggles, fades that choice and shows a gentle hint.

import { describe } from './model.js';
import { ENGINE_SVG, loadSvg } from './draw.js';
import { ASK } from './levels.js';

/** @typedef {import('./model.js').Puzzle} Puzzle */
/** @typedef {import('./model.js').Car} Car */
/** @typedef {import('./model.js').Attr} Attr */

/** @type {Record<Attr, string>} what to look at, for the hint */
const LOOK = { colour: 'colours', shape: 'shapes', size: 'sizes', turn: 'where they point' };

/**
 * The hint after a wrong tap: it names what the tapped choice got wrong, out of the things that change along the
 * train (every wrong choice is wrong on at least one of them).
 * @param {Puzzle} p
 * @param {number} tapped
 * @returns {string}
 */
export function hintFor(p, tapped) {
  const right = p.choices[p.answer];
  const choice = p.choices[tapped];
  const wrong = p.changes.filter((a) => choice[a] !== right[a]);
  const look = (wrong.length ? wrong : p.changes).map((a) => LOOK[a]);
  if (look.includes(LOOK.turn)) return 'Not that one. Look where they point.';
  return `Not that one. Look at the ${look.join(' and ')}.`;
}

/**
 * Restore the saved wrong taps, keeping only ones that still make sense for this puzzle.
 * @param {Puzzle} p
 * @param {unknown} saved
 * @returns {number[]}
 */
export function restoreWrong(p, saved) {
  const list = /** @type {{ wrong?: unknown } | null} */ (saved)?.wrong;
  if (!Array.isArray(list)) return [];
  /** @type {number[]} */
  const out = [];
  for (const i of list) {
    if (Number.isInteger(i) && i >= 0 && i < p.choices.length && i !== p.answer && !out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} className
 * @param {string} [label]  Accessible name. On a div, also gives it role="img".
 * @returns {HTMLElementTagNameMap[K]}
 */
function make(tag, className, label) {
  const el = document.createElement(tag);
  el.className = className;
  if (el instanceof HTMLButtonElement) el.type = 'button';
  if (label) {
    el.setAttribute('aria-label', label);
    if (!(el instanceof HTMLButtonElement)) el.setAttribute('role', 'img');
  }
  return el;
}

/**
 * Draw the puzzle into `el`.
 * @param {HTMLElement} el
 * @param {Puzzle} p
 * @param {import('../../js/core/games.js').PlayApi} api
 * @returns {import('../../js/core/games.js').Mounted}
 */
export function mountView(el, p, api) {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const turns = p.changes.includes('turn');
  /** @type {number[]} */
  const timers = [];
  let done = false;
  const wrong = restoreWrong(p, api.state);

  el.replaceChildren();
  const wrap = make('div', 'pt');
  wrap.style.setProperty('--n', String(p.cars.length));
  wrap.style.setProperty('--k', String(p.choices.length));

  // What went wrong, in big simple words. Its space is kept while it's empty, so the train doesn't jump.
  const hintLine = make('p', 'pt-hint');
  hintLine.setAttribute('aria-live', 'polite');
  /** @param {number} tapped */
  const showHint = (tapped) => {
    const hint = hintFor(p, tapped);
    hintLine.textContent = hint;
    api.setInstruction(hint);
  };

  const train = make('div', 'pt-train');
  train.setAttribute('role', 'group');
  train.setAttribute('aria-label', 'Train');
  const engine = make('div', 'pt-engine', 'Engine');
  engine.innerHTML = ENGINE_SVG; // a fixed string
  train.append(engine);

  /** @type {HTMLElement | null} */
  let gapCar = null;
  p.cars.forEach((car, i) => {
    const el = car ? make('div', 'pt-car', describe(car, turns)) : make('div', 'pt-car pt-gap', 'Missing');
    el.dataset.i = String(i);
    const load = make('div', 'pt-load');
    if (car) load.innerHTML = loadSvg(car); // built from the puzzle's own values
    else load.textContent = '?';
    el.append(load);
    if (!car) gapCar = el;
    train.append(el);
  });

  const choices = make('div', 'pt-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Choices');
  p.choices.forEach((car, i) => {
    const button = make('button', 'big-button pt-choice', describe(car, turns));
    button.dataset.i = String(i);
    button.innerHTML = loadSvg(car);
    if (wrong.includes(i)) button.classList.add('pt-tried');
    button.addEventListener('click', () => {
      if (done) return;
      if (i === p.answer) {
        done = true;
        const filled = /** @type {HTMLElement} */ (gapCar);
        filled.classList.replace('pt-gap', 'pt-filled');
        filled.setAttribute('aria-label', describe(car, turns));
        const load = /** @type {HTMLElement} */ (filled.firstElementChild);
        load.innerHTML = loadSvg(car);
        button.classList.add('pt-picked');
        wrap.classList.add('pt-done');
        hintLine.textContent = '';
        timers.push(window.setTimeout(() => api.solved(), reduced ? 250 : 1100));
        return;
      }
      if (!wrong.includes(i)) wrong.push(i);
      api.saveState({ wrong: wrong.slice() });
      button.classList.add('pt-tried');
      button.classList.remove('wiggle');
      void button.offsetWidth; // restart the animation
      button.classList.add('wiggle');
      showHint(i);
    });
    choices.append(button);
  });

  if (wrong.length) showHint(wrong[wrong.length - 1]); // after a reload, the same hint as before
  else api.setInstruction(p.gap === p.cars.length - 1 ? ASK.next : ASK.missing); // where the gap really is

  wrap.append(hintLine, train, choices);
  el.append(wrap);

  return {
    destroy() {
      for (const t of timers) clearTimeout(t);
      el.replaceChildren();
    },
  };
}
