// Decides what happens to a request after the idea reviewer has labelled its findings (D21). No AI here: the reviewer
// only labels; these fixed rules decide, with main's settings. Used by .github/workflows/claude.yml (main's copy)
// and by sessions (CLAUDE.md step 0).
//
// Rules: any blocker → stop. Any question or problem, or more assumptions than maxAssumptions → ask (too many
// assumptions are all asked as questions). Otherwise → build. No usable reviewer output → incomplete (never builds).
//
// Usage: node tools/idea/decide.mjs <review.json> [--main] [--settings <file>] [--job <result>] [--out <dir>]
//                                   [--run-url <url>]
//   --main      read the settings from origin/main (sessions: so a branch can't loosen its own rules)
//   --job       the reviewer job's result on GitHub; anything but "success" is incomplete
//   --out       write comment.md there (otherwise the comment goes to stderr)
// Prints state=build|ask|stop|incomplete and go=true|false.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKER = '<!-- logic-lane:idea-review -->';
export const KINDS = /** @type {const} */ (['blocker', 'question', 'problem', 'assumption', 'note']);
export const HEADINGS = {
  build: '## 💡 Idea check: ✅ building it',
  ask: '## 💡 Idea check: ❓ questions first',
  stop: "## 💡 Idea check: 🛑 can't build this as asked",
  incomplete: "## 💡 Idea check: ⚠️ didn't finish",
};
const SETTINGS_PATH = 'tools/idea/settings.json';
const MAX_FIELD = 1200;
const MAX_ITEMS = 20;
const MAX_BRIEF = 8;
const MAX_ASSUMPTIONS = 10;

/**
 * @typedef {'blocker' | 'question' | 'problem' | 'assumption' | 'note'} Kind
 * @typedef {{kind: Kind, title: string, detail: string, options?: string[], default?: string}} Finding
 * @typedef {{summary: string, brief: string[], decided: string[], findings: Finding[]}} Review
 * @typedef {{enabled: boolean, maxAssumptions: number}} Settings
 * @typedef {'build' | 'ask' | 'stop' | 'incomplete'} State
 * @typedef {object} Decision
 * @property {State} state
 * @property {Finding[]} blockers
 * @property {Finding[]} asks  Questions, problems and (when over the cap) assumptions, in one numbered list.
 * @property {Finding[]} assumptions  Only when building.
 * @property {Finding[]} notes
 * @property {boolean} capped  Too many assumptions, so they're asked as questions.
 */

/**
 * Checks the settings file, so a typo can't quietly loosen the gate.
 * @param {string} text  The JSON text.
 * @returns {Settings}
 */
export function loadSettings(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object') throw new Error('settings: not an object');
  if (typeof s.enabled !== 'boolean') throw new Error('settings: "enabled" must be true or false');
  const m = s.maxAssumptions;
  if (!Number.isInteger(m) || m < 0 || m > MAX_ASSUMPTIONS) {
    throw new Error(`settings: "maxAssumptions" must be a whole number from 0 to ${MAX_ASSUMPTIONS}`);
  }
  return { enabled: s.enabled, maxAssumptions: m };
}

/** @param {unknown} a @returns {a is string[]} */
const strings = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');

/**
 * @param {string} text  The reviewer's JSON (tools/idea/schema.json).
 * @returns {Review | null}  null if it's unusable (then the check is incomplete, never a build).
 */
export function parseReview(text) {
  try {
    const r = JSON.parse(text);
    if (!r || typeof r.summary !== 'string' || !strings(r.brief) || !Array.isArray(r.findings)) return null;
    if (r.decided !== undefined && !strings(r.decided)) return null;
    /** @type {Finding[]} */
    const findings = [];
    for (const f of r.findings) {
      if (!f || !KINDS.includes(f.kind) || typeof f.title !== 'string' || typeof f.detail !== 'string') return null;
      if (f.options !== undefined && !strings(f.options)) return null;
      if (f.default !== undefined && typeof f.default !== 'string') return null;
      // An assumption without a default is really a question.
      const kind = f.kind === 'assumption' && !f.default?.trim() ? 'question' : f.kind;
      findings.push({ ...f, kind });
    }
    return { summary: r.summary, brief: r.brief, decided: r.decided ?? [], findings };
  } catch {
    return null;
  }
}

/**
 * The fixed rules.
 * @param {Review | null} review
 * @param {Settings} settings
 * @returns {Decision}
 */
export function decide(review, settings) {
  const empty = { blockers: [], asks: [], assumptions: [], notes: [], capped: false };
  if (!review) return { state: 'incomplete', ...empty };
  const of = (/** @type {Kind} */ k) => review.findings.filter((f) => f.kind === k);
  const blockers = of('blocker');
  const notes = of('note');
  let assumptions = of('assumption');
  const capped = assumptions.length > settings.maxAssumptions;
  /** @type {Finding[]} */
  const asks = [...of('question'), ...of('problem')];
  if (capped) {
    asks.push(
      ...assumptions.map((a) => ({
        ...a,
        kind: /** @type {Kind} */ ('question'),
        options: [/** @type {string} */ (a.default), 'something else'],
      })),
    );
    assumptions = [];
  }
  /** @type {State} */
  const state = blockers.length ? 'stop' : asks.length ? 'ask' : 'build';
  return { state, blockers, asks, assumptions: state === 'build' ? assumptions : [], notes, capped };
}

