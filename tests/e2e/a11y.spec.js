// Automated accessibility checks (axe) on every screen: contrast, names for buttons, structure.
import AxeBuilder from '@axe-core/playwright';
import { expect, hold, startDemo, tapWrongChoice, test } from './fixtures.js';
import { generate } from '../../games/pattern-train/generate.js';
import { createRng } from '../../js/core/rng.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ inPage?: boolean }} [options]  inPage: scan without axe's temporary helper page (needed while the
 *   page's clock is faked, because the fake clock is shared with every page in the context). Our app has no iframes,
 *   so nothing is lost.
 */
async function violations(page, { inPage = false } = {}) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .setLegacyMode(inPage)
    .analyze();
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

for (const level of [1, 11, 14, 21]) {
  test(`Arrow Path level ${level} has no accessibility problems`, { tag: '@game:arrow-path' }, async ({ page }) => {
    await page.goto('./');
    await page.evaluate((lvl) => {
      const save = { gameId: 'arrow-path', gameVersion: 1, level: lvl, n: 0, seed: 'a11y00', state: null,
        active: true, savedAt: Date.now() };
      localStorage.setItem('logic-lane:resume', JSON.stringify(save));
    }, level);
    await page.goto('./#/play/arrow-path');
    await expect(page.locator('.ap-grid')).toBeVisible();
    if (level > 10) {
      await page.locator('.ap-key').first().click(); // a filled slot
      await page.locator('.ap-slot').first().click(); // and selected
    } else {
      await page.locator('.ap-tap').first().click(); // a square with an arrow
    }
    expect(await violations(page)).toEqual([]);
  });
}

for (const level of [1, 17, 21, 29]) {
  test(`Pattern Train level ${level} has no accessibility problems`, { tag: '@game:pattern-train' },
    async ({ page }) => {
    await page.goto('./');
    await page.evaluate((lvl) => {
      const save = { gameId: 'pattern-train', gameVersion: 1, level: lvl, n: 0, seed: 'a11y00', state: null,
        active: true, savedAt: Date.now() };
      localStorage.setItem('logic-lane:resume', JSON.stringify(save));
    }, level);
    await page.goto('./#/play/pattern-train');
    await expect(page.locator('.pt-train')).toBeVisible();
    const p = generate(level, createRng('a11y00', level)).puzzle;
    await page.locator(`.pt-choice[data-i="${p.answer === 0 ? 1 : 0}"]`).click(); // a wrong one
    await expect(page.locator('.pt-hint')).not.toHaveText(''); // the hint and a faded choice are on screen
    await expect(page.locator('.pt-tried')).toHaveCount(1);
    expect(await violations(page)).toEqual([]);
  });
}

test('celebration has no accessibility problems', async ({ page }) => {
  await page.clock.install();
  await startDemo(page);
  await page.clock.pauseAt(Date.now() + 1000); // freeze time so the celebration stays up while axe scans it
  const target = await page.locator('.demo-target').textContent();
  await page.locator('.demo-choice', { hasText: target ?? '' }).first().click();
  await expect(page.locator('.celebrate')).toBeVisible();
  // axe needs a few timer ticks of its own, so move the paused clock 1 ms at a time while it runs. That stays far
  // below the celebration's 1.4 s, so the overlay can't disappear mid-scan.
  let done = false;
  const scan = violations(page, { inPage: true }).finally(() => (done = true));
  for (let ms = 0; !done && ms < 1000; ms++) await page.clock.runFor(1);
  expect(await scan).toEqual([]);
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
