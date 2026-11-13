// Press-and-hold features: the seed for bug reports, and the parent-only emergency reset (D12, D16).
import { expect, hold, readSave, startDemo, test } from './fixtures.js';

test('a long press on the level shows level and seed; a short press does not', async ({ page }) => {
  await startDemo(page);
  await hold(page, '.level', 300);
  await expect(page.locator('.level')).not.toHaveClass(/show-seed/);
  await hold(page, '.level', 1100);
  await expect(page.locator('.level')).toHaveClass(/show-seed/);
  const save = await readSave(page);
  await expect(page.locator('.level-seed')).toHaveText(`${save.level} · ${save.seed}`);
});

test('the reset screen needs a 3-second hold on the title', async ({ page }) => {
  await page.goto('./');
  await hold(page, '.home-title', 1500);
  await expect(page).not.toHaveURL(/#\/reset$/);
  await hold(page, '.home-title', 3300);
  await expect(page).toHaveURL(/#\/reset$/);
});

test('offline, reset refuses and keeps the game', async ({ page }) => {
  await startDemo(page);
  await page.goto('./#/reset');
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await hold(page, '.reset-button', 3300);
  await expect(page.locator('.reset-text')).toHaveText('Needs internet. Try again later.');
  expect(await readSave(page)).not.toBeNull();
});

test("online, reset clears Logic Lane's data but leaves other sites alone", async ({ page }) => {
  await startDemo(page);
  await page.evaluate(async () => {
    localStorage.setItem('other-site:key', 'keep');
    const cache = await caches.open('other-site-cache');
    await cache.put('/other-site/thing', new Response('keep'));
  });
  await page.goto('./#/reset');
  await hold(page, '.reset-button', 3300);
  await page.waitForURL((url) => url.hash === '' || url.hash === '#/');
  await expect(page.locator('.home-title')).toBeVisible();
  expect(await readSave(page)).toBeNull();
  const kept = await page.evaluate(async () => ({
    key: localStorage.getItem('other-site:key'),
    cache: (await caches.keys()).includes('other-site-cache'),
  }));
  expect(kept).toEqual({ key: 'keep', cache: true });
});
