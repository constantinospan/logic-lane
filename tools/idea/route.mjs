// Decides whether an "@claude" request goes to the idea reviewer first (D21). No AI here, so a request can never
// talk its way past the check. Used by .github/workflows/claude.yml (main's copy) and described in CLAUDE.md for
// sessions.
//
// Usage: node tools/idea/route.mjs   (reads GITHUB_EVENT_PATH and GITHUB_EVENT_NAME; settings from main's checkout)
// Prints route=review|skip, reason=<word>, number=<issue or PR number>, kind=issue|pr.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSettings } from './score.mjs';

/**
 * Requests that skip the check. The WHOLE request (after "@claude", ignoring case, spaces and closing punctuation)
 * must match, so "fix CI and add a timer game" is still reviewed.
 * @type {{reason: string, pattern: RegExp}[]}
 */
export const SKIPS = [
  { reason: 'revert', pattern: /^revert (pr )?#\d+$/ },
  { reason: 'go-anyway', pattern: /^go anyway$/ },
  { reason: 'fix-review', pattern: /^fix the blocking items$/ },
  { reason: 'fix-ci', pattern: /^(fix (the )?ci|ci is red)$/ },
];

/**
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  return String(text ?? '')
    .replace(/@claude\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!,:;]+$/, '')
    .replace(/^[\s,:;-]+/, '')
    .toLowerCase();
}

/**
 * @param {string} text  The request.
 * @returns {string | null}  The skip reason, or null when it must be reviewed.
 */
export function skipReason(text) {
  const t = normalise(text);
  return SKIPS.find((s) => s.pattern.test(t))?.reason ?? null;
}

/**
 * The request text the owner wrote for this event. For a new issue that's the body; the title is used only when the
 * body says nothing besides "@claude".
 * @param {string} eventName
 * @param {any} event
 * @returns {string}
 */
export function requestText(eventName, event) {
  if (eventName === 'issues') {
    const body = String(event.issue?.body ?? '');
    return normalise(body) ? body : String(event.issue?.title ?? '');
  }
  if (eventName === 'pull_request_review') return String(event.review?.body ?? '');
  return String(event.comment?.body ?? '');
}

/**
 * @param {string} eventName
 * @param {any} event
 * @param {import('./score.mjs').Settings} settings
 * @returns {{route: 'review' | 'skip', reason: string, number: number, kind: 'issue' | 'pr'}}
 */
export function decide(eventName, event, settings) {
  const number = Number(event.issue?.number ?? event.pull_request?.number ?? 0);
  const kind = event.pull_request || event.issue?.pull_request ? 'pr' : 'issue';
  if (!settings.enabled) return { route: 'skip', reason: 'off', number, kind };
  const reason = skipReason(requestText(eventName, event));
  return reason ? { route: 'skip', reason, number, kind } : { route: 'review', reason: 'request', number, kind };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const settings = loadSettings(fs.readFileSync(path.join(root, 'tools/idea/settings.json'), 'utf8'));
  const event = JSON.parse(fs.readFileSync(String(process.env.GITHUB_EVENT_PATH), 'utf8'));
  const d = decide(String(process.env.GITHUB_EVENT_NAME), event, settings);
  console.log(`route=${d.route}\nreason=${d.reason}\nnumber=${d.number}\nkind=${d.kind}`);
}
