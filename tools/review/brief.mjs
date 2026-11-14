// The agreed brief for a PR (D21): what the idea check said would be built, plus what the owner changed since, so the
// code reviewer can check the PR against it. Taken only from the idea check's own comments (posted by the workflow)
// and the owner's comments, never from the PR description the builder wrote. Used by tools/review/collect-inputs.sh.
//
// Usage: node tools/review/brief.mjs <threads.json>
//   threads.json: {"pr": <number>, "prComments": [...], "issues": [{"number": <n>, "comments": [...]}]}
//   (comments as the GitHub API returns them: user.login, created_at, body)
// Prints the brief as Markdown, or nothing when there's no idea check (then the brief check is skipped).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HEADINGS, MARKER } from '../idea/decide.mjs';

const OWNER = 'constantinospan';
const BOT = 'github-actions[bot]';
const MAX_BODY = 6000;

/**
 * @typedef {{user?: {login?: string}, created_at?: string, body?: string}} Comment
 * @typedef {{pr: number, prComments: Comment[], issues: {number: number, comments: Comment[]}[]}} Threads
 */

/**
 * An idea check in the current format that agreed a build or asked questions. The old scored format and the
 * stop/incomplete results don't count.
 * @param {Comment} c
 * @returns {boolean}
 */
export function isIdeaCheck(c) {
  if (c.user?.login !== BOT) return false;
  const lines = String(c.body ?? '').split('\n');
  return lines[0] === MARKER && (lines[1] === HEADINGS.build || lines[1] === HEADINGS.ask);
}

/**
 * @param {Threads} threads
 * @returns {string}  Markdown, oldest first; '' when there's no idea check at all.
 */
export function buildBrief(threads) {
  /** @type {{at: string, where: string, who: string, body: string}[]} */
  const entries = [];
  for (const issue of threads.issues ?? []) {
    for (const c of issue.comments ?? []) {
      if (isIdeaCheck(c)) entries.push({ at: String(c.created_at), where: `issue #${issue.number}`, who: 'idea check', body: String(c.body) });
    }
  }
  for (const c of threads.prComments ?? []) {
    if (isIdeaCheck(c)) entries.push({ at: String(c.created_at), where: `PR #${threads.pr}`, who: 'idea check', body: String(c.body) });
    else if (c.user?.login === OWNER) entries.push({ at: String(c.created_at), where: `PR #${threads.pr}`, who: 'owner', body: String(c.body) });
  }
  if (!entries.some((e) => e.who === 'idea check')) return '';
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const out = [
    '# Agreed brief',
    '',
    'From the idea check (posted by the workflow) and the owner, oldest first. Later entries override earlier ones.',
    'An owner comment that changes something on purpose is not a mismatch.',
  ];
  for (const e of entries) {
    const body = e.body.replace(MARKER, '').trim();
    out.push('', `## ${e.at} · ${e.who} · ${e.where}`, '', body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}…` : body);
  }
  return `${out.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tools/review/brief.mjs <threads.json>');
    process.exit(2);
  }
  process.stdout.write(buildBrief(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
