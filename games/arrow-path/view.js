// Arrow Path's screen: draws the board and the controls, handles taps, and animates the robot's walk.
// The walk itself comes from engine.js, so the screen only shows what the tested rules say.

import { DIRS, WORDS, isDir, isToken, key, repeatWorks, runProgram, walkArrows } from './engine.js';

/** @typedef {import('./engine.js').Puzzle} Puzzle */
/** @typedef {import('./engine.js').Dir} Dir */
/** @typedef {import('./engine.js').Token} Token */
/** @typedef {import('./engine.js').Step} Step */
/** @typedef {import('./engine.js').Result} Result */

/** @type {Record<Exclude<Result, 'treasure'>, string>} What 🔊 says after a walk that didn't reach the gem. */
export const HINTS = {
  rock: 'Oops, a rock! Try again.',
  edge: 'Oops! Try again.',
  loop: 'Round and round! Try again.',
  end: 'Not there yet. Try again.',
};

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h14M12 5.5l6.5 6.5-6.5 6.5" ' +
  'fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Board mode: each tap on a square turns its arrow to the next way, then back to empty. */
const CYCLE = /** @type {const} */ ([undefined, 'R', 'D', 'L', 'U']);

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
 * @param {Dir} d
 * @param {string} [className]
 * @returns {HTMLSpanElement}
 */
function arrow(d, className = 'ap-arrow') {
  const span = make('span', `${className} ap-${d}`);
  span.innerHTML = ARROW_SVG; // a fixed string, never user text
  return span;
}

/**
 * Restore saved board arrows, keeping only ones that still make sense for this puzzle.
 * @param {Puzzle} p
 * @param {unknown} saved
 * @returns {Record<string, Dir>}
 */
function restoreArrows(p, saved) {
  /** @type {Record<string, Dir>} */
  const arrows = {};
  const arrowsIn = /** @type {{ arrows?: unknown } | null} */ (saved)?.arrows;
  if (!arrowsIn || typeof arrowsIn !== 'object') return arrows;
  const blocked = new Set([key(...p.start), key(...p.gem), ...p.rocks.map(([r, c]) => key(r, c))]);
  for (const [k, d] of Object.entries(arrowsIn)) {
    const [r, c] = k.split(',').map(Number);
    if (isDir(d) && r >= 0 && c >= 0 && r < p.rows && c < p.cols && !blocked.has(k)) arrows[k] = d;
  }
  return arrows;
}

/**
 * Restore a saved move list, or start from the puzzle's list (debug) or an empty one.
 * @param {Puzzle} p
 * @param {unknown} saved
 * @returns {Token[]}
 */
function restoreProgram(p, saved) {
  const list = /** @type {{ program?: unknown } | null} */ (saved)?.program;
  const ok = Array.isArray(list) && list.length <= (p.slots ?? 0) &&
    list.every((t) => isToken(t) && (p.loops || isDir(t)));
  return ok ? /** @type {Token[]} */ (list.slice()) : (p.program ?? []).slice();
}

/**
 * Draw the puzzle into `el`.
 * @param {HTMLElement} el
 * @param {Puzzle} p
 * @param {import('../../js/core/games.js').PlayApi} api
 * @returns {import('../../js/core/games.js').Mounted}
 */
