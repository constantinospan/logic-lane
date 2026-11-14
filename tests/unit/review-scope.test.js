// Which AI reviewers a PR gets (D19, D15): tools/review/scope.mjs, and the screen list in tools/review/shots.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changedFiles,
  classify,
  formatOutput,
  gameIds,
  gamesToShow,
  isDocsOnly,
  isRuleFile,
  isSteering,
} from '../../tools/review/scope.mjs';
import { isExternal, screensFor, SIZES } from '../../tools/review/shots.mjs';

const GAMES = ['demo', 'arrow-path'];

describe('docs-only', () => {
  it.each(['README.md', 'docs/PLAN.md', 'docs/TESTING.md', 'docs/notes/idea.txt', 'games/demo/NOTES.md'])(
    '%s is docs-only',
    (f) => expect(isDocsOnly(f)).toBe(true),
  );

  // D15: the rule files steer every agent run, so they're always reviewed.
  it.each(['CLAUDE.md', 'docs/REVIEW-CHECKLIST.md', 'docs/DECISIONS.md', '.claude/settings.json', '.claude/x.md'])(
    '%s is a rule file, never docs-only',
    (f) => {
      expect(isRuleFile(f)).toBe(true);
      expect(isDocsOnly(f)).toBe(false);
    },
  );

  it.each(['js/app.js', 'sw.js', 'tests/unit/rng.test.js', 'package.json', '.github/workflows/ci.yml'])(
    '%s is not docs-only',
    (f) => expect(isDocsOnly(f)).toBe(false),
  );
});

describe('classify', () => {
  it('docs-only PR: no reviewer', () => {
    expect(classify(['README.md', 'docs/PLAN.md'], GAMES)).toEqual({
      play: false,
      code: false,
      rulesChanged: false,
      games: [],
    });
  });

  it('empty PR: no reviewer', () => {
    expect(classify([], GAMES)).toMatchObject({ play: false, code: false });
  });

  it('a rule file alone: code review and the rules banner, no play', () => {
    expect(classify(['docs/REVIEW-CHECKLIST.md'], GAMES)).toEqual({
      play: false,
      code: true,
      rulesChanged: true,
      games: [],
    });
  });

  it('tests only: code review, no play', () => {
    expect(classify(['tests/unit/rng.test.js'], GAMES)).toMatchObject({ play: false, code: true, rulesChanged: false });
  });

  it("one game's files: both reviewers, only that game shown", () => {
    expect(classify(['games/demo/game.js', 'tests/unit/games/demo.test.js'], GAMES)).toEqual({
      play: true,
      code: true,
      rulesChanged: false,
      games: ['demo'],
    });
  });

  it('a shared shipped file: every game shown', () => {
    expect(classify(['css/app.css'], GAMES).games).toEqual(['arrow-path', 'demo']);
    expect(classify(['sw.js'], GAMES)).toMatchObject({ play: true, code: true, games: ['arrow-path', 'demo'] });
  });

  it('a markdown file inside a shipped folder still counts as shipped', () => {
    expect(classify(['games/demo/NOTES.md'], GAMES)).toMatchObject({ play: true, code: false, games: ['demo'] });
  });

  it.each([
    '.github/workflows/review.yml',
    'tools/review/verdict.mjs',
    'tests/shipped-files.js',
    '.mcp.json',
    '.husky/pre-commit',
    'CLAUDE.local.md',
  ])('%s changes how review works: banner', (f) => {
    expect(isSteering(f)).toBe(true);
    expect(classify([f], GAMES)).toMatchObject({ code: true, rulesChanged: true });
  });

  it('ordinary files are not steering', () => {
    expect(isSteering('js/app.js')).toBe(false);
    expect(isSteering('tools/build-site.mjs')).toBe(false);
  });
});

describe('gamesToShow', () => {
  it('a deleted or unknown game folder is not shown', () => {
    expect(gamesToShow(['games/gone/game.js'], GAMES)).toEqual([]);
  });

  it('two games changed: both, sorted, once each', () => {
    expect(gamesToShow(['games/demo/a.js', 'games/arrow-path/b.js', 'games/demo/c.js'], GAMES)).toEqual([
      'arrow-path',
      'demo',
    ]);
  });

  it('non-shipped files are ignored', () => {
    expect(gamesToShow(['docs/PLAN.md', 'games/demo/game.js'], GAMES)).toEqual(['demo']);
  });
});

it('formatOutput gives one key=value line each, for $GITHUB_OUTPUT', () => {
  const out = formatOutput({ play: true, code: false, rulesChanged: true, games: ['a', 'b'] }, ['x', 'y', 'z']);
  expect(out.split('\n')).toEqual(['play=true', 'code=false', 'rules_changed=true', 'games=a b', 'files=3']);
});

describe('against a real git checkout', () => {
  /** @type {string[]} */
  const temps = [];
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** @param {string} dir @param {...string} args */
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

  /** @param {string} dir @param {string} file @param {string} text */
  const write = (dir, file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };

  it('lists both sides of a rename, only changes since main, and the game folders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-lane-scope-'));
    temps.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, 'config', 'user.name', 'test');
    write(dir, 'games/demo/game.js', 'export default 1;\n');
    write(dir, 'games/Bad_Name/game.js', 'x\n');
    write(dir, 'docs/PLAN.md', 'plan\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'checkout', '-qb', 'pr');
    fs.mkdirSync(path.join(dir, 'js'));
    git(dir, 'mv', 'docs/PLAN.md', 'js/plan.js');
    write(dir, 'README.md', 'hi\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'change');

    expect(changedFiles(dir).sort()).toEqual(['README.md', 'docs/PLAN.md', 'js/plan.js']);
    expect(gameIds(dir)).toEqual(['demo']); // folder names that aren't URL-safe ids are left out
  });
});

describe('shots helpers', () => {
  it('home, then each game\'s picker and first Easy puzzle', () => {
    expect(screensFor(['demo']).map((s) => [s.slug, s.hash, Boolean(s.startEasy)])).toEqual([
      ['home', '#/', false],
      ['demo-picker', '#/game/demo', false],
      ['demo-play', '#/game/demo', true],
    ]);
  });

  it('refuses a game id that could break a path or route', () => {
    expect(() => screensFor(['../x'])).toThrow(/Bad game id/);
  });

  it('uses the checklist sizes, WebKit for the tablet', () => {
    expect(SIZES.map((s) => `${s.name} ${s.browser} ${s.width}x${s.height} ${s.touch}`)).toEqual([
      'phone chromium 390x844 true',
      'tablet webkit 820x1180 true',
      'desktop chromium 1280x800 false',
    ]);
  });

  it.each([
    ['http://localhost:4173/logic-lane/js/app.js', false],
    ['data:image/png;base64,xx', false],
    ['blob:http://localhost:4173/abc', false],
    ['https://fonts.googleapis.com/css', true],
    ['http://localhost:9999/x', true],
    ['not a url', true],
  ])('%s external: %s', (url, expected) => {
    expect(isExternal(url, 'http://localhost:4173')).toBe(expected);
  });
});
