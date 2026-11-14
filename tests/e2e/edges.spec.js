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

test('leaving during the celebration stops it: nothing pops up or gets saved later', async ({ page }) => {
  await page.clock.install(); // we move time forward ourselves
  await startDemo(page);
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('.home-title')).toBeVisible();
  const saved = await readSave(page);
  await page.clock.runFor(5000); // well past the celebration
  await expect(page.locator('.demo-choice')).toHaveCount(0);
  await expect(page.locator('.celebrate')).toHaveCount(0);
  expect(await readSave(page)).toEqual(saved); // a leftover timer would have re-saved (new savedAt)
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

test('with storage blocked (Safari "Block All Cookies"), she can still play', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('./#/game/demo');
  await page.locator('.choice-easy').click();
  await expect(page).toHaveURL(/#\/play\/demo$/);
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.demo-choice').first()).toBeVisible();
});

test('if storage fills up mid-game, she keeps playing', async ({ page, context }) => {
  await context.addInitScript(() => {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'logic-lane:resume' && /** @type {any} */ (window).__full) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return realSet.call(this, key, value);
    };
  });
  await startDemo(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__full = true;
  });
  for (let i = 0; i < 2; i++) {
    await tapRightChoice(page);
    await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.demo-choice').first()).toBeVisible();
  }
  // Home then Continue must bring back where she is now (from memory), not the older saved puzzle.
  const progress = await page.locator('.level-dots').textContent();
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => (location.hash = '#/game/demo'));
  await page.locator('.choice-continue').click();
  await expect(page.locator('.level-dots')).toHaveText(progress ?? '');
});

test('unknown addresses end up on the home screen', async ({ page }) => {
  for (const path of ['./#/play/nope', './#/game/nope', './#/whatever', './#/play/']) {
    await page.goto(path);
    await expect(page.locator('.home-title'), path).toBeVisible();
  }
});

test('without speech support the speaker is hidden and nothing breaks', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  });
  await startDemo(page);
  const speaker = page.locator('.topbar .icon-button[aria-label="Read it to me"]');
  await expect(speaker).toHaveCount(1); // still there (keeps the bar balanced), just hidden
  await expect(speaker).toHaveAttribute('hidden', '');
  await expect(speaker).toBeHidden();
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
