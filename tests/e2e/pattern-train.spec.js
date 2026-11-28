// Pattern train in a real browser: play to the end, a mistake and its hint, resume, and that the train and the
// choices fit the screen. The heavy checks (every level fair, difficulty rules) are unit tests (D20).
import { expect, readSave, test } from './fixtures.js';
import { generate } from '../../games/pattern-train/generate.js';
import { hintFor } from '../../games/pattern-train/view.js';
import { createRng } from '../../js/core/rng.js';
import patternTrain from '../../games/pattern-train/game.js';

test.use({ reducedMotion: 'reduce' }); // short celebration delay

const SEED = 'e2etst';

/** The puzzle the app will show for this seed and level (the same generator, run here). @param {number} level */
const puzzleAt = (level) => generate(level, createRng(SEED, level)).puzzle;

/**
 * Open Pattern train on a fixed puzzle, through a saved game, like a resume.
 * @param {import('@playwright/test').Page} page
 * @param {number} level
 * @param {unknown} [state]
 */
async function open(page, level, state = null) {
  await page.goto('./');
  await page.evaluate(
    ([lvl, seed, version, st]) => {
      const save = { gameId: 'pattern-train', gameVersion: version, level: lvl, n: 0, seed, state: st, active: true,
        savedAt: Date.now() };
      localStorage.setItem('logic-lane:resume', JSON.stringify(save));
    },
    /** @type {[number, string, number, unknown]} */ ([level, SEED, patternTrain.version, state]),
  );
  await page.goto('./#/play/pattern-train');
  await expect(page.locator('.pt-train')).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level, seed: SEED });
  return puzzleAt(level);
}

/** @param {import('@playwright/test').Page} page */
const lastSpoken = async (page) => {
  await page.getByRole('button', { name: 'Read it to me' }).click();
  return page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__spoken).at(-1));
};

/** @param {import('@playwright/test').Page} page @param {number} i */
const choice = (page, i) => page.locator(`.pt-choice[data-i="${i}"]`);

test('home has the Pattern Train tile, and it opens the picker', async ({ page }) => {
  await page.goto('./');
  await page.locator('.tile', { hasText: 'Pattern Train' }).click();
  await expect(page).toHaveURL(/#\/game\/pattern-train$/);
  await page.locator('.choice-easy').click();
  await expect(page.locator('.pt-train')).toBeVisible();
  expect(await lastSpoken(page)).toBe('What comes next? Tap it.');
  expect(await readSave(page)).toMatchObject({ gameId: 'pattern-train', level: 1 });
});

test('the train shows every carriage, with one empty', async ({ page }) => {
  const p = await open(page, 13);
  await expect(page.locator('.pt-car')).toHaveCount(p.cars.length);
  await expect(page.locator('.pt-gap')).toHaveCount(1);
  await expect(page.locator(`.pt-car[data-i="${p.gap}"]`)).toHaveAttribute('aria-label', 'Missing');
  await expect(page.locator('.pt-choice')).toHaveCount(p.choices.length);
  await expect(page.locator('.pt-car svg')).toHaveCount(p.cars.length - 1);
});

test('the right choice fills the gap and celebrates', async ({ page }) => {
  const p = await open(page, 1);
  await choice(page, p.answer).click();
  await expect(page.locator('.pt-gap')).toHaveCount(0);
  await expect(page.locator('.pt-filled svg')).toBeVisible();
  await expect(page.locator('.celebrate')).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level: 1, n: 1, state: null });
});

test('a wrong choice gets a gentle hint, fades, and survives a reload', async ({ page }) => {
  const p = await open(page, 13);
  const wrong = p.choices.findIndex((_, i) => i !== p.answer);
  const hint = page.locator('.pt-hint');
  await expect(hint).toHaveText('');
  await choice(page, wrong).click();
  await expect(page.locator('.celebrate')).toHaveCount(0);
  await expect(hint).toHaveText(hintFor(p, wrong));
  expect(await lastSpoken(page)).toBe(hintFor(p, wrong));
  await expect(choice(page, wrong)).toHaveClass(/pt-tried/);
  await expect(page.locator('.pt-gap')).toHaveCount(1); // nothing lost: still the same puzzle
  expect(await readSave(page)).toMatchObject({ level: 13, n: 0, state: { wrong: [wrong] } });

  await page.reload();
  await expect(choice(page, wrong)).toHaveClass(/pt-tried/);
  await expect(hint).toHaveText(hintFor(p, wrong));
  // A tried choice can still be tapped (no dead end), and the right one still works.
  await choice(page, wrong).click();
  expect(await readSave(page)).toMatchObject({ state: { wrong: [wrong] } }); // counted once
  await choice(page, p.answer).click();
  await expect(page.locator('.celebrate')).toBeVisible();
});

test('a broken save starts the same puzzle clean', async ({ page }) => {
  await open(page, 13, { wrong: ['x', 99, -1] });
  await expect(page.locator('.pt-tried')).toHaveCount(0);
  await expect(page.locator('.pt-hint')).toHaveText('');
});

