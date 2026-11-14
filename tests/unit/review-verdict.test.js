// The one verdict from both AI reviewers (D19) and the fix-loop rule (D17): tools/review/verdict.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildVerdict,
  clean,
  fixedFindings,
  MARKER,
  MAX_FIX_ROUNDS,
  nextStep,
  parseResult,
  readInput,
  shouldFix,
} from '../../tools/review/verdict.mjs';

const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../tools/review/schema.json', import.meta.url), 'utf8'));

/** @param {object} [over] */
const result = (over = {}) => JSON.stringify({ summary: 'Looks fine.', blocking: [], suggestions: [], ...over });
const BUG = { title: 'Button too small', evidence: 'Phone: Easy is 40×40 px', where: 'css/app.css:12' };
const IDEA = { title: 'Bigger star', evidence: 'The star could be bigger' };

/** @param {Partial<import('../../tools/review/verdict.mjs').VerdictInput>} [over] */
function input(over = {}) {
  return {
    play: { needed: true, job: 'success', json: result() },
    code: { needed: true, job: 'success', json: result() },
    rulesChanged: false,
    sha: 'abcdef1234567890',
    report: { shots: [], consoleErrors: [], externalRequests: [], failures: [] },
    shotFiles: [],
    shotsBase: '',
    fixRounds: 0,
    fixOn: true,
    ...over,
  };
}

describe('state', () => {
  it('both clean: pass', () => {
    const v = buildVerdict(input());
    expect(v.state).toBe('pass');
    expect(v.comment).toContain('## ✅ AI review: pass');
    expect(v.comment.startsWith(MARKER)).toBe(true);
    expect(v.blocking).toBe('');
    expect(v.status).toBe('Pass');
  });

  it('a Blocking item from either reviewer: fail, with the list for the fix run', () => {
    const v = buildVerdict(input({ code: { needed: true, job: 'success', json: result({ blocking: [BUG] }) } }));
    expect(v.state).toBe('fail');
    expect(v.comment).toContain('## ❌ AI review: 1 to fix');
    expect(v.comment).toContain('1. **[code] Button too small**: Phone: Easy is 40×40 px (css/app.css:12)');
    expect(v.blocking).toBe('1. **[code] Button too small**: Phone: Easy is 40×40 px (css/app.css:12)\n');
    expect(v.status).toBe('1 to fix');
  });

  it('Suggestions never fail the verdict', () => {
    const v = buildVerdict(input({ play: { needed: true, job: 'success', json: result({ suggestions: [IDEA] }) } }));
    expect(v.state).toBe('pass');
    expect(v.comment).toContain('### Suggestions');
    expect(v.comment).toContain('- **[play] Bigger star**');
  });

  it.each(['failure', 'cancelled', 'skipped'])("a needed reviewer whose job was %s: didn't finish, never pass", (job) => {
    const v = buildVerdict(input({ play: { needed: true, job, json: '' } }));
    expect(v.state).toBe('incomplete');
    expect(v.comment).toContain("## ⚠️ AI review didn't finish");
    expect(v.blocking).toBe('');
  });

  it('a job that failed after giving an answer still counts as not finished', () => {
    expect(buildVerdict(input({ code: { needed: true, job: 'failure', json: result() } })).state).toBe('incomplete');
  });

  it("didn't finish wins over Blocking items from the other reviewer (no fix on half a review)", () => {
    const v = buildVerdict(
      input({
        play: { needed: true, job: 'failure', json: '' },
        code: { needed: true, job: 'success', json: result({ blocking: [BUG] }) },
      }),
    );
    expect(v.state).toBe('incomplete');
    expect(v.comment).toContain('Button too small'); // still shown
    expect(shouldFix(v.state, input())).toBe(false);
  });

  it('a reviewer that was not needed is fine', () => {
    const v = buildVerdict(input({ play: { needed: false, job: 'skipped', json: '' } }));
    expect(v.state).toBe('pass');
    expect(v.comment).toContain('Play review: not needed');
  });

  it('no reviewer needed: nothing posted', () => {
    const v = buildVerdict(
      input({ play: { needed: false, job: 'skipped', json: '' }, code: { needed: false, job: 'skipped', json: '' } }),
    );
    expect(v).toEqual({ state: 'none', comment: '', blocking: '', status: '' });
  });
});

describe('parseResult', () => {
  it.each([
    ['not JSON', '{'],
    ['missing lists', '{"summary":"x"}'],
    ['a finding without evidence', JSON.stringify({ summary: '', blocking: [{ title: 'x' }], suggestions: [] })],
    ['empty', ''],
  ])('unusable output (%s) counts as not finished', (_, json) => {
    expect(parseResult({ needed: true, job: 'success', json })).toBeNull();
    expect(buildVerdict(input({ code: { needed: true, job: 'success', json } })).state).toBe('incomplete');
  });
});

