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
  let loads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) loads += 1;
  });
  await page.goto('./');
  await waitForControl(page);
  await page.waitForTimeout(500);
  expect(loads).toBe(1);
});

test('after one visit, it works offline', async ({ page, context }) => {
  await page.goto('./');
  await waitForControl(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.home-title')).toBeVisible();
  await page.goto('./#/game/demo');
  await page.locator('.choice-easy').click();
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  await context.setOffline(false);
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
  // The old version's cache is cleaned up (activate may finish just after the reload, so retry briefly).
  await expect.poll(() => page.evaluate(() => caches.keys())).toContain('logic-lane:test-next');
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('logic-lane:dev');
});

// WebKit sometimes loses the "take over" message the banner sends (3 of 150 taps on Linux WebKit, 2026-11-14), so the
// app sends it again. This drops the first one on purpose, in every browser, and the update must still happen.
test('the update still happens when the first "take over" message is lost', async ({ page, context, baseURL }) => {
  await context.addInitScript(() => {
    const send = ServiceWorker.prototype.postMessage;
    let dropped = false;
    ServiceWorker.prototype.postMessage = function (/** @type {any[]} */ ...args) {
      if (args[0] === 'skipWaiting' && !dropped) {
        dropped = true;
        return;
      }
      return send.apply(this, /** @type {any} */ (args));
    };
  });
  await page.goto('./');
  await waitForControl(page);
  await startDemo(page);
  await context.addCookies([{ name: 'test-sw-version', value: 'test-lost', url: String(baseURL) }]);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());

  const banner = page.getByRole('button', { name: 'New version. Tap to update.' });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.click();
  await page.waitForFunction(() => document.querySelector('.update-banner') === null, null, { timeout: 10_000 });
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => caches.keys())).toContain('logic-lane:test-lost');
});
