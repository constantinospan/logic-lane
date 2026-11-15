// The idea gate's fixed rules (D21, option a+): tools/idea/decide.mjs. The AI only labels findings; this decides.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildComment,
  clean,
  decide,
  HEADINGS,
  KINDS,
  loadSettings,
  MARKER,
  parseReview,
} from '../../tools/idea/decide.mjs';

const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../tools/idea/schema.json', import.meta.url), 'utf8'));
const SETTINGS = { enabled: true, maxAssumptions: 3 };

/** @typedef {import('../../tools/idea/decide.mjs').Finding} Finding */

/** @param {Partial<Finding> & {kind: Finding['kind']}} f @param {number} i @returns {Finding} */
const finding = (f, i = 0) => ({
  title: `Thing ${i}`,
  detail: `Detail ${i}`,
  ...(f.kind === 'question' ? { options: ['Red', 'Blue'] } : {}),
  ...(f.kind === 'assumption' ? { default: `Default ${i}` } : {}),
  ...f,
});

/** @param {...Finding['kind']} kinds */
const review = (...kinds) => ({
  summary: 'Bigger stars on the celebration.',
  brief: ['Stars on the celebration screen get bigger on phones.', 'Nothing else changes.'],
  decided: [],
  findings: kinds.map((kind, i) => finding({ kind }, i)),
});

/** @param {...Finding['kind']} kinds */
const run = (...kinds) => decide(review(...kinds), SETTINGS);

describe('the settings file', () => {
  it('is valid and uses the agreed defaults (owner, 2026-11-14)', () => {
    const s = loadSettings(fs.readFileSync(new URL('../../tools/idea/settings.json', import.meta.url), 'utf8'));
    expect(s.maxAssumptions).toBe(3);
    expect(typeof s.enabled).toBe('boolean');
  });

  it.each([
    ['no enabled flag', { maxAssumptions: 3 }],
    ['enabled as text', { enabled: 'yes', maxAssumptions: 3 }],
    ['no maxAssumptions', { enabled: true }],
    ['maxAssumptions as text', { enabled: true, maxAssumptions: '3' }],
    ['negative maxAssumptions', { enabled: true, maxAssumptions: -1 }],
    ['fractional maxAssumptions', { enabled: true, maxAssumptions: 1.5 }],
    ['maxAssumptions over 10', { enabled: true, maxAssumptions: 11 }],
    ['the old scored format', { enabled: true, passMark: 75, weights: { major: 15, question: 10, minor: 5 } }],
  ])('rejects %s', (_name, s) => {
    expect(() => loadSettings(JSON.stringify(s))).toThrow(/settings/);
  });

  it('keeps only the known keys', () => {
    expect(loadSettings(JSON.stringify({ enabled: false, maxAssumptions: 0, extra: 1 }))).toEqual({
      enabled: false,
      maxAssumptions: 0,
    });
  });
});

describe('decide', () => {
  it('nothing found: build', () => {
    expect(run().state).toBe('build');
  });

  it.each([
    [['note'], 'build'],
    [['assumption'], 'build'],
    [['assumption', 'assumption', 'assumption'], 'build'], // exactly the cap still builds
    [['assumption', 'note', 'note', 'note', 'note'], 'build'], // notes never count
    [['question'], 'ask'], // the 6c proof flaw: one open question must ask (#38)
    [['problem'], 'ask'],
    [['assumption', 'assumption', 'assumption', 'assumption'], 'ask'], // over the cap
    [['blocker'], 'stop'],
    [['blocker', 'question', 'assumption'], 'stop'], // a blocker wins
  ])('%j → %s', (kinds, state) => {
    expect(run(.../** @type {Finding['kind'][]} */ (kinds)).state).toBe(state);
  });

  it('over the cap, every assumption becomes a question with its default as option a', () => {
    const d = run('assumption', 'assumption', 'assumption', 'assumption');
    expect(d.capped).toBe(true);
    expect(d.assumptions).toEqual([]);
    expect(d.asks).toHaveLength(4);
    expect(d.asks[0]).toMatchObject({ kind: 'question', options: ['Default 0', 'something else'] });
  });

  it('uses maxAssumptions from the settings', () => {
    expect(decide(review('assumption'), { enabled: true, maxAssumptions: 0 }).state).toBe('ask');
    expect(decide(review(...Array(10).fill('assumption')), { enabled: true, maxAssumptions: 10 }).state).toBe('build');
  });

  it('questions come before problems, in one numbered list', () => {
    const d = run('problem', 'question');
    expect(d.asks.map((f) => f.kind)).toEqual(['question', 'problem']);
  });

  it('assumptions are only kept when building', () => {
    expect(run('question', 'assumption').assumptions).toEqual([]);
    expect(run('assumption').assumptions).toHaveLength(1);
  });

  it('no usable review is incomplete, never a build', () => {
    expect(decide(null, SETTINGS).state).toBe('incomplete');
  });
});