/**
 * Safe for a public comment: no HTML, no @-mentions (they would notify people), no Markdown images or links (an image
 * would make every viewer's browser fetch another site), one line, not too long.
 * @param {unknown} text
 * @returns {string}
 */
export function clean(text) {
  let s = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[[\]!]/g, (c) => `\\${c}`)
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MAX_FIELD) s = `${s.slice(0, MAX_FIELD)}…`;
  return s;
}

/** @param {string} title */
const titled = (title) => clean(title).replace(/[.?:]*$/, (end) => end || '.');

/**
 * @param {Finding[]} list
 * @param {(f: Finding, n: number) => string[]} line
 * @returns {string[]}
 */
function numbered(list, line) {
  const out = list.slice(0, MAX_ITEMS).flatMap((f, i) => line(f, i + 1));
  if (list.length > MAX_ITEMS) out.push(`…and ${list.length - MAX_ITEMS} more.`);
  return out;
}

/** @param {Review} review @returns {string[]} */
function decidedLines(review) {
  if (!review.decided.length) return [];
  return ['', '**Decided from your answers:**', ...review.decided.slice(0, MAX_ITEMS).map((d) => `- ${clean(d)}`)];
}

/** @param {Finding[]} notes @returns {string[]} */
function noteLines(notes) {
  if (!notes.length) return [];
  return ['', '**Notes** (optional for the builder, they never change what gets built):',
    ...notes.slice(0, MAX_ITEMS).map((n) => `- **${titled(n.title)}** ${clean(n.detail)}`)];
}

/**
 * The comment on the issue or PR. It's also what the builder reads (idea-input/report.md) and the brief the code
 * reviewer checks the PR against, so it holds only the result, never the reviewer's reasoning.
 * @param {Review | null} review
 * @param {Decision} d
 * @param {string} [runUrl]
 * @returns {string}
 */
export function buildComment(review, d, runUrl = '') {
  const out = [MARKER, HEADINGS[d.state], ''];
  if (!review || d.state === 'incomplete') {
    out.push('The idea check had no usable result, so nothing was built. Ask again with `@claude` and your request,' +
      ' or comment `@claude go anyway` to build it without the check.');
    if (runUrl) out.push('', `Log: ${runUrl}`);
    return `${out.join('\n')}\n`;
  }
  out.push(clean(review.summary));
  out.push(...decidedLines(review));

  if (d.state === 'stop') {
    out.push('', '**Against the rules:**');
    out.push(...numbered(d.blockers, (f, n) => [`${n}. **${titled(f.title)}** ${clean(f.detail)}`]));
    out.push('', 'Nothing was built. Change the request, or comment `@claude go anyway`: the builder still keeps' +
      ' every "Never do" rule.');
    return `${out.join('\n')}\n`;
  }

  if (d.state === 'ask') {
    out.push('', d.capped
      ? '**Please answer** (the request needs too many guesses, so every guess is asked here):'
      : '**Please answer:**');
    out.push(...numbered(d.asks, (f, n) => {
      const head = f.kind === 'problem'
        ? `${n}. **Problem: ${titled(f.title)}** ${clean(f.detail)} Change the decision, or drop this part?`
        : `${n}. **${titled(f.title)}** ${clean(f.detail)}`;
      const opts = (f.options ?? []).slice(0, 6).map((o, i) => `   - **${n}${String.fromCharCode(97 + i)}:** ${clean(o)}`);
      return [head, ...opts];
    }));
    out.push(...noteLines(d.notes));
    out.push('', 'Reply like `@claude 1a 2b`, or `@claude 1b: your own words`, and it checks again. Or comment' +
      ' `@claude go anyway` to build it as you asked.');
    return `${out.join('\n')}\n`;
  }

  // build
  out.push('', '**What will be built:**', ...review.brief.slice(0, MAX_BRIEF).map((l) => `- ${clean(l)}`));
  if (d.assumptions.length) {
    out.push('', '**Assumptions** (reply `@claude 1: …` to change one):');
    out.push(...numbered(d.assumptions, (f, n) =>
      [`${n}. **${titled(f.title)}** ${clean(f.default)}${f.detail ? ` (${clean(f.detail)})` : ''}`]));
  }
  out.push(...noteLines(d.notes));
  out.push('', 'A correction before the PR exists rebuilds on a new branch: use the newest **Create PR** link. Once' +
    ' the PR is open, comment `@claude` on the PR instead.');
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
    console.error('Usage: node tools/idea/decide.mjs <review.json> [--main] [--settings <file>] [--job <result>] [--out <dir>] [--run-url <url>]');
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
  const d = decide(review, settings);
  const comment = buildComment(review, d, typeof args['run-url'] === 'string' ? args['run-url'] : '');
  if (typeof args.out === 'string') {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'comment.md'), comment);
  } else {
    process.stderr.write(comment);
  }
  console.log(`state=${d.state}\ngo=${d.state === 'build'}`);
}
