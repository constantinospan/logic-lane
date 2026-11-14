// Builds the ONE verdict comment from the two AI reviewers' results (D19), plus the fixed checks from shots.mjs.
// No AI here: plain rules, so the verdict, the Blocking list the fix run gets, and the fix-round limit are
// predictable. Run by .github/workflows/review.yml from main's copy; never runs PR code.
//
// Usage: node tools/review/verdict.mjs <out-dir>   (inputs come from environment variables, see readInput)
// Writes <out-dir>/comment.md and <out-dir>/blocking.md, prints state=pass|fail|incomplete for $GITHUB_OUTPUT.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- logic-lane:ai-review -->';
export const MAX_FIX_ROUNDS = 2; // D17
const MAX_FIELD = 1500;
const MAX_ITEMS = 25;

/**
 * @typedef {object} Finding
 * @property {string} title
 * @property {string} evidence
 * @property {string} [where]
 */

/**
 * What each AI reviewer returns (tools/review/schema.json).
 * @typedef {object} ReviewResult
 * @property {string} summary
 * @property {Finding[]} blocking
 * @property {Finding[]} suggestions
 * @property {string[]} [not_applicable]
 * @property {{file: string, caption: string}[]} [screenshots]
 */

/**
 * One reviewer as the verdict sees it.
 * @typedef {object} Reviewer
 * @property {boolean} needed  The scope said it should run.
 * @property {string} job  The job's result: success, failure, cancelled or skipped.
 * @property {string} json  Its structured output ('' if none).
 */

/**
 * The fixed checks from shots.mjs (report.json).
 * @typedef {object} ShotsReport
 * @property {{file: string, caption: string, size: string}[]} shots
 * @property {{size: string, screen: string, text: string}[]} consoleErrors
 * @property {{size: string, screen: string, url: string}[]} externalRequests
 * @property {{size: string, screen: string, error: string}[]} failures
 */

/**
 * @typedef {object} VerdictInput
 * @property {Reviewer} play
 * @property {Reviewer} code
 * @property {boolean} rulesChanged
 * @property {string} sha  Head commit reviewed.
 * @property {ShotsReport | null} report
 * @property {string[]} shotFiles  PNGs that really exist (only these get embedded).
 * @property {string} shotsBase  URL prefix the PNGs are served from ('' = not published).
 * @property {number} fixRounds  Fix rounds already used on this PR.
 * @property {boolean} fixOn  The AI_FIX switch.
 */

/**
 * @typedef {object} Verdict
 * @property {'pass' | 'fail' | 'incomplete' | 'none'} state
 * @property {string} comment  Markdown for the PR ('' when state is none).
 * @property {string} blocking  Markdown list for the fix run ('' unless fail).
 * @property {string} status  Short text for the ai-review commit status.
 */

/**
 * Make reviewer text safe to post: no HTML (so no hidden markers or images), no @-mentions that would notify
 * people, and a length cap.
 * @param {unknown} text
 * @returns {string}
 */
export function clean(text) {
  let s = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/\r?\n+/g, ' ')
    .trim();
  if (s.length > MAX_FIELD) s = `${s.slice(0, MAX_FIELD)}…`;
  return s;
}

/**
 * @param {Reviewer} r
 * @returns {ReviewResult | null}  null if it didn't finish or its output is unusable.
 */
