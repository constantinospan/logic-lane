// Visual snapshots: every screen at phone, tablet and desktop size, compared with saved pictures (D8).
// Catches layout and styling changes the other tests can't see (overlaps, wrong colours, cut-off text).
//
// Runs only with VISUAL=1, which CI and the @claude builder set. Both use the same Linux machine (ubuntu-24.04) and
// fonts, so the saved pictures match. On other machines (a Mac, claude.ai/code) fonts differ and every picture
// would fail, so the tests skip there. Pictures change only for an intended visual change: see docs/TESTING.md.
import { expect, hold, readSave, startDemo, tapRightChoice, test } from './fixtures.js';
import { generate } from '../../games/pattern-train/generate.js';
import { createRng } from '../../js/core/rng.js';

// On GitHub every run must include them: a workflow that forgot VISUAL=1 fails here instead of skipping quietly.
if (process.env.GITHUB_ACTIONS && !process.env.VISUAL) throw new Error('Set VISUAL=1 in the workflow (docs/TESTING.md).');

test.skip(!process.env.VISUAL, 'Visual snapshots run only with VISUAL=1 (CI and the @claude builder). See docs/TESTING.md.');

// No service worker, except in the update-banner test: in WebKit on Linux a stray "⬆️ New!" banner once showed up
// in an unrelated picture. The service worker has its own tests (pwa.spec.js, edges.spec.js).
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context }) => {
  // Same cheer every time: the celebration picks it with Math.random.
  await context.addInitScript(() => {
    Math.random = () => 0.42;
  });
});

/**
 * Open a game on a fixed puzzle (seed and level), through a saved game, like a resume.
 * @param {import('@playwright/test').Page} page
 * @param {number} level
 * @param {{ id: string, version: number, ready: string }} game  `ready`: a selector that shows the puzzle is drawn.
 */
async function openPuzzle(page, level = 1, game = { id: 'demo', version: 1, ready: '.demo-choice' }) {
  await page.goto('./');
  await page.evaluate(([lvl, id, version]) => {
    const save = { gameId: id, gameVersion: version, level: lvl, n: 0, seed: 'visual', state: null, active: true,
      savedAt: Date.now() };
    localStorage.setItem('logic-lane:resume', JSON.stringify(save));
  }, /** @type {[number, string, number]} */ ([level, game.id, game.version]));
  await page.goto(`./#/play/${game.id}`);
  await expect(page.locator(game.ready).first()).toBeVisible();
  expect(await readSave(page)).toMatchObject({ gameId: game.id, level, seed: 'visual' }); // really the fixed puzzle
}

/** @param {import('@playwright/test').Page} page @param {string} name */
async function snap(page, name) {
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

test('home', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.home-title')).toBeVisible();
  await snap(page, 'home');
});

test('picker', async ({ page }) => {
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-easy')).toBeVisible();
  await snap(page, 'picker');
});

test('picker with Continue', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-continue')).toBeVisible();
  await snap(page, 'picker-continue');
});

test('play', async ({ page }) => {
  await openPuzzle(page);
  await snap(page, 'play');
});

test('play at the top level', async ({ page }) => {
  await openPuzzle(page, 30);
  await snap(page, 'play-top');
});

// Arrow Path: one picture per kind of level (D22).
const ARROW_PATH = { id: 'arrow-path', version: 1, ready: '.ap-grid' };
for (const [name, level] of /** @type {[string, number][]} */ ([['board', 4], ['moves', 11], ['loops', 14],
  ['debug', 21]])) {
  test(`arrow path ${name}`, { tag: '@game:arrow-path' }, async ({ page }) => {
    await openPuzzle(page, level, ARROW_PATH);
    await snap(page, `arrow-path-${name}`);
  });
}

test('arrow path after a wrong walk', { tag: '@game:arrow-path' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // short steps, and no wiggle mid-picture
  await openPuzzle(page, 21, ARROW_PATH); // the list starts wrong, so Go fails straight away
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.ap-busy')).toHaveCount(0);
  await expect(page.locator('.ap-hint')).not.toHaveText('');
  await snap(page, 'arrow-path-mistake'); // the hint line, the lit trail and the marked step
});

// Pattern Train: one picture per step of the ladder (D28), and one after a mistake.
const PATTERN_TRAIN = { id: 'pattern-train', version: 1, ready: '.pt-train' };
for (const [name, level] of /** @type {[string, number][]} */ ([['colour', 1], ['size', 5], ['turn', 9], ['abc', 15],
  ['middle', 17], ['solids', 21], ['two', 29]])) {
  test(`pattern train ${name}`, { tag: '@game:pattern-train' }, async ({ page }) => {
    await openPuzzle(page, level, PATTERN_TRAIN);
    await snap(page, `pattern-train-${name}`);
  });
}

test('pattern train after a mistake', { tag: '@game:pattern-train' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no wiggle mid-picture
  await openPuzzle(page, 13, PATTERN_TRAIN);
  const p = generate(13, createRng('visual', 13)).puzzle;
  await page.locator(`.pt-choice[data-i="${p.answer === 0 ? 1 : 0}"]`).click(); // a wrong one
  await expect(page.locator('.pt-tried')).toHaveCount(1);
  await expect(page.locator('.pt-hint')).not.toHaveText('');
  await snap(page, 'pattern-train-mistake');
});

test('celebration', async ({ page }) => {
  await page.clock.install();
  await openPuzzle(page);
  await page.clock.pauseAt(Date.now() + 1000); // the celebration stays up while the picture is taken
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await snap(page, 'celebration');
  await expect(page.locator('.celebrate')).toBeVisible();
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('update banner', async ({ page, context, baseURL }) => {
    await page.goto('./');
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller !== null;
    });
    await context.addCookies([{ name: 'test-sw-version', value: 'visual-next', url: String(baseURL) }]);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await expect(page.locator('.update-banner')).toBeVisible({ timeout: 10_000 });
    await snap(page, 'update-banner');
  });
});

test('reset screen', async ({ page }) => {
  await page.goto('./');
  await hold(page, '.home-title', 3300);
  await expect(page.locator('.reset-button')).toBeVisible();
  await snap(page, 'reset');
});
