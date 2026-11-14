// Automated accessibility checks (axe) on every screen: contrast, names for buttons, structure.
import AxeBuilder from '@axe-core/playwright';
import { expect, hold, startDemo, test } from './fixtures.js';

/** @param {import('@playwright/test').Page} page */
async function violations(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
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
  await startDemo(page);
  const target = await page.locator('.demo-target').textContent();
  await page.locator('.demo-choice', { hasText: target ?? '' }).first().click();
  await expect(page.locator('.celebrate')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('reset screen has no accessibility problems', async ({ page }) => {
  await page.goto('./');
  await hold(page, '.home-title', 3300);
  await expect(page.locator('.reset-button')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
