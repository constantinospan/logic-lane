// Scores the idea reviewer's findings and writes the comment the owner (and the builder) see (D21). No AI here: the
// reviewer only labels findings; this script turns the labels into a score with main's settings, so the AI never
// picks the number. Used by .github/workflows/claude.yml (main's copy) and by sessions (CLAUDE.md).
//
// Usage: node tools/idea/score.mjs <review.json> [--main] [--settings <file>] [--job <result>] [--out <dir>]
//                                  [--run-url <url>]
//   --main      read the settings from origin/main (sessions: so a branch can't lower its own bar)
//   --job       the reviewer job's result on GitHub; anything but "success" is incomplete
//   --out       write comment.md there
// Prints state=pass|fail|incomplete, score=<n>, go=true|false.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKER = '<!-- logic-lane:idea-review -->';
export const SEVERITIES = /** @type {const} */ (['blocker', 'major', 'question', 'minor']);
const SETTINGS_PATH = 'tools/idea/settings.json';
const MAX_FIELD = 1200;
const MAX_ITEMS = 20;

/**
 * @typedef {'blocker' | 'major' | 'question' | 'minor'} Severity
 * @typedef {{severity: Severity, title: string, detail: string}} Finding
 * @typedef {{summary: string, decided: string[], findings: Finding[]}} Review
 * @typedef {{enabled: boolean, passMark: number, weights: {major: number, question: number, minor: number}}} Settings
 * @typedef {{state: 'pass' | 'fail' | 'incomplete', score: number, blockers: number}} Score
 */

/**
 * Checks the settings file, so a typo can't quietly turn the gate into "everything passes".
 * @param {string} text  The JSON text.
 * @returns {Settings}
 */
export function loadSettings(text) {
  const s = JSON.parse(text);
  const whole = (/** @type {unknown} */ n, /** @type {number} */ max) =>
    Number.isInteger(n) && /** @type {number} */ (n) >= 0 && /** @type {number} */ (n) <= max;
  if (!s || typeof s !== 'object') throw new Error('settings: not an object');
  if (typeof s.enabled !== 'boolean') throw new Error('settings: "enabled" must be true or false');
  if (!whole(s.passMark, 100)) throw new Error('settings: "passMark" must be a whole number from 0 to 100');
  for (const k of ['major', 'question', 'minor']) {
    if (!whole(s.weights?.[k], 100)) throw new Error(`settings: "weights.${k}" must be a whole number from 0 to 100`);
  }
  return s;
}

/**
 * @param {string} text  The reviewer's JSON.
 * @returns {Review | null}  null if it's unusable (then the check is incomplete, never a pass).
 */
export function parseReview(text) {
  try {
    const r = JSON.parse(text);
    if (!r || typeof r.summary !== 'string' || !Array.isArray(r.findings)) return null;
    if (r.decided !== undefined && !(Array.isArray(r.decided) && r.decided.every((d) => typeof d === 'string'))) {
      return null;
    }
    const ok = (/** @type {any} */ f) =>
      f &&
      SEVERITIES.includes(f.severity) &&
      typeof f.title === 'string' &&
      typeof f.detail === 'string';
    if (!r.findings.every(ok)) return null;
    return { summary: r.summary, decided: r.decided ?? [], findings: r.findings };
  } catch {
    return null;
  }
}

/**
 * 100 minus the points for each finding; any blocker fails whatever the score.
 * @param {Review | null} review
 * @param {Settings} settings
 * @returns {Score}
 */
export function scoreReview(review, settings) {
  if (!review) return { state: 'incomplete', score: 0, blockers: 0 };
  let points = 0;
  let blockers = 0;
  for (const f of review.findings) {
    if (f.severity === 'blocker') blockers += 1;
    else points += settings.weights[f.severity];
  }
  const score = Math.max(0, 100 - points);
  const state = blockers === 0 && score >= settings.passMark ? 'pass' : 'fail';
  return { state, score, blockers };
}

/**
 * Safe for a public comment: no HTML, no @-mentions (they would notify people), one line, not too long.
 * @param {unknown} text
 * @returns {string}
 */
