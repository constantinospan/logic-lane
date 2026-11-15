// Arrow Path in a real browser: play each mode to the gem, a mistake, resume, leaving mid-walk, and that every mode
// fits the screen. The heavy checks (every level solvable, difficulty rules) are unit tests (D20).
import { expect, readSave, test } from './fixtures.js';
import { generate } from '../../games/arrow-path/generate.js';
import { runProgram, walkArrows } from '../../games/arrow-path/engine.js';
import { createRng } from '../../js/core/rng.js';
import arrowPath from '../../games/arrow-path/game.js';

/** @typedef {import('../../games/arrow-path/engine.js').Puzzle} Puzzle */
/** @typedef {import('../../games/arrow-path/engine.js').Dir} Dir */
/** @typedef {import('../../games/arrow-path/engine.js').Token} Token */

test.use({ reducedMotion: 'reduce' }); // short steps, so walks are quick

const SEED = 'e2etst';
/** @type {Dir[]} */
const ORDER = ['R', 'D', 'L', 'U']; // each tap on a square turns its arrow to the next of these

/** The puzzle the app will show for this seed and level (the same generator, run here). @param {number} level */
const puzzleAt = (level) => generate(level, createRng(SEED, level)).puzzle;

/**
 * Open Arrow Path on a fixed puzzle, through a saved game, like a resume.
 * @param {import('@playwright/test').Page} page
 * @param {number} level
 */
async function open(page, level) {
  await page.goto('./');
  await page.evaluate(
    ([lvl, seed, version]) => {
      const save = { gameId: 'arrow-path', gameVersion: version, level: lvl, n: 0, seed, state: null, active: true,
        savedAt: Date.now() };
      localStorage.setItem('logic-lane:resume', JSON.stringify(save));
    },
    /** @type {[number, string, number]} */ ([level, SEED, arrowPath.version]),
  );
  await page.goto('./#/play/arrow-path');
  await expect(page.locator('.ap-grid')).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level, seed: SEED });
  return puzzleAt(level);
}

/** @param {import('@playwright/test').Page} page @param {string} cellKey @param {Dir} d */
async function setArrow(page, cellKey, d) {
  const [r, c] = cellKey.split(',');
  const square = page.locator(`.ap-tap[data-r="${r}"][data-c="${c}"]`);
  for (let i = 0; i <= ORDER.indexOf(d); i++) await square.click();
}

/** @param {import('@playwright/test').Page} page @param {Token[]} program */
async function enter(page, program) {
  for (const t of program) await page.locator(`.ap-key[data-token="${t}"]`).click();
}

/** @param {import('@playwright/test').Page} page */
const lastSpoken = async (page) => {
  await page.getByRole('button', { name: 'Read it to me' }).click();
  return page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__spoken).at(-1));
};

