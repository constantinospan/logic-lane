// Automated accessibility checks (axe) on every screen: contrast, names for buttons, structure.
import AxeBuilder from '@axe-core/playwright';
import { expect, hold, startDemo, tapWrongChoice, test } from './fixtures.js';

/** @param {import('@playwright/test').Page} page */
async function violations(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

test('home has no accessibility problems', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.home-title')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('picker has no accessibility problems', async ({ page }) => {
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-easy')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('play screen has no accessibility problems', async ({ page }) => {
  await startDemo(page);
  expect(await violations(page)).toEqual([]);
});

test('celebration has no accessibility problems', async ({ page }) => {
  await page.clock.install(); // freeze time so the celebration stays up while axe scans it
  await startDemo(page);
  const target = await page.locator('.demo-target').textContent();
  await page.locator('.demo-choice', { hasText: target ?? '' }).first().click();
  await expect(page.locator('.celebrate')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await expect(page.locator('.celebrate')).toBeVisible(); // it really was the celebration that was checked
});

test('picker with Continue has no accessibility problems', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-continue')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('play screen after a mistake has no accessibility problems', async ({ page }) => {
  await startDemo(page);
  await tapWrongChoice(page);
  expect(await violations(page)).toEqual([]);
});

test('update banner has no accessibility problems', async ({ page, context, baseURL }) => {
  await page.goto('./');
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  await context.addCookies([{ name: 'test-sw-version', value: 'a11y-next', url: String(baseURL) }]);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  await expect(page.locator('.update-banner')).toBeVisible({ timeout: 10_000 });
  expect(await violations(page)).toEqual([]);
});

test('reset screen has no accessibility problems', async ({ page }) => {
  await page.goto('./');
  await hold(page, '.home-title', 3300);
  await expect(page.locator('.reset-button')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