export function clean(text) {
  let s = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // No Markdown images or links: an image would make every viewer's browser fetch another site.
    .replace(/[[\]!]/g, (c) => `\\${c}`)
    .replace(/@(?=[A-Za-z0-9-])/g, '@\u200b')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MAX_FIELD) s = `${s.slice(0, MAX_FIELD)}…`;
  return s;
}

const LABEL = { blocker: 'Stop', major: 'Problem', question: 'Question', minor: 'Idea' };

/**
 * @param {Finding[]} list
 * @returns {string[]}
 */
function numbered(list) {
  const lines = list.slice(0, MAX_ITEMS).map((f, i) => {
    const title = clean(f.title).replace(/[.!?:]*$/, (end) => end || '.');
    return `${i + 1}. **${LABEL[f.severity]}: ${title}** ${clean(f.detail)}`;
  });
  if (list.length > MAX_ITEMS) lines.push(`…and ${list.length - MAX_ITEMS} more.`);
  return lines;
}

/**
 * The comment on the issue or PR. It is also the report the builder reads (idea-input/report.md), so it holds
 * only the result, never the reviewer's reasoning.
 * @param {Review | null} review
 * @param {Score} result
 * @param {Settings} settings
 * @param {string} [runUrl]
 * @returns {string}
 */
export function buildComment(review, result, settings, runUrl = '') {
  const out = [MARKER];
  if (!review || result.state === 'incomplete') {
    out.push('## 💡 Idea check: ⚠️ didn\'t finish', '');
    out.push('The idea check had no usable result, so nothing was built. Ask again with `@claude` and your request,' +
      ' or comment `@claude go anyway` to build it without the check.');
    if (runUrl) out.push('', `Log: ${runUrl}`);
    return `${out.join('\n')}\n`;
  }
  const order = (/** @type {Finding} */ f) => SEVERITIES.indexOf(f.severity);
  const findings = [...review.findings].sort((a, b) => order(a) - order(b));
  if (result.state === 'pass') {
    out.push(`## 💡 Idea check: ✅ ${result.score}/100, building it`, '', clean(review.summary));
  } else {
    const why = result.blockers ? 'it breaks a rule' : `pass mark ${settings.passMark}`;
    out.push(`## 💡 Idea check: ❌ ${result.score}/100 (${why})`, '', clean(review.summary));
  }
  if (review.decided.length) {
    out.push('', '**Decided from your answers:**', ...review.decided.slice(0, MAX_ITEMS).map((d) => `- ${clean(d)}`));
  }
  if (findings.length) {
    out.push('', result.state === 'pass' ? '**Small things the builder will keep in mind:**' : '**Please answer or decide:**');
    out.push(...numbered(findings));
  }
  if (result.state === 'fail') {
    out.push('', 'Reply `@claude` with your answers (numbers are fine) and it checks again. Or comment ' +
      '`@claude go anyway` to build it as you asked.');
  }
  return `${out.join('\n')}\n`;
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const a = { file: argv[0] ?? '' };
  for (let i = 1; i < argv.length; i += 1) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'main') a.main = true;
    else a[k] = argv[(i += 1)] ?? '';
  }
  return a;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node tools/idea/score.mjs <review.json> [--main] [--settings <file>] [--job <result>] [--out <dir>] [--run-url <url>]');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const settingsText = args.main
    ? execFileSync('git', ['-C', root, 'show', `origin/main:${SETTINGS_PATH}`], { encoding: 'utf8' })
    : fs.readFileSync(typeof args.settings === 'string' ? args.settings : path.join(root, SETTINGS_PATH), 'utf8');
  const settings = loadSettings(settingsText);
  const text = fs.existsSync(String(args.file)) ? fs.readFileSync(String(args.file), 'utf8') : '';
  const finished = args.job === undefined || args.job === 'success';
  const review = finished ? parseReview(text) : null;
  const result = scoreReview(review, settings);
  const comment = buildComment(review, result, settings, typeof args['run-url'] === 'string' ? args['run-url'] : '');
  if (typeof args.out === 'string') {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'comment.md'), comment);
  } else {
    process.stderr.write(comment);
  }
  console.log(`state=${result.state}\nscore=${result.score}\ngo=${result.state === 'pass'}`);
}
