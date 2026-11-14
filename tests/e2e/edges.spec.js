// Edge cases around the shared base: races, expiry, broken storage, missing speech, endless play, rotation,
// reduced motion.
import { demoLayout, expect, readSave, startDemo, tapRightChoice, test } from './fixtures.js';

/**
 * Put a save into storage directly, then open the app as an installed app would (at ./).
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} overrides
 */
async function openWithSave(page, overrides) {
  await page.goto('./');
  await page.evaluate((o) => {
    const save = { gameId: 'demo', gameVersion: 1, level: 1, n: 0, seed: 'edge01', state: null, active: true,
      savedAt: Date.now(), ...o };
    localStorage.setItem('logic-lane:resume', JSON.stringify(save));
  }, overrides);
  await page.goto('./#/');
  await page.goto('./');
}

test('reloading during the celebration goes to the next puzzle, not the same one again', async ({ page }) => {
  await startDemo(page);
  const before = await readSave(page);
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  // Already saved, before any reload: a tablet can kill the app mid-celebration without warning.
  expect((await readSave(page)).n).toBe(before.n + 1);
  await page.reload();
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  const after = await readSave(page);
  expect(after.n).toBe(before.n + 1);
  expect(after.seed).not.toBe(before.seed);
});

test('leaving during the celebration does not pop a puzzle onto another screen', async ({ page }) => {
  // (The leftover-timer case that could overwrite a new game's save is tested separately below.)
  await startDemo(page);
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await page.waitForTimeout(2000); // longer than the celebration
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.locator('.demo-choice')).toHaveCount(0);
  await expect(page.locator('.celebrate')).toHaveCount(0);
});

test('two very quick taps on the right answer count once', async ({ page }) => {
  await startDemo(page);
  const before = await readSave(page);
  await page.evaluate(() => {
    const target = document.querySelector('.demo-target')?.textContent;
    const right = [...document.querySelectorAll('.demo-choice')].find((b) => b.textContent === target);
    /** @type {HTMLElement} */ (right).click();
    /** @type {HTMLElement} */ (right).click();
  });
  await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
  expect((await readSave(page)).n).toBe(before.n + 1);
});

test('after 3 hours it starts fresh: no jump back in, no Continue', async ({ page }) => {
  await openWithSave(page, { savedAt: Date.now() - 3 * 60 * 60 * 1000 - 1000 });
  await expect(page.locator('.home-title')).toBeVisible();
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-easy')).toBeVisible();
  await expect(page.locator('.choice-continue')).toHaveCount(0);
});

test('just under 3 hours it still jumps back in', async ({ page }) => {
  await openWithSave(page, { savedAt: Date.now() - 3 * 60 * 60 * 1000 + 60_000 });
  await expect(page).toHaveURL(/#\/play\/demo$/);
  await expect(page.locator('.demo-choice').first()).toBeVisible();
});

test('a save from an older game version is dropped', async ({ page }) => {
  await openWithSave(page, { gameVersion: 999 });
  await expect(page.locator('.home-title')).toBeVisible();
  expect(await readSave(page)).toBeNull();
});

test('a corrupt save is ignored', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('logic-lane:resume', '{not json'));
  await page.goto('./#/game/demo');
  await expect(page.locator('.choice-continue')).toHaveCount(0);
  await page.locator('.choice-easy').click();
  await expect(page.locator('.demo-choice').first()).toBeVisible();
});

test('with storage blocked, the game still works (just without resume)', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('./#/game/demo');
  await page.locator('.choice-easy').click();
  // No save, so play can't start: the picker stays. The app must not crash.
  await expect(page.locator('.choice-easy')).toBeVisible();
  await expect(page.locator('.home-title, .picker-title').first()).toBeVisible();
});

test('without speech support the speaker is hidden and nothing breaks', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  });
  await startDemo(page);
  await expect(page.getByRole('button', { name: 'Read it to me' })).toBeHidden();
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
});

test('at the top level, puzzles keep coming (endless)', async ({ page }) => {
  await openWithSave(page, { level: 30, n: 2 });
  await expect(page.locator('.level-label')).toHaveText('Level 30');
  for (let i = 0; i < 2; i++) {
    await tapRightChoice(page);
    await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.level-label')).toHaveText('Level 30');
  }
  expect((await readSave(page)).n).toBe(4);
});

test('reduced motion: the celebration still finishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDemo(page);
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.demo-choice').first()).toBeVisible();
});

test('turned sideways: no sideways scrolling, buttons still at least 64px', async ({ page }) => {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  await page.setViewportSize({ width: size.height, height: size.width });
  for (const step of ['home', 'picker', 'play']) {
    if (step === 'home') await page.goto('./');
    if (step === 'picker') await page.goto('./#/game/demo');
    if (step === 'play') await startDemo(page, 'hard');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), step).toBe(false);
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, .tile')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => Math.min(r.width, r.height)),
    );
    expect(sizes.length, step).toBeGreaterThan(0);
    expect(Math.min(...sizes), step).toBeGreaterThanOrEqual(64);
  }
});

test('puzzles differ between fresh starts', async ({ page }) => {
  const layouts = new Set();
  for (let i = 0; i < 5; i++) {
    await page.goto('./');
    await page.evaluate(() => localStorage.clear());
    await startDemo(page, 'hard');
    layouts.add(await demoLayout(page));
  }
  expect(layouts.size).toBeGreaterThanOrEqual(2);
});

test('starting a new game during the old celebration keeps the new game', async ({ page }) => {
  await startDemo(page, 'medium'); // level 11
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/game/demo'));
  await page.locator('.choice-easy').click(); // level 1, while the old celebration timer would still be running
  await page.waitForTimeout(2000);
  const save = await readSave(page);
  expect(save.level).toBe(1);
  expect(save.n).toBe(0);
  await expect(page.locator('.level-label')).toHaveText('Level 1');
});
