// The idea gate's score (D21): tools/idea/score.mjs. The AI only labels findings; this script decides.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildComment,
  clean,
  loadSettings,
  MARKER,
  parseReview,
  scoreReview,
  SEVERITIES,
} from '../../tools/idea/score.mjs';

const SETTINGS_FILE = new URL('../../tools/idea/settings.json', import.meta.url);
const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../tools/idea/schema.json', import.meta.url), 'utf8'));
const SETTINGS = { enabled: true, passMark: 75, weights: { major: 15, question: 10, minor: 5 } };

/** @param {...string} severities */
const review = (...severities) => ({
  summary: 'A new colour for the arrows.',
  decided: [],
  findings: severities.map((s, i) => ({ severity: /** @type {any} */ (s), title: `Thing ${i}`, detail: `Detail ${i}` })),
});

describe('the settings file', () => {
  it('is valid and uses the agreed defaults (owner, 2026-11-14)', () => {
    const s = loadSettings(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    expect(s.passMark).toBe(75);
    expect(s.weights).toEqual({ major: 15, question: 10, minor: 5 });
    expect(typeof s.enabled).toBe('boolean');
  });

  it.each([
    ['no enabled flag', { passMark: 75, weights: SETTINGS.weights }],
    ['enabled as text', { ...SETTINGS, enabled: 'yes' }],
    ['pass mark as text', { ...SETTINGS, passMark: '75' }],
    ['pass mark over 100', { ...SETTINGS, passMark: 101 }],
    ['negative pass mark', { ...SETTINGS, passMark: -1 }],
    ['missing weight', { ...SETTINGS, weights: { major: 15, question: 10 } }],
    ['negative weight', { ...SETTINGS, weights: { ...SETTINGS.weights, minor: -5 } }],
    ['fractional weight', { ...SETTINGS, weights: { ...SETTINGS.weights, minor: 2.5 } }],
  ])('rejects %s', (_name, s) => {
    expect(() => loadSettings(JSON.stringify(s))).toThrow(/settings/);
  });
});

describe('scoreReview', () => {
  it('no findings: 100, pass', () => {
    expect(scoreReview(review(), SETTINGS)).toEqual({ state: 'pass', score: 100, blockers: 0 });
  });

  it.each([
    [['minor'], 95, 'pass'],
    [['question'], 90, 'pass'],
    [['major'], 85, 'pass'],
    [['question', 'question'], 80, 'pass'],
    [['major', 'question'], 75, 'pass'], // exactly the pass mark passes
    [['major', 'question', 'minor'], 70, 'fail'],
    [['question', 'question', 'question'], 70, 'fail'],
    [['major', 'major'], 70, 'fail'],
  ])('%j → %i, %s', (sev, score, state) => {
    expect(scoreReview(review(...sev), SETTINGS)).toMatchObject({ score, state });
  });

  it('a blocker fails even at a high score', () => {
    expect(scoreReview(review('blocker'), SETTINGS)).toEqual({ state: 'fail', score: 100, blockers: 1 });
  });

  it('never goes below 0', () => {
    expect(scoreReview(review(...Array(10).fill('major')), SETTINGS).score).toBe(0);
  });

  it('uses the weights and pass mark from the settings', () => {
    const strict = { ...SETTINGS, passMark: 95, weights: { major: 50, question: 20, minor: 1 } };
    expect(scoreReview(review('minor'), strict)).toMatchObject({ score: 99, state: 'pass' });
    expect(scoreReview(review('question'), strict)).toMatchObject({ score: 80, state: 'fail' });
  });

  it('no usable review is incomplete, never a pass', () => {
    expect(scoreReview(null, SETTINGS).state).toBe('incomplete');
  });

  it('ignores any score the AI tries to give', () => {
    const r = parseReview(JSON.stringify({ ...review('major', 'major'), score: 100 }));
    expect(scoreReview(r, SETTINGS)).toMatchObject({ score: 70, state: 'fail' });
  });
});

describe('parseReview', () => {
  it('reads a valid answer', () => {
    expect(parseReview(JSON.stringify(review('question')))).toEqual(review('question'));
  });

  it('decided is optional', () => {
    expect(parseReview(JSON.stringify({ summary: 'x', findings: [] }))?.decided).toEqual([]);
  });

  it.each([
    ['not JSON', 'nope'],
    ['empty', ''],
    ['no findings list', JSON.stringify({ summary: 'x' })],
    ['no summary', JSON.stringify({ findings: [] })],
    ['unknown severity', JSON.stringify(review('critical'))],
    ['finding without detail', JSON.stringify({ summary: 'x', findings: [{ severity: 'minor', title: 't' }] })],
    ['decided not a list of text', JSON.stringify({ summary: 'x', findings: [], decided: [1] })],
  ])('rejects %s', (_name, text) => {
    expect(parseReview(text)).toBeNull();
  });

  it('accepts exactly the severities in the schema', () => {
    expect(SCHEMA.properties.findings.items.properties.severity.enum).toEqual([...SEVERITIES]);
  });
});

describe('buildComment', () => {
  it('pass: marker, score, summary and the small suggestions', () => {
    const r = review('minor');
    const c = buildComment(r, scoreReview(r, SETTINGS), SETTINGS);
    expect(c.startsWith(`${MARKER}\n`)).toBe(true);
    expect(c).toContain('✅ 95/100');
    expect(c).toContain('A new colour for the arrows.');
    expect(c).toContain('1. **Idea: Thing 0.** Detail 0');
    expect(c).not.toContain('go anyway');
  });

  it('fail: questions first, blockers on top, and how to answer', () => {
    const r = review('minor', 'question', 'blocker');
    const c = buildComment(r, scoreReview(r, SETTINGS), SETTINGS);
    expect(c).toContain('❌ 85/100 (it breaks a rule)');
    expect(c.indexOf('**Stop: Thing 2.**')).toBeLessThan(c.indexOf('**Question: Thing 1.**'));
    expect(c.indexOf('**Question: Thing 1.**')).toBeLessThan(c.indexOf('**Idea: Thing 0.**'));
    expect(c).toContain('`@claude go anyway`');
  });

  it('fail on score shows the pass mark', () => {
    const r = review('major', 'major');
    expect(buildComment(r, scoreReview(r, SETTINGS), SETTINGS)).toContain('❌ 70/100 (pass mark 75)');
  });

  it('shows what the owner decided', () => {
    const r = { ...review(), decided: ['Three colours, not five'] };
    expect(buildComment(r, scoreReview(r, SETTINGS), SETTINGS)).toContain('- Three colours, not five');
  });

  it('incomplete: says so, with the log', () => {
    const c = buildComment(null, scoreReview(null, SETTINGS), SETTINGS, 'https://example.test/run/1');
    expect(c).toContain("⚠️ didn't finish");
    expect(c).toContain('Log: https://example.test/run/1');
  });

  it('a title ending in ? keeps it, without an extra full stop', () => {
    const r = { ...review(), findings: [{ severity: /** @type {const} */ ('question'), title: 'Which stars?', detail: 'd' }] };
    expect(buildComment(r, scoreReview(r, SETTINGS), SETTINGS)).toContain('**Question: Which stars?** d');
  });

  it('caps a long list', () => {
    const r = review(...Array(25).fill('minor'));
    expect(buildComment(r, scoreReview(r, SETTINGS), SETTINGS)).toContain('…and 5 more.');
  });
});

describe('clean', () => {
  it('stops @-mentions, HTML and new lines', () => {
    expect(clean('Ask @someone <b>now</b>\n\nplease')).toBe('Ask @\u200bsomeone &lt;b&gt;now&lt;/b&gt; please');
  });

  it('a reviewer can\'t fake the marker or a heading', () => {
    expect(clean('<!-- logic-lane:idea-review -->\n## ✅')).not.toContain('<!--');
  });

  it('shortens very long text', () => {
    expect(clean('x'.repeat(5000)).length).toBeLessThan(1300);
  });
});

describe('command line', () => {
  const script = new URL('../../tools/idea/score.mjs', import.meta.url).pathname;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-'));
  const settings = path.join(tmp, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify(SETTINGS));

  /** @param {object | string} r @param {string[]} [extra] */
  function run(r, extra = []) {
    const file = path.join(tmp, 'review.json');
    fs.writeFileSync(file, typeof r === 'string' ? r : JSON.stringify(r));
    return execFileSync('node', [script, file, '--settings', settings, '--out', tmp, ...extra], { encoding: 'utf8' });
  }

  it('prints the outputs and writes the comment', () => {
    expect(run(review('question'))).toBe('state=pass\nscore=90\ngo=true\n');
    expect(fs.readFileSync(path.join(tmp, 'comment.md'), 'utf8')).toContain('✅ 90/100');
  });

  it('a failed reviewer job is incomplete even with output', () => {
    expect(run(review(), ['--job', 'failure'])).toBe('state=incomplete\nscore=0\ngo=false\n');
  });

  it('empty output is incomplete', () => {
    expect(run('', ['--job', 'success'])).toContain('state=incomplete');
  });
});