export function parseResult(r) {
  if (!r.needed || r.job !== 'success' || !r.json) return null;
  try {
    const data = JSON.parse(r.json);
    if (!data || !Array.isArray(data.blocking) || !Array.isArray(data.suggestions)) return null;
    const ok = (/** @type {unknown} */ f) =>
      typeof f === 'object' && f !== null && 'title' in f && 'evidence' in f;
    if (!data.blocking.every(ok) || !data.suggestions.every(ok)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Blocking items from the fixed checks: console errors (§1) and requests leaving the site (§4).
 * @param {ShotsReport | null} report
 * @returns {Finding[]}
 */
export function fixedFindings(report) {
  if (!report) return [];
  /** @type {Finding[]} */
  const out = [];
  const errors = report.consoleErrors ?? [];
  if (errors.length) {
    const e = errors[0];
    out.push({
      title: `Errors in the browser console (${errors.length})`,
      evidence: `First one, ${e.size}, ${e.screen} screen: ${e.text}`,
      where: 'tools/review/shots.mjs report',
    });
  }
  const external = report.externalRequests ?? [];
  if (external.length) {
    const urls = [...new Set(external.map((r) => r.url))].slice(0, 5).join(', ');
    out.push({
      title: `Requests to other sites (${external.length})`,
      evidence: `The site must load only its own files. Seen: ${urls}`,
      where: 'tools/review/shots.mjs report',
    });
  }
  return out;
}

/**
 * @param {Finding} f
 * @param {string} who
 * @returns {string}
 */
function line(f, who) {
  const where = f.where ? ` (${clean(f.where)})` : '';
  return `**[${who}] ${clean(f.title)}**: ${clean(f.evidence)}${where}`;
}

/**
 * @param {Reviewer} r
 * @param {ReviewResult | null} result
 * @param {number} blockingCount
 * @returns {string}
 */
function badge(r, result, blockingCount) {
  if (!r.needed) return 'not needed';
  if (!result) return "⚠️ didn't finish";
  return blockingCount ? `❌ ${blockingCount} to fix` : '✅';
}

/**
 * Screenshots as a table: one row per screen, one column per size, so the phone shows them side by side.
 * @param {VerdictInput} input
 * @param {ReviewResult | null} play
 * @returns {string[]}
 */
function screenshotSection(input, play) {
  if (!input.shotsBase || !input.shotFiles.length) return [];
  const safe = (/** @type {string} */ f) => /^[A-Za-z0-9._-]+\.png$/.test(f) && input.shotFiles.includes(f);
  const img = (/** @type {string} */ f, /** @type {string} */ alt) =>
    `<a href="${input.shotsBase}${f}"><img src="${input.shotsBase}${f}" width="180" alt="${clean(alt).replace(/"/g, '&quot;')}"></a>`;
  const out = ['', '### Screenshots'];

  const standard = (input.report?.shots ?? []).filter((s) => safe(s.file));
  /** @type {Map<string, Record<string, string>>} */
  const rows = new Map();
  for (const s of standard) {
    const screen = s.file.replace(/^(phone|tablet|desktop)-/, '').replace(/\.png$/, '');
    const row = rows.get(screen) ?? {};
    row[s.size] = img(s.file, s.caption);
    rows.set(screen, row);
  }
  if (rows.size) {
    out.push('', '| Screen | Phone | Tablet | Desktop |', '|---|---|---|---|');
    for (const [screen, row] of rows) {
      out.push(`| ${clean(screen)} | ${row.phone ?? ''} | ${row.tablet ?? ''} | ${row.desktop ?? ''} |`);
    }
  }

  const shown = new Set(standard.map((s) => s.file));
  const extra = (play?.screenshots ?? []).filter((s) => safe(s.file) && !shown.has(s.file)).slice(0, 12);
  if (extra.length) {
    out.push('', 'From the play reviewer:', '');
    for (const s of extra) out.push(`${img(s.file, s.caption)} ${clean(s.caption)}`, '');
  }
  return out;
}

/**
 * @param {VerdictInput} input
 * @returns {Verdict}
 */
export function buildVerdict(input) {
  if (!input.play.needed && !input.code.needed) {
    return { state: 'none', comment: '', blocking: '', status: '' };
  }
  const play = parseResult(input.play);
  const code = parseResult(input.code);
  const incomplete = (input.play.needed && !play) || (input.code.needed && !code);

  const fixed = input.play.needed ? fixedFindings(input.report) : [];
  /** @type {string[]} */
  const blocking = [
    ...fixed.map((f) => line(f, 'check')),
    ...(play?.blocking ?? []).map((f) => line(f, 'play')),
    ...(code?.blocking ?? []).map((f) => line(f, 'code')),
  ].slice(0, MAX_ITEMS);
  const suggestions = [
    ...(play?.suggestions ?? []).map((f) => line(f, 'play')),
    ...(code?.suggestions ?? []).map((f) => line(f, 'code')),
  ].slice(0, MAX_ITEMS);

  /** @type {Verdict['state']} */
  const state = incomplete ? 'incomplete' : blocking.length ? 'fail' : 'pass';
  const sha7 = input.sha.slice(0, 7);
  const headline = {
    pass: '## ✅ AI review: pass',
    fail: `## ❌ AI review: ${blocking.length} to fix`,
    incomplete: "## ⚠️ AI review didn't finish",
  }[state];

  const playBlocking = fixed.length + (play?.blocking.length ?? 0);
  const out = [
    MARKER,
    headline,
    '',
    `Commit \`${sha7}\` · Play review: ${badge(input.play, play, playBlocking)} · Code review: ${badge(input.code, code, code?.blocking.length ?? 0)}`,
  ];
  if (input.rulesChanged) {
    out.push(
      '',
      '> ⚠️ **This PR changes the rules or the review itself** (agent rules, checklist, decisions, workflows or ' +
        'review scripts). It was judged by `main`\'s rules. Read those changes yourself before merging.',
    );
  }
  for (const [name, r] of /** @type {const} */ ([['Play', play], ['Code', code]])) {
    if (r?.summary) out.push('', `**${name}:** ${clean(r.summary)}`);
  }
  if (blocking.length) out.push('', '### Blocking', '', ...blocking.map((b, i) => `${i + 1}. ${b}`));
  if (suggestions.length) out.push('', '### Suggestions', '', ...suggestions.map((s) => `- ${s}`));
  if (input.play.needed && input.report?.failures?.length) {
    const f = input.report.failures[0];
    out.push('', `_Couldn't take every standard screenshot (${input.report.failures.length}); first: ${clean(f.size)} ${clean(f.screen)}: ${clean(f.error)}_`);
  }
  out.push(...screenshotSection(input, play));

  out.push('', '---', nextStep(state, input));
  let comment = out.join('\n');
  if (comment.length > 60000) comment = `${comment.slice(0, 60000)}\n\n…(cut short)`;

  return {
    state,
    comment,
    blocking: state === 'fail' ? `${blocking.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n` : '',
    status: { pass: 'Pass', fail: `${blocking.length} to fix`, incomplete: "Didn't finish" }[state],
  };
}

/**
 * What the owner (or the fix loop) does next. Keep in step with the fix job's conditions in review.yml.
 * @param {'pass' | 'fail' | 'incomplete'} state
 * @param {VerdictInput} input
 * @returns {string}
 */
export function nextStep(state, input) {
  if (state === 'pass') {
    return input.play.needed
      ? 'Next: look at the screenshots, then merge if you\'re happy.'
      : 'Next: merge if you\'re happy.';
  }
  if (state === 'incomplete') {
    return 'Next: a reviewer stopped before finishing, so there\'s no verdict and no automatic fix. Re-run the ' +
      '**AI review** workflow from the Actions tab, or review it yourself.';
  }
  if (!input.fixOn) {
    return 'Next: automatic fixes are off. Comment `@claude fix the Blocking items` on this PR, or fix by hand.';
  }
  if (input.fixRounds >= MAX_FIX_ROUNDS) {
    return `Next: ${MAX_FIX_ROUNDS} automatic fix rounds are used up. Over to you: comment \`@claude\` with what to ` +
      'do, or fix by hand.';
  }
  return `Next: automatic fix round ${input.fixRounds + 1} of ${MAX_FIX_ROUNDS} is starting.`;
}

/**
 * Should the fix job run? Same rule as nextStep, in one place.
 * @param {Verdict['state']} state
 * @param {VerdictInput} input
 * @returns {boolean}
 */
export function shouldFix(state, input) {
  return state === 'fail' && input.fixOn && input.fixRounds < MAX_FIX_ROUNDS;
}

/**
 * Inputs from the workflow, all as environment variables (never pasted into a shell command).
 * @param {NodeJS.ProcessEnv} env
 * @returns {VerdictInput}
 */
export function readInput(env) {
  const shotsDir = env.SHOTS_DIR ?? '';
  /** @type {ShotsReport | null} */
  let report = null;
  /** @type {string[]} */
  let shotFiles = [];
  if (shotsDir && fs.existsSync(shotsDir)) {
    shotFiles = fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png'));
    const file = path.join(shotsDir, 'report.json');
    if (fs.existsSync(file)) {
      try {
        report = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        report = null;
      }
    }
  }
  return {
    play: { needed: env.PLAY_NEEDED === 'true', job: env.PLAY_JOB ?? '', json: env.PLAY_JSON ?? '' },
    code: { needed: env.CODE_NEEDED === 'true', job: env.CODE_JOB ?? '', json: env.CODE_JSON ?? '' },
    rulesChanged: env.RULES_CHANGED === 'true',
    sha: env.HEAD_SHA ?? '',
    report,
    shotFiles,
    shotsBase: env.SHOTS_BASE ?? '',
    fixRounds: Number(env.FIX_ROUNDS ?? '0') || 0,
    fixOn: env.AI_FIX === 'on',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Usage: node tools/review/verdict.mjs <out-dir>');
    process.exit(2);
  }
  const input = readInput(process.env);
  const v = buildVerdict(input);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'comment.md'), v.comment);
  fs.writeFileSync(path.join(outDir, 'blocking.md'), v.blocking);
  console.log(`state=${v.state}\nstatus=${v.status}\nfix=${shouldFix(v.state, input)}`);
}