for (const [name, level] of /** @type {[string, number][]} */ ([['a gap in the middle', 17], ['3D shapes', 21],
  ['two things at once', 29]])) {
  test(`${name} (level ${level}) plays to the end`, async ({ page }) => {
    const p = await open(page, level);
    if (level === 17) {
      expect(p.gap).toBeLessThan(p.cars.length - 1); // really in the middle
      expect(await lastSpoken(page)).toBe('What is missing? Tap it.');
    }
    if (level === 21) {
      await expect(page.locator('.pt-car[aria-label$="cube"], .pt-car[aria-label$="ball"], ' +
        '.pt-car[aria-label$="cone"], .pt-car[aria-label$="tube"]')).toHaveCount(p.cars.length - 1);
    }
    await choice(page, p.answer).click();
    await expect(page.locator('.celebrate')).toBeVisible();
  });
}

test('a second tap on the right choice moves on only once', async ({ page }) => {
  const p = await open(page, 1);
  await choice(page, p.answer).click();
  // Straight on the button, past the "no more taps" style, so the game's own guard is what's tested.
  await choice(page, p.answer).evaluate((b) => /** @type {HTMLButtonElement} */ (b).click());
  await expect(page.locator('.celebrate')).toBeVisible();
  expect(await readSave(page)).toMatchObject({ level: 1, n: 1 });
});

test('leaving just after the right tap never solves a puzzle by mistake', async ({ page }) => {
  const p = await open(page, 1);
  await choice(page, p.answer).click();
  await page.getByRole('button', { name: 'Home' }).click(); // before the train has finished tooting
  await expect(page.locator('.home-title')).toBeVisible();
  await page.waitForTimeout(500); // longer than the wait before "solved"
  await expect(page.locator('.celebrate')).toHaveCount(0);
  expect(await readSave(page)).toMatchObject({ level: 1, n: 0, active: false }); // the same puzzle, for Continue
});

for (const atEnd of [true, false]) {
  test(`says "${atEnd ? 'next' : 'missing'}" when the gap can be anywhere and is ${atEnd ? 'at the end' : 'inside'}`,
    async ({ page }) => {
      // Level 23 can put the gap anywhere: find a seed with the gap where this test wants it.
      let seed = '';
      for (let i = 0; !seed; i++) {
        const q = generate(23, createRng(`g${i}`, 23)).puzzle;
        if ((q.gap === q.cars.length - 1) === atEnd) seed = `g${i}`;
      }
      await page.goto('./');
      await page.evaluate(([sd, version]) => {
        localStorage.setItem('logic-lane:resume', JSON.stringify({ gameId: 'pattern-train', gameVersion: version,
          level: 23, n: 0, seed: sd, state: null, active: true, savedAt: Date.now() }));
      }, /** @type {[string, number]} */ ([seed, patternTrain.version]));
      await page.goto('./#/play/pattern-train');
      await expect(page.locator('.pt-train')).toBeVisible();
      expect(await readSave(page)).toMatchObject({ level: 23, seed });
      expect(await lastSpoken(page)).toBe(atEnd ? 'What comes next? Tap it.' : 'What is missing? Tap it.');
    });
}

test('fits a sideways phone with no scrolling', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await page.setViewportSize({ width: 667, height: 375 });
  await open(page, 30);
  const m = await page.evaluate(() => {
    const last = [...document.querySelectorAll('.pt-choice')].map((b) => b.getBoundingClientRect());
    return { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      w: innerWidth, h: innerHeight, bottom: Math.max(...last.map((b) => b.bottom)),
      smallest: Math.min(...last.flatMap((b) => [b.width, b.height])) };
  });
  expect(m.scrollW).toBeLessThanOrEqual(m.w);
  expect(m.scrollH).toBeLessThanOrEqual(m.h);
  expect(m.bottom).toBeLessThanOrEqual(m.h);
  expect(m.smallest).toBeGreaterThanOrEqual(64);
});

for (const width of [360, 390]) {
  test(`fits a ${width} px phone: one row of 8 carriages, big choices`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phone only');
    await page.setViewportSize({ width, height: 740 });
    await open(page, 30); // 8 carriages and 4 choices
    const m = await page.evaluate(() => {
      const box = (/** @type {Element} */ e) => e.getBoundingClientRect();
      const cars = [...document.querySelectorAll('.pt-car')].map(box);
      const choices = [...document.querySelectorAll('.pt-choice')].map(box);
      return {
        scrollW: document.documentElement.scrollWidth,
        w: innerWidth,
        rows: new Set(cars.map((b) => Math.round(b.top))).size,
        smallestCar: Math.min(...cars.map((b) => b.width)),
        rightmost: Math.max(...cars.map((b) => b.right)),
        smallestChoice: Math.min(...choices.flatMap((b) => [b.width, b.height])),
        gaps: choices.slice(1).map((b, i) => b.left - choices[i].right),
      };
    });
    expect(m.scrollW).toBeLessThanOrEqual(m.w); // no sideways scrolling
    expect(m.rows).toBe(1);
    expect(m.rightmost).toBeLessThanOrEqual(m.w);
    expect(m.smallestCar).toBeGreaterThanOrEqual(36);
    expect(m.smallestChoice).toBeGreaterThanOrEqual(64);
    for (const g of m.gaps) expect(g).toBeGreaterThanOrEqual(8);
  });
}

for (const level of [1, 24, 30]) {
  test(`fits the screen at level ${level}, with no scrolling`, async ({ page }) => {
    await open(page, level);
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      w: innerWidth,
      scrollH: document.documentElement.scrollHeight,
      h: innerHeight,
    }));
    expect(m.scrollW).toBeLessThanOrEqual(m.w);
    expect(m.scrollH).toBeLessThanOrEqual(m.h);
  });
}
