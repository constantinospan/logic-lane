# Testing

## Run everything
```
npm ci                                        # once, or after package.json changes
npx playwright install chromium webkit        # once, downloads the test browsers
npm run check                                 # type check + unit tests + browser tests
```
`npm run check` is what agents run before pushing, and what CI runs on every PR (plan step 6a).

Individual parts:
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`

To see the site yourself, run `node tests/serve.mjs`, then open http://localhost:4173/logic-lane/. The hidden demo
game is at `#/play/demo`.

## What each layer covers
| Layer | Where | Covers |
|---|---|---|
| Type check | `tsconfig.json`, `tsconfig.sw.json` | JSDoc types in `js/`, `games/` and `sw.js` (strict) |
| Unit: shared base | `tests/unit/*.test.js` | Seeds, ladder, storage (3 h window, prefixes, failures), PRECACHE matches the shipped files |
| Unit: every game | `tests/unit/games.test.js` | Runs automatically for each registered game: valid ladder, instructions, same seed gives the same puzzle, no `Math.random` |
| Unit: one game | `tests/unit/games/<id>.test.js` | That game's own rules: every puzzle is solvable and within its level's difficulty |
| Browser | `tests/e2e/*.spec.js` | Real flows at phone (Chromium), tablet (WebKit, Safari's engine) and desktop sizes |
| Browser: edge cases | `tests/e2e/edges.spec.js` | Races (reload or leave mid-celebration, double taps), 3 h expiry, old versions, corrupt or blocked storage, no speech, endless top, sideways screens, reduced motion |
| Accessibility | `tests/e2e/a11y.spec.js` | axe (WCAG 2.1 A/AA) on every screen: contrast, button names, structure |
| Coverage | `npm test` | The shared core must stay at 100% of lines and functions (95% of branches); see `coverage/index.html` |
| AI reviewers | GitHub, plan step 6b (D19) | What tests can't judge: right for a 5-year-old, difficulty feel, code bugs |

Every browser test automatically fails on a console error, a page error, or any request outside the site
(`tests/e2e/fixtures.js`). Speech is replaced with a recorder, so tests can check what 🔊 would say.

## How we know the tests work
Each test was proven able to fail: the app was broken on purpose (removed guards, wrong timings, missing saves,
low contrast, layouts too wide, etc.) and the matching test had to go red. Several tests were strengthened when
a break wasn't caught. Do the same for new tests: break the thing, see red, restore.

## Adding a game
1. Write `tests/unit/games/<id>.test.js`. For many seeds at every level, check that each puzzle is solvable (with
   a solver) and within that level's rules. `tests/unit/games/demo.test.js` is a small example.
2. The shared game tests pick up the new game automatically once it's in `GAMES` (`js/core/games.js`).
3. Add a browser test for the game's interactions (e.g. drag, multi-step moves, hints). Add its screens to
   `tests/e2e/a11y.spec.js`.

## Notes
- `tests/shipped-files.js` is the one definition of what the site ships. The PRECACHE test, the deploy version
  hash and the reviewer rules all use it.
- `tests/serve.mjs` serves the repo at `/logic-lane/`, like GitHub Pages. It has one test hook: a browser with
  the cookie `test-sw-version=<v>` gets `sw.js` with that `VERSION`, as if a new version had been deployed.
  Playwright can't intercept service worker scripts, so this is how the update test works.
- The real-iPad check (speech, press-and-hold, installing) happens by hand in plan step 9.
