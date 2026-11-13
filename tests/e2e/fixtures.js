// Shared browser-test setup. Every test automatically fails on:
// - any console error or uncaught page error
// - any request outside /logic-lane/ (including requests made by the service worker) (CLAUDE.md: no network)
// It also replaces speech with a stub that records what would have been spoken.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      /** @type {string[]} */
      const spoken = [];
      Object.defineProperty(window, '__spoken', { value: spoken });
      const synth = {
        speak: (/** @type {{ text: string }} */ u) => spoken.push(u.text),
        cancel: () => {},
        getVoices: () => [{ lang: 'en-GB', name: 'Test voice' }],
        addEventListener: () => {},
      };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        value: class {
          /** @param {string} text */
          constructor(text) {
            this.text = text;
          }
        },
        configurable: true,
      });
    });
    await use(context);
  },

  page: async ({ page, context, baseURL }, use) => {
    /** @type {string[]} */
    const problems = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    context.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(String(baseURL)) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        problems.push(`request outside the site: ${url}`);
      }
    });
    await use(page);
    expect(problems, 'no console errors, page errors or outside requests').toEqual([]);
  },
});

export { expect };

/** The saved resume record, or null. @param {import('@playwright/test').Page} page */
export function readSave(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('logic-lane:resume') ?? 'null'));
}

/** The demo's choices, as a string of emoji. @param {import('@playwright/test').Page} page */
export function demoLayout(page) {
  return page.locator('.demo-choice').allTextContents().then((t) => t.join(''));
}

/** @param {import('@playwright/test').Page} page */
export async function tapRightChoice(page) {
  const target = await page.locator('.demo-target').textContent();
  await page.locator('.demo-choice', { hasText: target ?? '' }).first().click();
}

/** @param {import('@playwright/test').Page} page */
export async function tapWrongChoice(page) {
  const target = (await page.locator('.demo-target').textContent()) ?? '';
  const choices = page.locator('.demo-choice');
  const count = await choices.count();
  for (let i = 0; i < count; i++) {
    if ((await choices.nth(i).textContent()) !== target) {
      await choices.nth(i).click();
      return;
    }
  }
  throw new Error('no wrong choice found');
}

/**
 * Press and hold the middle of an element. Uses the mouse in every project: Playwright's touchscreen can't
 * long-press, and the app treats mouse and touch the same (pointer events).
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {number} ms
 */
export async function hold(page, selector, ms) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Start the demo game at a difficulty. @param {import('@playwright/test').Page} page */
export async function startDemo(page, difficulty = 'easy') {
  await page.goto('./#/game/demo');
  await page.locator(`.choice-${difficulty}`).click();
  await expect(page).toHaveURL(/#\/play\/demo$/);
  await expect(page.locator('.demo-choice').first()).toBeVisible();
}
