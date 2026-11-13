// Parent-only emergency reset (D16). Reached by holding the home title for 3 s, then confirmed by holding
// "Reset" for another 3 s. Only runs online: clearing the cache offline would leave a blank app.

import { h, onHold } from './dom.js';
import { clearAppCaches } from '../pwa/update.js';

/**
 * @param {HTMLElement} root
 * @param {import('../core/storage.js').Store} store
 * @returns {() => void} cleanup
 */
export function renderReset(root, store) {
  const message = h('p', { className: 'reset-text', text: 'Fix a stuck app? Hold Reset.' });
  const reset = h('button', { className: 'big-button reset-button', text: 'Reset' });
  const back = h('button', { className: 'big-button', text: 'Back' });
  back.addEventListener('click', () => (location.hash = '#/'));

  const stopHold = onHold(reset, 3000, async () => {
    if (!navigator.onLine) {
      message.textContent = 'Needs internet. Try again later.';
      return;
    }
    message.textContent = 'Resetting…';
    store.clearAll();
    await clearAppCaches();
    location.replace('./');
  });

  root.replaceChildren(
    h('main', { className: 'screen reset' }, [h('h1', { text: 'Reset' }), message, reset, back]),
  );
  return stopHold;
}
