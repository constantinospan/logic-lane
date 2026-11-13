// Installable app: service worker, caches, and the "New!" update flow (D9, D16). Runs in every project,
// WebKit included. A real-iPad check still happens in plan step 9.
import { expect, readSave, startDemo, test } from './fixtures.js';

/** @param {import('@playwright/test').Page} page */
async function waitForControl(page) {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

test('the service worker installs and only uses logic-lane: caches', async ({ page }) => {
  await page.goto('./');
  await waitForControl(page);
  const names = await page.evaluate(() => caches.keys());
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) expect(name.startsWith('logic-lane:')).toBe(true);
});

test('the first visit does not reload the page by itself', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    /** @type {any} */ (window).__sameDocument = true;
  });
  await waitForControl(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => /** @type {any} */ (window).__sameDocument)).toBe(true);
});

test('a new version shows "New!", and tapping it updates into the same puzzle', async ({ page, context, baseURL }) => {
  await page.goto('./');
  await waitForControl(page);
  await startDemo(page);
  const before = await readSave(page);

  // From now on the test server gives this browser a changed sw.js, as if a new version had been deployed
  // (see the test hook in tests/serve.mjs; Playwright routing can't intercept service worker scripts).
  await context.addCookies([{ name: 'test-sw-version', value: 'test-next', url: String(baseURL) }]);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());

  const banner = page.getByRole('button', { name: 'New version. Tap to update.' });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.click();
  await page.waitForFunction(() => document.querySelector('.update-banner') === null);
  await expect(page).toHaveURL(/#\/play\/demo$/);
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  expect((await readSave(page)).seed).toBe(before.seed);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain('logic-lane:test-next');
  expect(names).not.toContain('logic-lane:dev'); // the old version's cache is cleaned up
});