describe('fixed checks from the screenshots run', () => {
  const report = {
    shots: [],
    failures: [],
    consoleErrors: [{ size: 'phone', screen: 'home', text: 'TypeError: x is undefined' }],
    externalRequests: [
      { size: 'phone', screen: 'home', url: 'https://cdn.example.com/a.js' },
      { size: 'tablet', screen: 'home', url: 'https://cdn.example.com/a.js' },
    ],
  };

  it('console errors and outside requests are Blocking, even if the AI found nothing', () => {
    const v = buildVerdict(input({ report }));
    expect(v.state).toBe('fail');
    expect(v.blocking).toContain('[check] Errors in the browser console (1)');
    expect(v.blocking).toContain('TypeError: x is undefined');
    expect(v.blocking).toContain('[check] Requests to other sites (2)');
    expect(v.blocking).toContain('https://cdn.example.com/a.js');
    expect(v.comment).toContain('Play review: ❌ 2 to fix');
  });

  it('ignored when the play reviewer was not needed', () => {
    expect(buildVerdict(input({ report, play: { needed: false, job: 'skipped', json: '' } })).state).toBe('pass');
  });

  it('nothing to report: no findings', () => {
    expect(fixedFindings(null)).toEqual([]);
    expect(fixedFindings({ shots: [], consoleErrors: [], externalRequests: [], failures: [] })).toEqual([]);
  });

  it("screens that couldn't be opened are mentioned, not Blocking", () => {
    const v = buildVerdict(
      input({ report: { shots: [], consoleErrors: [], externalRequests: [], failures: [{ size: 'tablet', screen: 'demo-play', error: 'Timeout' }] } }),
    );
    expect(v.state).toBe('pass');
    expect(v.comment).toContain("Couldn't take every standard screenshot (1); first: tablet demo-play: Timeout");
  });
});

describe('rules banner', () => {
  it('shown when the PR changes rules or review files', () => {
    expect(buildVerdict(input({ rulesChanged: true })).comment).toContain('This PR changes the rules or the review itself');
    expect(buildVerdict(input()).comment).not.toContain('changes the rules');
  });
});