test('home has the Arrow Path tile, and it opens the picker', async ({ page }) => {
  await page.goto('./');
  await page.locator('.tile', { hasText: 'Arrow Path' }).click();
  await expect(page).toHaveURL(/#\/game\/arrow-path$/);
  await page.locator('.choice-easy').click();
  await expect(page.locator('.ap-mode-board')).toBeVisible();
  expect(await lastSpoken(page)).toBe('Tap squares for arrows. Then press Go.');
});

test('board: put the arrows, press Go, the robot gets the gem', async ({ page }) => {
  const p = await open(page, 4);
  for (const [k, d] of Object.entries(/** @type {Record<string, Dir>} */ (p.solution))) await setArrow(page, k, d);
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.celebrate')).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level: 4, n: 1, state: null });
});

test('board: a wrong walk gets a gentle hint, keeps the arrows, and survives a reload', async ({ page }) => {
  const p = await open(page, 4);
  const [k, right] = Object.entries(/** @type {Record<string, Dir>} */ (p.solution))[0];
  const wrong = /** @type {Dir} */ (ORDER.find((d) => d !== right && walkArrows(p, { [k]: d }).result !== 'treasure'));
  await setArrow(page, k, wrong);
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.ap-busy')).toHaveCount(0); // the walk ended and the robot went back
  await expect(page.locator('.celebrate')).toHaveCount(0);
  expect(await lastSpoken(page)).toMatch(/Oops|Round and round/);
  const [r, c] = k.split(',');
  const square = page.locator(`.ap-tap[data-r="${r}"][data-c="${c}"]`);
  await expect(square).toHaveAttribute('aria-label', /arrow/);
  await page.reload();
  await expect(square).toHaveAttribute('aria-label', /arrow/);
  expect(await readSave(page)).toMatchObject({ level: 4, n: 0, state: { arrows: { [k]: wrong } } });
});

test('moves: build the list, fix a step, press Go', async ({ page }) => {
  const p = await open(page, 12);
  const solution = /** @type {Token[]} */ (p.solution);
  const slots = page.locator('.ap-slot');
  await expect(slots).toHaveCount(/** @type {number} */ (p.slots));
  // Too short first: "not there yet", and the last step is marked.
  await enter(page, solution.slice(0, 1));
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.ap-busy')).toHaveCount(0);
  expect(await lastSpoken(page)).toBe('Not there yet. Try again.');
  await expect(slots.nth(0)).toHaveClass(/ap-wrong/);
  // Add a wrong step, select it, replace it; take one away with ✖.
  await enter(page, solution.slice(1));
  const wrongTurn = solution[1] === 'U' ? 'D' : 'U';
  await slots.nth(1).click();
  await expect(slots.nth(1)).toHaveClass(/ap-selected/);
  await enter(page, [wrongTurn]);
  await expect(slots.nth(1)).not.toHaveClass(/ap-selected/);
  await slots.nth(1).click();
  await enter(page, [solution[1]]);
  await enter(page, ['R']);
  await page.getByRole('button', { name: 'Take away' }).click();
  await expect(slots.nth(solution.length)).toHaveClass(/ap-empty/);
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.celebrate')).toBeVisible();
});

test('loops: 🔁 fits a long route into a short list', async ({ page }) => {
  const p = await open(page, 14);
  const solution = /** @type {Token[]} */ (p.solution);
  expect(solution.some((t) => t === 'x2' || t === 'x3')).toBe(true);
  await enter(page, solution);
  await expect(page.locator('.ap-slot.ap-empty')).toHaveCount(0); // every slot used
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.celebrate')).toBeVisible();
});

test('debug: the list starts almost right; fixing the wrong arrow wins', async ({ page }) => {
  const p = await open(page, 21);
  const start = /** @type {Token[]} */ (p.program);
  const solution = /** @type {Token[]} */ (p.solution);
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.ap-busy')).toHaveCount(0);
  await expect(page.locator('.celebrate')).toHaveCount(0);
  const failAt = runProgram(p, start).failAt;
  await expect(page.locator('.ap-slot').nth(failAt)).toHaveClass(/ap-wrong/);
  const i = start.findIndex((t, j) => t !== solution[j]);
  await page.locator('.ap-slot').nth(i).click();
  await enter(page, [solution[i]]);
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.celebrate')).toBeVisible();
});

test('🏠 in the middle of a winning walk goes home cleanly, without counting the win', async ({ page }) => {
  const p = await open(page, 4);
  for (const [k, d] of Object.entries(/** @type {Record<string, Dir>} */ (p.solution))) await setArrow(page, k, d);
  await page.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await page.waitForTimeout(1500); // walk timers left behind would fire now
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.locator('.celebrate')).toHaveCount(0);
  expect(await readSave(page)).toMatchObject({ level: 4, n: 0, active: false }); // still this puzzle, for Continue
});

for (const level of [10, 20, 30]) {
  test(`level ${level} fits the screen, with big enough buttons`, async ({ page }) => {
    const p = await open(page, level);
    if (p.mode !== 'board') await enter(page, ['R', 'D']);
    const size = await page.evaluate(() => {
      const doc = /** @type {Element} */ (document.scrollingElement);
      return { scrollH: doc.scrollHeight, h: innerHeight, scrollW: doc.scrollWidth, w: innerWidth };
    });
    expect(size.scrollH).toBeLessThanOrEqual(size.h);
    expect(size.scrollW).toBeLessThanOrEqual(size.w);
    const targets = page.locator(p.mode === 'board' ? '.ap-tap, .ap-go' : '.ap-slot, .ap-key, .ap-go');
    for (const box of await targets.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
      expect(box.width).toBeGreaterThanOrEqual(64);
      expect(box.height).toBeGreaterThanOrEqual(64);
    }
  });
}
