// Tiny DOM helpers shared by the screens.

/**
 * Create an element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{ className?: string, text?: string, label?: string }} [options]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, options = {}, children = []) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.label) el.setAttribute('aria-label', options.label);
  if (el instanceof HTMLButtonElement) el.type = 'button';
  el.append(...children);
  return el;
}

/**
 * Call `onDone` after the element is pressed and held for `ms`. Shows progress via the CSS variable
 * --hold (0 → 1). Lifting the finger, moving off, or the system cancelling the touch all abort it.
 * @param {HTMLElement} el
 * @param {number} ms
 * @param {() => void} onDone
 * @returns {() => void} Removes the listeners.
 */
export function onHold(el, ms, onDone) {
  /** @type {number | undefined} */
  let frame;
  let start = 0;

  const reset = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    el.style.setProperty('--hold', '0');
    el.classList.remove('holding');
  };

  const tick = () => {
    const progress = Math.min(1, (performance.now() - start) / ms);
    el.style.setProperty('--hold', String(progress));
    if (progress >= 1) {
      reset();
      onDone();
    } else {
      frame = requestAnimationFrame(tick);
    }
  };

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.button !== 0) return;
    start = performance.now();
    el.classList.add('holding');
    frame = requestAnimationFrame(tick);
  };

  el.addEventListener('pointerdown', down);
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(type, reset);
  return () => {
    reset();
    el.removeEventListener('pointerdown', down);
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) el.removeEventListener(type, reset);
  };
}
