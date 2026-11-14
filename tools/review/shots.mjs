// The play reviewer's standard screenshots (D19, checklist §1 and §4). Fixed, so this evidence doesn't depend on the
// AI remembering to collect it. Run by .github/workflows/review.yml from main's copy, against a server that's already
// serving the PR's files.
//
// Usage: node tools/review/shots.mjs <site-url> <out-dir> [game-id ...]
//   e.g. node tools/review/shots.mjs http://localhost:4173/logic-lane/ review-shots demo
// For the home screen, and for each game its picker and its first Easy puzzle, at phone, tablet and desktop size:
// saves a PNG, and writes <out-dir>/report.json with console errors and every request that isn't to the site.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {object} Size
 * @property {string} name
 * @property {'chromium' | 'webkit'} browser
 * @property {number} width
 * @property {number} height
 * @property {boolean} touch
 */

/** The same three sizes as the browser tests (playwright.config.js) and the checklist. @type {Size[]} */
export const SIZES = [
  { name: 'phone', browser: 'chromium', width: 390, height: 844, touch: true },
  { name: 'tablet', browser: 'webkit', width: 820, height: 1180, touch: true },
  { name: 'desktop', browser: 'chromium', width: 1280, height: 800, touch: false },
];

/**
 * @typedef {object} Screen
 * @property {string} slug  Used in the file name.
 * @property {string} hash  Route to open.
 * @property {string} caption
 * @property {boolean} [startEasy]  After opening, tap Easy to reach the first puzzle.
 */

/**
 * @param {string[]} games
 * @returns {Screen[]}
 */
export function screensFor(games) {
  /** @type {Screen[]} */
  const screens = [{ slug: 'home', hash: '#/', caption: 'Home' }];
  for (const id of games) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad game id: ${id}`);
    screens.push({ slug: `${id}-picker`, hash: `#/game/${id}`, caption: `${id}: picker` });
    screens.push({ slug: `${id}-play`, hash: `#/game/${id}`, caption: `${id}: first Easy puzzle`, startEasy: true });
  }
  return screens;
}

/**
 * A request is "external" if it leaves the site's own origin (checklist §4). data: and blob: URLs stay local.
 * @param {string} url
 * @param {string} siteOrigin
 * @returns {boolean}
 */
export function isExternal(url, siteOrigin) {
  if (/^(data|blob|about):/.test(url)) return false;
  try {
    return new URL(url).origin !== siteOrigin;
  } catch {
    return true;
  }
}

/**
 * @param {string} site  e.g. http://localhost:4173/logic-lane/
 * @param {string} outDir
 * @param {string[]} games
 */
async function main(site, outDir, games) {
  const { chromium, webkit } = await import('@playwright/test');
  fs.mkdirSync(outDir, { recursive: true });
  const origin = new URL(site).origin;
  const screens = screensFor(games);
  /** @type {{file: string, caption: string, size: string}[]} */
  const shots = [];
  /** @type {{size: string, screen: string, text: string}[]} */
  const consoleErrors = [];
  /** @type {{size: string, screen: string, url: string}[]} */
  const externalRequests = [];
  /** @type {{size: string, screen: string, error: string}[]} */
  const failures = [];

  for (const size of SIZES) {
    const browser = await (size.browser === 'webkit' ? webkit : chromium).launch();
    try {
      for (const screen of screens) {
        // A fresh context per screen: no saved game carries over, so every picture starts the same way.
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          hasTouch: size.touch,
          isMobile: size.touch && size.browser === 'chromium',
          serviceWorkers: 'block', // same as the visual tests: no stray update banner in pictures
        });
        const page = await context.newPage();
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push({ size: size.name, screen: screen.slug, text: msg.text() });
        });
        page.on('pageerror', (err) => consoleErrors.push({ size: size.name, screen: screen.slug, text: String(err) }));
        page.on('request', (req) => {
          if (isExternal(req.url(), origin)) externalRequests.push({ size: size.name, screen: screen.slug, url: req.url() });
        });
        try {
          await page.goto(new URL(screen.hash, site).href, { waitUntil: 'load' });
          if (screen.startEasy) {
            const easy = page.locator('.choice-easy');
            if (size.touch) await easy.tap();
            else await easy.click();
            await page.waitForURL(/#\/play\//);
          }
          await page.waitForTimeout(800); // let entry animations settle
          const file = `${size.name}-${screen.slug}.png`;
          await page.screenshot({ path: path.join(outDir, file) });
          shots.push({ file, caption: `${screen.caption} (${size.name})`, size: size.name });
        } catch (err) {
          failures.push({ size: size.name, screen: screen.slug, error: String(err).slice(0, 300) });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  const report = { site, games, shots, consoleErrors, externalRequests, failures };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${shots.length} screenshots, ${consoleErrors.length} console errors, ${externalRequests.length} external ` +
      `requests, ${failures.length} screens that couldn't be opened. Details: ${path.join(outDir, 'report.json')}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [site, outDir, ...games] = process.argv.slice(2);
  if (!site || !outDir) {
    console.error('Usage: node tools/review/shots.mjs <site-url> <out-dir> [game-id ...]');
    process.exit(2);
  }
  await main(site, outDir, games);
}