describe('parseReview', () => {
  it('reads a valid answer', () => {
    expect(parseReview(JSON.stringify(review('question', 'assumption')))).toEqual(review('question', 'assumption'));
  });

  it('decided is optional', () => {
    expect(parseReview(JSON.stringify({ summary: 'x', brief: [], findings: [] }))?.decided).toEqual([]);
  });

  it('an assumption without a default is treated as a question', () => {
    const r = parseReview(JSON.stringify({ summary: 'x', brief: [], findings: [{ kind: 'assumption', title: 't', detail: 'd' }] }));
    expect(r?.findings[0].kind).toBe('question');
    expect(decide(r, SETTINGS).state).toBe('ask');
  });

  it('ignores any score or verdict the AI adds', () => {
    const r = parseReview(JSON.stringify({ ...review('question'), score: 100, state: 'build' }));
    expect(decide(r, SETTINGS).state).toBe('ask');
  });

  it.each([
    ['not JSON', 'nope'],
    ['empty', ''],
    ['no brief', JSON.stringify({ summary: 'x', findings: [] })],
    ['brief not a list', JSON.stringify({ summary: 'x', brief: 'one line', findings: [] })],
    ['no findings list', JSON.stringify({ summary: 'x', brief: [] })],
    ['no summary', JSON.stringify({ brief: [], findings: [] })],
    ['unknown kind', JSON.stringify(review(/** @type {any} */ ('major')))],
    ['the old severity field', JSON.stringify({ summary: 'x', brief: [], findings: [{ severity: 'minor', title: 't', detail: 'd' }] })],
    ['options not text', JSON.stringify({ summary: 'x', brief: [], findings: [{ kind: 'question', title: 't', detail: 'd', options: [1] }] })],
    ['decided not a list of text', JSON.stringify({ summary: 'x', brief: [], findings: [], decided: [1] })],
  ])('rejects %s', (_name, text) => {
    expect(parseReview(text)).toBeNull();
  });

  it('accepts exactly the kinds in the schema', () => {
    expect(SCHEMA.properties.findings.items.properties.kind.enum).toEqual([...KINDS]);
  });
});

