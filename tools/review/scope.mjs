// Which AI reviewers a PR needs (D19), worked out from the files it changes. Used by .github/workflows/review.yml.
// The workflow always runs main's copy of this file (and of tests/shipped-files.js), so a PR can't change its own
// scope.
//
// Usage: node tools/review/scope.mjs <pr-checkout-dir>
// Prints key=value lines for $GITHUB_OUTPUT: play, code, rules_changed, games, files.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isShipped } from '../../tests/shipped-files.js';

/** Rule files: never docs-only, always reviewed (D15). */
const RULE_FILES = ['CLAUDE.md', 'docs/REVIEW-CHECKLIST.md', 'docs/DECISIONS.md'];
const RULE_FOLDERS = ['.claude/'];

/**
 * Files that steer agents or the review itself. A PR that changes any of them gets a banner on the verdict, so the
 * owner reads those changes themselves. Includes the files claude-code-action restores from the base branch.
 */
const STEERING_FILES = [
  ...RULE_FILES,
  '.mcp.json',
  '.claude.json',
  '.gitmodules',
  '.ripgreprc',
  'CLAUDE.local.md',
  'tests/shipped-files.js',
];
const STEERING_FOLDERS = [...RULE_FOLDERS, '.husky/', '.github/', 'tools/review/'];

/**
 * @param {string} file  Repo-relative path.
 * @returns {boolean}
 */
export function isRuleFile(file) {
  return RULE_FILES.includes(file) || RULE_FOLDERS.some((d) => file.startsWith(d));
}

/**
 * Docs-only files don't need a review: Markdown anywhere and anything under docs/, except the rule files and other
 * files that steer agents or the review (isSteering), which always get the code reviewer.
 * @param {string} file
 * @returns {boolean}
 */
export function isDocsOnly(file) {
  if (isRuleFile(file) || isSteering(file)) return false;
  return file.endsWith('.md') || file.startsWith('docs/');
}

/**
 * @param {string} file
 * @returns {boolean}
 */
export function isSteering(file) {
  return STEERING_FILES.includes(file) || STEERING_FOLDERS.some((d) => file.startsWith(d));
}

/**
 * Game ids whose screens the play reviewer should look at. A change to one game's folder shows that game. Any other
 * shipped change (shared code, styles, sw.js) can affect every game, so it shows all of them.
 * @param {string[]} files  Changed files.
 * @param {string[]} allGames  Every game id in the PR's checkout.
 * @returns {string[]}  Sorted, unique.
 */
export function gamesToShow(files, allGames) {
  const shipped = files.filter(isShipped);
  /** @type {Set<string>} */
  const games = new Set();
  for (const file of shipped) {
    const m = /^games\/([^/]+)\//.exec(file);
    if (!m) return [...allGames].sort();
    if (allGames.includes(m[1])) games.add(m[1]);
  }
  return [...games].sort();
}

/**
 * @typedef {object} Scope
 * @property {boolean} play  A shipped file changed: the play reviewer runs.
 * @property {boolean} code  Not docs-only: the code reviewer runs.
 * @property {boolean} rulesChanged  Rule or review files changed: the verdict gets a banner.
 * @property {string[]} games  Games to show in screenshots.
 */

/**
 * @param {string[]} files  Changed files (both sides of a rename).
 * @param {string[]} allGames
 * @returns {Scope}
 */
export function classify(files, allGames) {
  const play = files.some(isShipped);
  return {
    play,
    code: files.some((f) => !isDocsOnly(f)),
    rulesChanged: files.some(isSteering),
    games: play ? gamesToShow(files, allGames) : [],
  };
}

/**
 * @param {Scope} scope
 * @param {string[]} files
 * @returns {string}  Lines for $GITHUB_OUTPUT.
 */
export function formatOutput(scope, files) {
  return [
    `play=${scope.play}`,
    `code=${scope.code}`,
    `rules_changed=${scope.rulesChanged}`,
    `games=${scope.games.join(' ')}`,
    `files=${files.length}`,
  ].join('\n');
}

/**
 * Files the PR changes compared with main, both sides of renames.
 * @param {string} dir  The PR's checkout (full history, with origin/main).
 * @returns {string[]}
 */
export function changedFiles(dir) {
  const out = execFileSync('git', ['-C', dir, 'diff', '--name-only', '--no-renames', 'origin/main...HEAD'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * Game ids in a checkout: the folders under games/.
 * @param {string} dir
 * @returns {string[]}
 */
export function gameIds(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-tree', '-d', '--name-only', 'HEAD', 'games/'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^games\//, ''))
    .filter((id) => /^[a-z0-9-]+$/.test(id));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node tools/review/scope.mjs <pr-checkout-dir>');
    process.exit(2);
  }
  const files = changedFiles(dir);
  console.log(formatOutput(classify(files, gameIds(dir)), files));
}