describe('screenshots', () => {
  const base = 'https://raw.githubusercontent.com/o/r/0123abc/pr-5/abcdef1/';
  const report = {
    consoleErrors: [],
    externalRequests: [],
    failures: [],
    shots: [
      { file: 'phone-home.png', caption: 'Home (phone)', size: 'phone' },
      { file: 'tablet-home.png', caption: 'Home (tablet)', size: 'tablet' },
      { file: 'desktop-home.png', caption: 'Home (desktop)', size: 'desktop' },
      { file: 'phone-demo-play.png', caption: 'demo: first Easy puzzle (phone)', size: 'phone' },
    ],
  };
  const files = ['phone-home.png', 'tablet-home.png', 'desktop-home.png', 'phone-demo-play.png', 'extra-tap.png'];

  it('one row per screen, one column per size', () => {
    const c = buildVerdict(input({ report, shotFiles: files, shotsBase: base })).comment;
    expect(c).toContain('| Screen | Phone | Tablet | Desktop |');
    const home = c.split('\n').find((l) => l.startsWith('| home |'));
    expect(home).toContain(`src="${base}phone-home.png"`);
    expect(home).toContain(`src="${base}tablet-home.png"`);
    expect(home).toContain(`src="${base}desktop-home.png"`);
    expect(c.split('\n').find((l) => l.startsWith('| demo-play |'))).toMatch(/phone-demo-play\.png.*\|  \|  \|$/);
  });

  it("adds the play reviewer's extra pictures, but only real files with safe names", () => {
    const play = {
      needed: true,
      job: 'success',
      json: result({
        screenshots: [
          { file: 'extra-tap.png', caption: 'Tap target' },
          { file: 'missing.png', caption: 'Not saved' },
          { file: '../../etc/x.png', caption: 'Sneaky' },
          { file: 'phone-home.png', caption: 'Already shown' },
        ],
      }),
    };
    const c = buildVerdict(input({ play, report, shotFiles: files, shotsBase: base })).comment;
    expect(c).toContain(`${base}extra-tap.png`);
    expect(c).not.toContain('missing.png');
    expect(c).not.toContain('etc/x.png');
    expect(c.match(/phone-home\.png"/g)?.length).toBe(2); // link + img, once in the table only
  });

  it('no published pictures: no screenshot section, no broken images', () => {
    expect(buildVerdict(input({ report, shotFiles: files, shotsBase: '' })).comment).not.toContain('Screenshots');
    expect(buildVerdict(input({ report, shotFiles: [], shotsBase: base })).comment).not.toContain('<img');
  });
});

describe('clean', () => {
  it('no HTML: nothing hidden, no injected images or markers', () => {
    expect(clean('<!-- x --><img src=y>')).toBe('&lt;!-- x --&gt;&lt;img src=y&gt;');
  });

  it('no @-mentions that would notify people', () => {
    expect(clean('ask @someone and @claude')).toBe('ask @​someone and @​claude');
    expect(clean('a@b')).toBe('a@​b');
  });

  it('one line, trimmed, capped', () => {
    expect(clean('  a\n\nb\r\nc  ')).toBe('a b c');
    expect(clean('x'.repeat(5000))).toHaveLength(1501);
    expect(clean(undefined)).toBe('');
  });

  it('reviewer text goes through it in the comment', () => {
    const json = result({ summary: 'Hi @owner <b>', blocking: [{ title: '<script>', evidence: 'e' }] });
    const c = buildVerdict(input({ code: { needed: true, job: 'success', json } })).comment;
    expect(c).not.toMatch(/<script>|<b>|@owner/);
  });
});

describe('fix loop (D17)', () => {
  const fail = buildVerdict(input({ code: { needed: true, job: 'success', json: result({ blocking: [BUG] }) } }));

  it(`fixes on ❌ while fewer than ${MAX_FIX_ROUNDS} rounds are used`, () => {
    expect(MAX_FIX_ROUNDS).toBe(2);
    expect(shouldFix('fail', input({ fixRounds: 0 }))).toBe(true);
    expect(shouldFix('fail', input({ fixRounds: 1 }))).toBe(true);
    expect(shouldFix('fail', input({ fixRounds: 2 }))).toBe(false);
    expect(shouldFix('fail', input({ fixRounds: 3 }))).toBe(false);
  });

  it('never fixes a pass, an unfinished review, or when switched off', () => {
    expect(shouldFix('pass', input())).toBe(false);
    expect(shouldFix('incomplete', input())).toBe(false);
    expect(shouldFix('fail', input({ fixOn: false }))).toBe(false);
  });

  it('the comment says what happens next, matching shouldFix', () => {
    expect(fail.comment).toContain('automatic fix round 1 of 2 is starting');
    expect(nextStep('fail', input({ fixRounds: 1 }))).toContain('round 2 of 2');
    expect(nextStep('fail', input({ fixRounds: 2 }))).toContain('used up. Over to you');
    expect(nextStep('fail', input({ fixOn: false }))).toContain('automatic fixes are off');
    expect(nextStep('pass', input())).toContain('merge');
    expect(nextStep('incomplete', input())).toContain('Re-run');
  });
});

describe('readInput', () => {
  /** @type {string[]} */
  const temps = [];
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('reads the workflow env and the screenshots folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-lane-verdict-'));
    temps.push(dir);
    fs.writeFileSync(path.join(dir, 'phone-home.png'), '');
    fs.writeFileSync(path.join(dir, 'notes.txt'), '');
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ shots: [1] }));
    const got = readInput({
      PLAY_NEEDED: 'true',
      PLAY_JOB: 'success',
      PLAY_JSON: '{}',
      CODE_NEEDED: 'false',
      RULES_CHANGED: 'true',
      HEAD_SHA: 'abc',
      SHOTS_DIR: dir,
      SHOTS_BASE: 'https://x/',
      FIX_ROUNDS: '1',
      AI_FIX: 'on',
    });
    expect(got).toMatchObject({
      play: { needed: true, job: 'success', json: '{}' },
      code: { needed: false, job: '', json: '' },
      rulesChanged: true,
      sha: 'abc',
      shotFiles: ['phone-home.png'],
      shotsBase: 'https://x/',
      fixRounds: 1,
      fixOn: true,
    });
    expect(got.report).toEqual({ shots: [1] });
  });

  it('missing or broken inputs: safe defaults (no fix, no pictures)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-lane-verdict-'));
    temps.push(dir);
    fs.writeFileSync(path.join(dir, 'report.json'), '{broken');
    const got = readInput({ SHOTS_DIR: dir, FIX_ROUNDS: 'x', AI_FIX: 'yes' });
    expect(got).toMatchObject({ report: null, shotFiles: [], fixRounds: 0, fixOn: false, rulesChanged: false });
    expect(readInput({})).toMatchObject({ report: null, shotFiles: [] });
  });
});

describe('schema.json', () => {
  it('fits in the single-quoted --json-schema argument in review.yml', () => {
    expect(JSON.stringify(SCHEMA)).not.toContain("'");
  });

  it('requires what parseResult needs', () => {
    expect(SCHEMA.required).toEqual(expect.arrayContaining(['summary', 'blocking', 'suggestions']));
    expect(SCHEMA.$defs.finding.required).toEqual(['title', 'evidence']);
  });
});
