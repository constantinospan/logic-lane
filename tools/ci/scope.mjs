// Decides what a CI run tests (D20). No AI: fixed rules, unit-tested (tests/unit/ci-scope.test.js).
//
// - Push to main, manual runs, anything unsure: everything.
// - A PR that changes only Markdown files: "docs", the quick checks only (type check + unit tests, no browser tests).
// - A PR whose other files all belong to one game (its folder, its own test files, its snapshot pictures): "game".
//   The browser tests then leave out every OTHER game's tests (tagged @game:<id>); shared tests always run.
// - Anything else: "all".
// Then it counts the browser tests that will run and starts about one machine (shard) per 50, never fewer than 3.
//
// Usage (CI): node tools/ci/scope.mjs --event <github.event_name>
//   Writes mode, grep, shards and total to $GITHUB_OUTPUT and a short report to $GITHUB_STEP_SUMMARY.
//   Any error stops the job, so the required `test` check goes red (never a quiet skip).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isShipped } from '../../tests/shipped-files.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** About this many browser tests per machine. */
export const PER_SHARD = 50;
/** Never fewer machines than this (what CI used before step 10). */
export const MIN_SHARDS = 3;

/**
 * @typedef {object} Scope
 * @property {'all' | 'docs' | 'game'} mode
 * @property {string} [game]  The game, in "game" mode.
 * @property {string} grep  Playwright --grep-invert pattern ('' = leave nothing out).
 * @property {string} reason  One line for the run's summary.
 */

/**
 * Which game a changed file belongs to, or undefined if it's shared.
 * @param {string} file  Repo-relative path.
 * @param {string[]} ids  Every game id (folders in games/).
 * @returns {string | undefined}
 */
export function gameOf(file, ids) {
  const longestFirst = ids.slice().sort((a, b) => b.length - a.length);
  const folder = file.match(/^games\/([^/]+)\//)?.[1];
  if (folder) return ids.includes(folder) ? folder : undefined;
  const unit = file.match(/^tests\/unit\/games\/([^/]+)\.test\.js$/)?.[1];
  if (unit) return ids.includes(unit) ? unit : undefined;
  const e2e = file.match(/^tests\/e2e\/([^/]+)\.spec\.js$/)?.[1];
  if (e2e) return ids.includes(e2e) ? e2e : undefined;
  const picture = file.match(/^tests\/e2e\/visual\.spec\.js-snapshots\/([^/]+)\.png$/)?.[1];
  if (picture) return longestFirst.find((id) => picture.startsWith(`${id}-`));
  return undefined;
}

/**
 * What to run, from the event and the changed files.
 * @param {{ event: string, files: string[], ids: string[] }} input
 * @returns {Scope}
 */
export function decide({ event, files, ids }) {
  if (event !== 'pull_request') return { mode: 'all', grep: '', reason: `${event}: everything runs` };
  if (files.length === 0) return { mode: 'all', grep: '', reason: 'no changed files found, so everything runs' };
  // Markdown counts as docs, unless it's in a folder the site serves (then it's part of the site).
  const code = files.filter((f) => !f.endsWith('.md') || isShipped(f));
  if (code.length === 0) return { mode: 'docs', grep: '', reason: 'only Markdown files changed' };
  const owners = new Set(code.map((f) => gameOf(f, ids)));
  const [only] = owners;
  if (owners.size !== 1 || only === undefined) {
    const shared = code.find((f) => gameOf(f, ids) === undefined);
    return {
      mode: 'all',
      grep: '',
      reason: shared ? `a shared file changed (${shared})` : 'more than one game changed',
    };
  }
  const others = ids.filter((id) => id !== only && id !== 'demo').sort();
  return {
    mode: 'game',
    game: only,
    grep: others.length ? `@game:(${others.join('|')})(?![\\w-])` : '',
    reason: `only ${only} changed: other games' browser tests are left out`,
  };
}

/**
 * How many machines for this many browser tests.
 * @param {number} count
 * @returns {number}
 */
export function shardCount(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`no browser tests to run (count: ${count})`);
  return Math.min(count, Math.max(MIN_SHARDS, Math.ceil(count / PER_SHARD)));
}

/**
 * The test count from `playwright test --list` output ("Total: 312 tests in 9 files").
 * @param {string} text
 * @returns {number}
 */
export function parseCount(text) {
  const m = text.match(/^Total: (\d+) tests? in \d+ files?$/m);
  if (!m) throw new Error('could not read the test count from playwright --list');
  return Number(m[1]);
}

/** @returns {string[]} game ids: the folders in games/ */
export function gameIds() {
  return fs.readdirSync(path.join(ROOT, 'games'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => d.name).sort();
}

/**
 * Files the PR changes. CI checks out the PR's merge commit with its parent, so this is exactly what would merge.
 * Renames show as a delete plus an add, so a file moved out of a game still counts for that game.
 * @returns {string[]}
 */
function changedFiles() {
  const out = execFileSync('git', ['diff', '--no-renames', '--name-only', 'HEAD^1', 'HEAD'], { cwd: ROOT,
    encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/** @param {string} grep @returns {number} */
function countTests(grep) {
  const args = ['playwright', 'test', '--list', ...(grep ? ['--grep-invert', grep] : [])];
  return parseCount(execFileSync('npx', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function main() {
  const at = process.argv.indexOf('--event');
  const event = at > 0 ? process.argv[at + 1] : undefined;
  if (!event || event.startsWith('--')) throw new Error('usage: scope.mjs --event <event name>');
  const files = event === 'pull_request' ? changedFiles() : [];
  const scope = decide({ event, files, ids: gameIds() });
  const total = scope.mode === 'docs' ? 0 : countTests(scope.grep);
  const shards = scope.mode === 'docs' ? 0 : shardCount(total);
  const out = {
    mode: scope.mode,
    grep: scope.grep,
    shard_total: String(shards),
    shards: JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1)),
  };
  const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  const report = `### Test scope: ${scope.mode}\n${scope.reason}.\n\n` +
    (scope.mode === 'docs' ? 'Browser tests: none (docs only).\n' :
      `Browser tests: ${total} on ${shards} machines${scope.grep ? ` (left out: \`${scope.grep}\`)` : ''}.\n`) +
    (files.length ? `\nChanged files: ${files.length}.\n` : '');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  console.log(report);
  console.log(lines.join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
