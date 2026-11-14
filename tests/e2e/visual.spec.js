// Visual snapshots: every screen at phone, tablet and desktop size, compared with saved pictures (D8).
// Catches layout and styling changes the other tests can't see (overlaps, wrong colours, cut-off text).
//
// Runs only with VISUAL=1, which CI and the @claude builder set. Both use the same Linux machine (ubuntu-24.04) and
// fonts, so the saved pictures match. On other machines (a Mac, claude.ai/code) fonts differ and every picture
// would fail, so the tests skip there. Pictures change only for an intended visual change: see docs/TESTING.md.
import { expect, hold, readSave, startDemo, tapRightChoice, tapWrongChoice, test } from './fixtures.js';

test.skip(!process.env.VISUAL, 'Visual snapshots run only with VISUAL=1 (CI and the @claude builder). See docs/TESTING.md.');

test.beforeEach(async ({ context }) => {
  // Same cheer every time: the celebration picks it with Math.random.
  await context.addInitScript(() => {
    Math.random = () => 0.42;
  });
});

/**
 * Open the demo on a fixed puzzle (seed and level), through a saved game, like a resume.
 * @param {import('@playwright/test').Page} page
 * @param {number} level
 */
async function openPuzzle(page, level = 1) {
  await page.goto('./');
  await page.evaluate((lvl) => {
    const save = { gameId: 'demo', gameVersion: 1, level: lvl, n: 0, seed: 'visual', state: null, active: true,
      savedAt: Date.now() };
    localStorage.setItem('logic-lane:resume', JSON.stringify(save));
  }, level);
  await page.goto('./#/play/demo');
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level, seed: 'visual' }); // really the fixed puzzle
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

test('play after a mistake', async ({ page }) => {
  await openPuzzle(page);
  await tapWrongChoice(page);
  await snap(page, 'play-mistake');
});

test('play at the top level', async ({ page }) => {
  await openPuzzle(page, 30);
  await snap(page, 'play-top');
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

test('reset screen', async ({ page }) => {
  await page.goto('./');
  await hold(page, '.home-title', 3300);
  await expect(page.locator('.reset-button')).toBeVisible();
  await snap(page, 'reset');
});
