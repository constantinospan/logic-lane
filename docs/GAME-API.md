# Adding a game

Every game is one ES module in `games/<id>/game.js` that default-exports a **Game** object. The shared base does
the rest: home tile, difficulty picker, top bar (🏠, level, 🔊), resume after accidents, celebration, the
ladder, and offline support.

The exact contract, with types, is the `Game` typedef in [`js/core/games.js`](../js/core/games.js). The hidden demo game
[`games/demo/game.js`](../games/demo/game.js) is a complete small example.

## Steps
1. Create `games/<id>/game.js` exporting the Game object (below).
2. Register it in `js/core/games.js`: import it, add it to `GAMES`, and remove it from `COMING_SOON` if it's
   listed there.
3. Add every new file to `PRECACHE` in `sw.js`, or it won't work offline. A test checks this.
4. Add `tests/unit/games/<id>.test.js` proving, for many seeds at every level:
   - every generated puzzle is solvable (use a solver);
   - every puzzle stays within that level's difficulty rules.

   `tests/unit/games.test.js` already checks every registered game automatically: the ladder is valid, the
   instruction isn't empty, the same seed gives the same puzzle, and `Math.random` isn't used. See
   `docs/TESTING.md`.

## The Game object
| Field | What it is |
|---|---|
| `id` | URL-safe id, e.g. `arrow-path`. Used in `#/game/<id>` and `#/play/<id>`. |
| `title`, `icon` | One or two simple words and an emoji for the home tile. |
| `version` | A number. **Bump it whenever `createPuzzle` changes.** Old saves hold a seed, and a changed generator would turn that seed into a different puzzle, so saves from an older version are dropped. |
| `hidden` | Optional. `true` keeps it off the home screen. |
| `ladder` | `{ levels, puzzlesPerLevel, starts: { easy, medium, hard } }`. The default is `30`, `3`, and `1 / 11 / 21`. After the top level, puzzles keep coming at max difficulty. |
| `instruction(level)` | Short, simple words that 🔊 reads, e.g. "Help the fox find the treasure." |
| `createPuzzle(level, rng)` | Builds the puzzle using only `rng` (never `Math.random`), so it's reproducible. Build the solution first, then the puzzle around it, and check it with a solver. |
| `mount(el, puzzle, api)` | Draws the puzzle into `el` and returns `{ destroy() }`. `destroy` removes listeners and timers. |

## What `api` gives a game
- **`api.state`:** progress saved earlier in this same puzzle, or `null`. Use it to restore the board after a
  reload.
- **`api.saveState(state)`:** call after each meaningful move. It must be plain JSON data.
- **`api.solved()`:** call once when solved. The shell saves the next puzzle, celebrates, then mounts it.
- **`api.setInstruction(text)`:** change what 🔊 reads, e.g. a gentle hint after a mistake.

## Rules that apply (from `CLAUDE.md`)
- **Input:** use pointer or click events only, never separate touch and mouse code.
- **Tap targets:** at least 64×64 px.
- **Mistakes:** a mistake gets a gentle hint and an easy retry. There's no game over and no timer.
- **Storage:** never touch `localStorage` directly. Use `api.saveState`.
- **Network:** no network requests, external links or third-party code.
