// App shell: routing, startup resume, and app-wide touch behaviour.
// Routes: #/ (home), #/game/<id> (picker), #/play/<id> (play), #/reset (parent-only reset).

import { createStore } from './core/storage.js';
import { findGame, versionOf } from './core/games.js';
import { renderHome } from './ui/home.js';
import { renderPicker } from './ui/picker.js';
import { renderPlay } from './ui/play.js';
import { renderReset } from './ui/reset.js';
import { registerServiceWorker } from './pwa/update.js';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
const store = createStore();

/** @type {(() => void) | null} */
let cleanup = null;

function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);

  const [screen = '', id = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const game = id ? findGame(id) : undefined;

  if (screen === 'game' && game) {
    cleanup = renderPicker(root, game, store);
  } else if (screen === 'play' && game) {
    const saved = store.load(versionOf);
    if (saved && saved.gameId === game.id) {
      cleanup = renderPlay(root, game, saved, store);
    } else {
      location.replace(`#/game/${game.id}`); // nothing to resume: pick a difficulty first
    }
  } else if (screen === 'reset') {
    cleanup = renderReset(root, store);
  } else {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    cleanup = renderHome(root);
  }
}

// An installed app always opens at the start page. If she was mid-game less than 3 hours ago, go straight
// back in (D7).
const startup = store.load(versionOf);
if (startup?.active && (location.hash === '' || location.hash === '#/')) {
  history.replaceState(null, '', `#/play/${startup.gameId}`);
}

// No long-press menus, no double-tap zoom surprises (CSS handles the rest).
document.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('hashchange', route);
route();
registerServiceWorker();