describe('buildComment', () => {
  /** @param {ReturnType<typeof review>} r */
  const comment = (r) => buildComment(r, decide(r, SETTINGS));

  it('build: marker, heading, the brief as lines, numbered assumptions, notes, and how to correct', () => {
    const c = comment(review('assumption', 'note'));
    expect(c.startsWith(`${MARKER}\n${HEADINGS.build}\n`)).toBe(true);
    expect(c).toContain('**What will be built:**\n- Stars on the celebration screen get bigger on phones.\n- Nothing else changes.');
    expect(c).toContain('1. **Thing 0.** Default 0 (Detail 0)');
    expect(c).toContain('reply `@claude 1: …` to change one');
    expect(c).toContain('**Notes** (optional for the builder');
    expect(c).toContain('use the newest **Create PR** link');
    expect(c).not.toContain('go anyway');
  });

  it('ask: questions with lettered options, problems, and quick replies', () => {
    const c = comment(review('problem', 'question'));
    expect(c.startsWith(`${MARKER}\n${HEADINGS.ask}\n`)).toBe(true);
    expect(c).toContain('1. **Thing 1.** Detail 1\n   - **1a:** Red\n   - **1b:** Blue');
    expect(c).toContain('2. **Problem: Thing 0.** Detail 0 Change the decision, or drop this part?');
    expect(c).toContain('`@claude 1a 2b`');
    expect(c).toContain('`@claude go anyway`');
    expect(c).not.toContain('What will be built');
  });

  it('ask over the cap says why', () => {
    expect(comment(review('assumption', 'assumption', 'assumption', 'assumption'))).toContain('too many guesses');
  });

  it('stop: the rule it breaks, and that go anyway keeps the rules', () => {
    const c = comment(review('blocker', 'question'));
    expect(c.startsWith(`${MARKER}\n${HEADINGS.stop}\n`)).toBe(true);
    expect(c).toContain('1. **Thing 0.** Detail 0');
    expect(c).toContain('every "Never do" rule');
    expect(c).not.toContain('**1a:**');
  });

  it('shows what the owner decided', () => {
    expect(comment({ ...review(), decided: ['Three colours, not five'] })).toContain('- Three colours, not five');
  });

  it('a title ending in ? keeps it, without an extra full stop', () => {
    const r = { ...review(), findings: [finding({ kind: 'question', title: 'Which game?' })] };
    expect(comment(r)).toContain('**Which game?** Detail 0');
  });

  it('incomplete: says so, with the log', () => {
    const c = buildComment(null, decide(null, SETTINGS), 'https://example.test/run/1');
    expect(c).toContain(HEADINGS.incomplete);
    expect(c).toContain('Log: https://example.test/run/1');
  });

  it('caps a long list', () => {
    const r = review(...Array(25).fill('question'));
    expect(comment(r)).toContain('…and 5 more.');
  });

  it('cleans the brief, options and defaults too', () => {
    const r = {
      ...review(),
      brief: ['Ask @someone ![x](https://example.test/a.png)'],
      findings: [finding({ kind: 'assumption', default: '<b>bold</b> [link](https://example.test)' })],
    };
    const c = comment(r);
    expect(c).toContain('Ask @​someone \\!\\[x\\](https://example.test/a.png)');
    expect(c).toContain('&lt;b&gt;bold&lt;/b&gt; \\[link\\](https://example.test)');
    const q = { ...review(), findings: [finding({ kind: 'question', options: ['@everyone <i>x</i>'] })] };
    expect(comment(q)).toContain('**1a:** @​everyone &lt;i&gt;x&lt;/i&gt;');
  });
});

describe('clean', () => {
  it('stops @-mentions, HTML and new lines', () => {
    expect(clean('Ask @someone <b>now</b>\n\nplease')).toBe('Ask @​someone &lt;b&gt;now&lt;/b&gt; please');
  });

  it('stops Markdown images and links (they would load other sites)', () => {
    expect(clean('See ![x](https://example.test/a.png) and [y](https://example.test)')).toBe(
      'See \\!\\[x\\](https://example.test/a.png) and \\[y\\](https://example.test)',
    );
  });

  it("a reviewer can't fake the marker or a heading", () => {
    expect(clean(`${MARKER}\n${HEADINGS.build}`)).not.toContain('<!--');
  });

  it('shortens very long text', () => {
    expect(clean('x'.repeat(5000)).length).toBeLessThan(1300);
  });
});

describe('command line', () => {
  const script = new URL('../../tools/idea/decide.mjs', import.meta.url).pathname;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-'));
  const settings = path.join(tmp, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify(SETTINGS));

  /** @param {object | string} r @param {string[]} [extra] */
  function cli(r, extra = []) {
    const file = path.join(tmp, 'review.json');
    fs.writeFileSync(file, typeof r === 'string' ? r : JSON.stringify(r));
    return execFileSync('node', [script, file, '--settings', settings, '--out', tmp, ...extra], { encoding: 'utf8' });
  }

  it('build: prints the outputs and writes the comment', () => {
    expect(cli(review('assumption'))).toBe('state=build\ngo=true\n');
    expect(fs.readFileSync(path.join(tmp, 'comment.md'), 'utf8')).toContain(HEADINGS.build);
  });

  it('ask and stop never go', () => {
    expect(cli(review('question'))).toBe('state=ask\ngo=false\n');
    expect(cli(review('blocker'))).toBe('state=stop\ngo=false\n');
  });

  it('a failed reviewer job is incomplete even with output', () => {
    expect(cli(review(), ['--job', 'failure'])).toBe('state=incomplete\ngo=false\n');
  });

  it('empty output is incomplete', () => {
    expect(cli('', ['--job', 'success'])).toBe('state=incomplete\ngo=false\n');
  });
});
