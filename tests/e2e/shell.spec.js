// The shared base: home → picker → play, resume, celebration, Home/Continue, speaker, layout.
import { demoLayout, expect, readSave, startDemo, tapRightChoice, tapWrongChoice, test } from './fixtures.js';

test('home shows the title and game tiles', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.home-title')).toHaveText('Logic Lane');
  await expect(page.locator('.tile').first()).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Demo' })).toHaveCount(0); // hidden game
});

test('tile titles stay centred when a long name wraps onto two lines', async ({ page }) => {
  await page.goto('./');
  // Narrow tiles, so long names wrap with any font (on GitHub's Linux, "Pattern Train" wraps on a 390 px phone).
  await page.addStyleTag({ content: '.tiles { grid-template-columns: repeat(auto-fill, 110px); }' });
  const lines = await page.locator('.tile').evaluateAll((tiles) => tiles.map((tile) => {
    const title = /** @type {HTMLElement} */ (tile.querySelector('.tile-title'));
    const range = document.createRange();
    range.selectNodeContents(title);
    const t = tile.getBoundingClientRect();
    const middle = (t.left + t.right) / 2;
    const rects = [...range.getClientRects()];
    return { name: title.textContent, lines: new Set(rects.map((r) => Math.round(r.top))).size,
      offCentre: rects.filter((r) => Math.abs((r.left + r.right) / 2 - middle) > 3).length };
  }));
  expect(lines.some((l) => l.lines > 1), 'a title wraps, so this test means something').toBe(true);
  expect(lines.filter((l) => l.offCentre > 0)).toEqual([]);
});

test('opening a game with nothing saved goes to its picker', async ({ page }) => {
  await page.goto('./#/play/demo');
  await expect(page).toHaveURL(/#\/game\/demo$/);
  await expect(page.locator('.choice-easy')).toBeVisible();
});

test('difficulty picks the starting level', async ({ page }) => {
  await startDemo(page, 'medium');
  await expect(page.locator('.level-label')).toHaveText('Level 11');
});

test('reopening the app goes back into the same puzzle, with the same progress', async ({ page }) => {
  await startDemo(page);
  const layout = await demoLayout(page);
  await tapWrongChoice(page);
  // Saved right away, not only when the page closes: a tablet can kill the app without any warning.
  expect((await readSave(page)).state).toEqual({ wrong: 1 });
  await page.goto('./'); // an installed app always opens at its start page
  await expect(page).toHaveURL(/#\/play\/demo$/);
  expect(await demoLayout(page)).toBe(layout);
  expect((await readSave(page)).state).toEqual({ wrong: 1 });
});

test('solving celebrates, then shows the next puzzle', async ({ page }) => {
  await startDemo(page);
  const before = await readSave(page);
  await tapRightChoice(page);
  await expect(page.locator('.celebrate')).toBeVisible();
  await expect(page.locator('.celebrate')).toHaveCount(0, { timeout: 5000 });
  const after = await readSave(page);
  expect(after.n).toBe(before.n + 1);
  expect(after.seed).not.toBe(before.seed);
  expect(after.state).toBeNull();
  await expect(page.locator('.demo-choice').first()).toBeVisible();
});

test('Home keeps the game for Continue, but reopening stays on the home screen', async ({ page }) => {
  await startDemo(page);
  const layout = await demoLayout(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await page.goto('./');
  await expect(page.locator('.home-title')).toBeVisible();
  await page.goto('./#/game/demo');
  await page.locator('.choice-continue').click();
  await expect(page).toHaveURL(/#\/play\/demo$/);
  await expect(page.locator('.demo-choice').first()).toBeVisible();
  expect(await demoLayout(page)).toBe(layout);
});

test('the speaker reads the instruction, and the hint after a mistake', async ({ page }) => {
  await startDemo(page);
  const speaker = page.getByRole('button', { name: 'Read it to me' });
  await speaker.click();
  await tapWrongChoice(page);
  await speaker.click();
  const spoken = await page.evaluate(() => /** @type {any} */ (window).__spoken);
  expect(spoken[0]).toBe('Tap the same picture.');
  expect(spoken[1]).toMatch(/^Try again\. Find the \w+\.$/);
});

for (const [name, path] of [
  ['home', './'],
  ['picker', './#/game/demo'],
  ['play', null],
]) {
  test(`${name}: no sideways scrolling, every button at least 64px`, async ({ page }) => {
    if (path) await page.goto(path);
    else await startDemo(page, 'hard'); // most choices on screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, .tile')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0) // visible, including fixed-position elements
        .map((r) => Math.min(r.width, r.height)),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(64);
  });
}
