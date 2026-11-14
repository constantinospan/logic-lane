# Testing

## Run everything
```
npm ci                                        # once, or after package.json changes
npx playwright install chromium webkit        # once, downloads the test browsers
npm run check                                 # type check + unit tests + browser tests
```
`npm run check` is what agents run before pushing. CI (`.github/workflows/ci.yml`) runs the same checks on every PR
and on `main` before deploying, split across machines working at the same time: type check and unit tests on one,
browser tests shared out over three (`--shard=1/3` etc.). Its `test` job passes only if all of
them passed, and must pass before a PR can merge. When something fails, the run page has a `test-report-<n>`
download with the Playwright report and the pictures of what went wrong.

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
| Browser: edge cases | `tests/e2e/edges.spec.js` | Races (reload or leave mid-celebration, double taps), 3 h expiry, old versions, corrupt, blocked or full storage, no speech, unknown addresses, endless top, sideways screens, reduced motion |
| Visual | `tests/e2e/visual.spec.js` | Pictures of every screen at all three sizes, compared with the saved ones. CI and the builder only (see below) |
| Deploy prep | `tests/unit/build-site.test.js` | Only shipped files go live, every precached file is there, `VERSION` is stamped with the content hash, docs-only changes keep the same hash |
| Accessibility | `tests/e2e/a11y.spec.js` | axe (WCAG 2.0–2.2 A/AA) on home, picker (with and without Continue), play (fresh and after a mistake), celebration, update banner and reset |
| Coverage | `npm test` | **Each** shared-core file (`js/core/`) must stay at 100% of lines and functions (95% of branches); see `coverage/index.html` |
| AI reviewers | GitHub, plan step 6b (D19) | What tests can't judge: right for a 5-year-old, difficulty feel, code bugs |

Every browser test automatically fails on a console error, a page error, or any request outside the site
(`tests/e2e/fixtures.js`). Speech is replaced with a recorder, so tests can check what 🔊 would say.

## How we know the tests work
Tests are checked by breaking the app on purpose (removed guards, wrong timings, missing saves, low contrast,
layouts too wide, etc.) and making sure the matching test goes red. Several breaks weren't caught at first, and
reviews found tests that couldn't fail. Those tests were strengthened until they did. Do the same for every new
test: break the thing, see red, restore.

## Visual snapshots
`tests/e2e/visual.spec.js` compares each screen with a saved picture in `tests/e2e/visual.spec.js-snapshots/`.
Fonts and emoji look slightly different on every operating system, so the saved pictures come from one machine:
GitHub's `ubuntu-24.04` with the browsers Playwright installs. The tests run only when `VISUAL=1` is set, which CI
and the `@claude` builder do. On a Mac or in claude.ai/code they skip.

- In CI a missing picture is a failure (never written quietly), and a test that only passes on retry fails the run.
- **Updating pictures, only for an intended visual change:**
  - The `@claude` builder can run `npx playwright test tests/e2e/visual.spec.js --update-snapshots` itself.
  - Or: Actions → CI → Run workflow, pick the branch, tick `update_snapshots`. Download the `snapshots` artifact,
    look at every picture, and commit the ones that changed.
- The PR lists which pictures changed and why. Never update them just to turn a red check green.
- Screens are made the same every time: a fixed puzzle (seed `visual`), a fixed cheer, a paused clock for the
  celebration, no animations.

## Adding a game
1. Write `tests/unit/games/<id>.test.js`. For many seeds at every level, check that each puzzle is solvable (with
   a solver) and within that level's rules. `tests/unit/games/demo.test.js` is a small example.
2. The shared game tests pick up the new game automatically once it's in `GAMES` (`js/core/games.js`).
3. Add a browser test for the game's interactions (e.g. drag, multi-step moves, hints). Add its screens to
   `tests/e2e/a11y.spec.js` and `tests/e2e/visual.spec.js`.

## Notes
- `tests/shipped-files.js` is the one definition of what the site ships. The PRECACHE test, the deploy version
  hash and the reviewer rules all use it.
- `tests/serve.mjs` serves the repo at `/logic-lane/`, like GitHub Pages. It has one test hook: a browser with
  the cookie `test-sw-version=<v>` gets `sw.js` with that `VERSION`, as if a new version had been deployed.
  Playwright can't intercept service worker scripts, so this is how the update test works.
- The real-iPad check (speech, press-and-hold, installing) happens by hand in plan step 9.