export function mountView(el, p, api) {
  const board = p.mode === 'board';
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const stepMs = reduced ? 60 : 380;
  /** @type {number[]} */
  const timers = [];
  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
  let busy = false;

  const arrows = board ? restoreArrows(p, api.state) : {};
  const program = board ? [] : restoreProgram(p, api.state);
  let selected = -1;
  const save = () => api.saveState(board ? { arrows: { ...arrows } } : { program: program.slice() });

  el.replaceChildren();
  const wrap = make('div', `ap ${board ? 'ap-mode-board' : 'ap-mode-list'}`);
  const grid = make('div', 'ap-grid');
  wrap.style.setProperty('--cols', String(p.cols)); // on the wrapper, so the square size (--cell) can use them
  wrap.style.setProperty('--rows', String(p.rows));
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Board');

  const rocks = new Set(p.rocks.map(([r, c]) => key(r, c)));

  /** @param {HTMLButtonElement} button @param {number} r @param {number} c */
  const drawSquare = (button, r, c) => {
    const d = arrows[key(r, c)];
    button.replaceChildren(...(d ? [arrow(d)] : []));
    button.setAttribute('aria-label', `Square ${r + 1}, ${c + 1}${d ? `, ${WORDS[d]} arrow` : ''}`);
  };

  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const k = key(r, c);
      const isStart = r === p.start[0] && c === p.start[1];
      const isGem = r === p.gem[0] && c === p.gem[1];
      /** @type {HTMLElement} */
      let cell;
      if (rocks.has(k)) {
        cell = make('div', 'ap-cell ap-rock', 'Rock');
        cell.textContent = '🪨';
      } else if (isGem) {
        cell = make('div', 'ap-cell ap-gem', 'Gem');
        cell.textContent = '💎';
      } else if (board && !isStart) {
        const button = make('button', 'ap-cell ap-tap');
        drawSquare(button, r, c);
        button.addEventListener('click', () => {
          if (busy) return;
          const now = CYCLE.indexOf(arrows[k]);
          const next = CYCLE[(now + 1) % CYCLE.length];
          if (next) arrows[k] = next;
          else delete arrows[k];
          drawSquare(button, r, c);
          save();
        });
        cell = button;
      } else {
        cell = make('div', `ap-cell${isStart ? ' ap-start' : ''}`);
      }
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      grid.append(cell);
    }
  }

  const robot = make('div', 'ap-robot', 'Robot');
  robot.style.setProperty('--step', `${stepMs}ms`);
  const bot = make('span', 'ap-bot');
  bot.textContent = '🤖';
  let face = arrow(p.facing, 'ap-face');
  robot.append(bot, face);
  grid.append(robot);

  /** @param {Step | { r: number, c: number, d: Dir }} at @param {boolean} [instant] */
  const placeRobot = (at, instant = false) => {
    if (instant) robot.classList.add('ap-instant');
    robot.style.setProperty('--r', String(at.r));
    robot.style.setProperty('--c', String(at.c));
    const turned = arrow(at.d, 'ap-face');
    face.replaceWith(turned);
    face = turned;
    if (instant) {
      void robot.offsetWidth; // apply the jump before turning the animation back on
      robot.classList.remove('ap-instant');
    }
  };
  const home = { r: p.start[0], c: p.start[1], d: p.facing };
  placeRobot(home, true);

  const go = make('button', 'big-button ap-go', 'Go');
  go.textContent = '▶ Go';

  // ---- Move list (moves and debug modes) ----
  const slots = make('div', 'ap-slots');
  slots.setAttribute('role', 'group');
  slots.setAttribute('aria-label', 'Moves');
  /** @type {HTMLButtonElement[]} */
  const slotButtons = [];

  const drawSlots = () => {
    slotButtons.forEach((button, i) => {
      const t = program[i];
      button.classList.toggle('ap-selected', i === selected);
      button.classList.toggle('ap-empty', t === undefined);
      button.classList.toggle('ap-idle', t !== undefined && !isDir(t) && !repeatWorks(program, i));
      button.setAttribute('aria-pressed', String(i === selected));
      if (t === undefined) {
        button.replaceChildren();
        button.setAttribute('aria-label', `Move ${i + 1}, empty`);
      } else if (isDir(t)) {
        button.replaceChildren(arrow(t));
        button.setAttribute('aria-label', `Move ${i + 1}, ${WORDS[t]}`);
      } else {
        const times = t === 'x3' ? '3' : '2';
        const icon = make('span', 'ap-loop-icon');
        icon.textContent = '🔁';
        const n = make('span', 'ap-loop-n');
        n.textContent = `×${times}`;
        button.replaceChildren(icon, n);
        button.setAttribute('aria-label', `Move ${i + 1}, repeat ${times} times`);
      }
    });
  };

  /** @param {HTMLElement} target */
  const wiggle = (target) => {
    target.classList.remove('wiggle');
    void target.offsetWidth; // restart the animation
    target.classList.add('wiggle');
  };

  /** @param {Token} t */
  const put = (t) => {
    if (busy) return;
    if (selected >= 0 && selected < program.length) {
      program[selected] = t;
      selected = -1;
    } else if (program.length < (p.slots ?? 0)) {
      program.push(t);
    } else {
      wiggle(slots); // full
      return;
    }
    drawSlots();
    save();
  };

  /** @type {HTMLElement[]} */
  const controls = [];
  if (!board) {
    for (let i = 0; i < (p.slots ?? 0); i++) {
      const button = make('button', 'ap-slot');
      button.dataset.i = String(i);
      button.addEventListener('click', () => {
        if (busy) return;
        selected = i < program.length && selected !== i ? i : -1;
        drawSlots();
      });
      slotButtons.push(button);
      slots.append(button);
    }
    drawSlots();

    const keys = make('div', 'ap-keys');
    for (const d of DIRS) {
      const button = make('button', 'big-button ap-key', WORDS[d][0].toUpperCase() + WORDS[d].slice(1));
      button.dataset.token = d;
      button.append(arrow(d));
      button.addEventListener('click', () => put(d));
      keys.append(button);
    }
    if (p.loops) {
      for (const t of /** @type {const} */ (['x2', 'x3'])) {
        const times = t === 'x3' ? '3' : '2';
        const button = make('button', 'big-button ap-key ap-key-loop', `Repeat ${times} times`);
        button.dataset.token = t;
        const icon = make('span', 'ap-loop-icon');
        icon.textContent = '🔁';
        const n = make('span', 'ap-loop-n');
        n.textContent = `×${times}`;
        button.append(icon, n);
        button.addEventListener('click', () => put(t));
        keys.append(button);
      }
    }
    const remove = make('button', 'big-button ap-key ap-remove', 'Take away');
    remove.textContent = '✖';
    remove.addEventListener('click', () => {
      if (busy || program.length === 0) return;
      program.splice(selected >= 0 && selected < program.length ? selected : program.length - 1, 1);
      selected = -1;
      drawSlots();
      save();
    });
    keys.append(remove, go);
    const panel = make('div', 'ap-panel');
    panel.append(slots, keys);
    controls.push(panel);
  } else {
    controls.push(go);
  }

  // ---- The walk ----
  const reset = () => {
    for (const b of slotButtons) b.classList.remove('ap-running', 'ap-wrong', 'wiggle');
    robot.classList.remove('ap-bump', 'ap-happy');
  };

  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    selected = -1;
    if (!board) drawSlots();
    reset();
    wrap.classList.add('ap-busy');
    const walk = board ? walkArrows(p, arrows) : runProgram(p, program);
    const { path } = walk;
    for (let k = 1; k < path.length; k++) {
      later(() => {
        placeRobot(path[k]);
        slotButtons.forEach((b, i) => b.classList.toggle('ap-running', i === path[k].i));
      }, (k - 1) * stepMs);
    }
    const end = Math.max(0, path.length - 1) * stepMs;
    if (walk.result === 'treasure') {
      later(() => robot.classList.add('ap-happy'), end);
      later(() => api.solved(), end + 450);
      return;
    }
    const hint = HINTS[walk.result];
    later(() => {
      for (const b of slotButtons) b.classList.remove('ap-running');
      const wrong = slotButtons[walk.failAt];
      if (wrong) {
        wrong.classList.add('ap-wrong');
        wiggle(wrong);
      }
      robot.classList.add('ap-bump');
      api.setInstruction(hint);
    }, end);
    later(() => {
      placeRobot(home, true);
      robot.classList.remove('ap-bump');
      wrap.classList.remove('ap-busy');
      busy = false;
    }, end + 900);
  });

  wrap.append(grid, ...controls);
  el.append(wrap);

  return {
    destroy() {
      for (const t of timers) clearTimeout(t);
      el.replaceChildren();
    },
  };
}
