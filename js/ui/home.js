// Home: big tiles, one per game (D11). Holding the title for 3 s opens the parent-only reset (D16).

import { h, onHold } from './dom.js';
import { COMING_SOON, GAMES } from '../core/games.js';

/**
 * @param {HTMLElement} root
 * @returns {() => void} cleanup
 */
export function renderHome(root) {
  const title = h('h1', { className: 'home-title', text: 'Logic Lane' });
  const stopHold = onHold(title, 3000, () => {
    location.hash = '#/reset';
  });

  const greeting = h('p', { className: 'home-greeting', text: "Let's play!" });

  const tiles = h('div', { className: 'tiles' });
  for (const game of GAMES.filter((g) => !g.hidden)) {
    const tile = h('a', { className: 'tile' }, [
      h('span', { className: 'tile-icon', text: game.icon }),
      h('span', { className: 'tile-title', text: game.title }),
    ]);
    tile.href = `#/game/${game.id}`;
    tiles.append(tile);
  }
  for (const soon of COMING_SOON) {
    tiles.append(
      h('div', { className: 'tile tile-soon', label: `${soon.title}, coming soon` }, [
        h('span', { className: 'tile-icon', text: soon.icon }),
        h('span', { className: 'tile-title', text: soon.title }),
        h('span', { className: 'tile-badge', text: 'Soon' }),
      ]),
    );
  }

  root.replaceChildren(h('main', { className: 'screen home' }, [title, greeting, tiles]));
  return stopHold;
}
